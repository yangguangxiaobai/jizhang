/**
 * Environment parsing + validation (task PRD R2).
 *
 * Contract: this module never falls back to a default for a variable that has
 * no default, and it reports *every* problem at once instead of dying on the
 * first one. `loadConfig` throws a `ConfigError` whose message is a readable
 * list — callers (index.ts) print it and exit 1 without a stack trace
 * (acceptance criterion AC12).
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** Anything that looks like a process env bag — a plain object is fine in tests. */
export type EnvSource = Record<string, string | undefined>;

export interface AppConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  /** Bind address; `0.0.0.0` inside the container. */
  readonly host: string;
  readonly port: number;
  readonly trustProxy: boolean;
  readonly logLevel: string;
  /** Directory that holds the SQLite file (and later `backups/`). */
  readonly dataDir: string;
  readonly dbFile: string;
  /** Reported by GET /api/v1/health. */
  readonly version: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly sessionTtlDays: number;
  /** Optional hex-encoded 32-byte key used to encrypt the AI provider secret. */
  readonly aiEncryptionKey: string | undefined;
  /** Private in-container inference URL. Absent means ordinary photo upload only. */
  readonly itemCutoutServiceUrl: string | undefined;
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      [
        'The server refused to start: the configuration is invalid.',
        '',
        ...problems.map((problem) => `  - ${problem}`),
        '',
        'See .env.example for every variable, its default and its meaning.',
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const NODE_ENVS = ['development', 'production', 'test'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

const DEFAULTS = {
  PORT: '8081',
  HOST: '0.0.0.0',
  DATA_DIR: './data',
  LOG_LEVEL: 'info',
  TRUST_PROXY: 'false',
  SESSION_TTL_DAYS: '30',
} as const;

/**
 * Variables with no sensible default: startup must fail loudly rather than
 * quietly invent a user or a password (parent task design.md §7.3, D7).
 */
const REQUIRED: readonly { readonly key: string; readonly hint: string }[] = [
  {
    key: 'JIZHANG_USERNAME',
    hint: 'single-user login name; add it to .env (copy .env.example)',
  },
  {
    key: 'JIZHANG_PASSWORD_HASH',
    hint: 'argon2id hash of the login password — never the plaintext; add it to .env',
  },
];

function packageVersion(): string {
  const pkg = require('../package.json') as { version?: string };
  return pkg.version ?? '0.0.0';
}

export function loadConfig(env: EnvSource = process.env): AppConfig {
  const problems: string[] = [];

  const read = (key: string): string | undefined => {
    const raw = env[key];
    if (raw === undefined) {
      return undefined;
    }
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const readWithDefault = (key: keyof typeof DEFAULTS): string => read(key) ?? DEFAULTS[key];

  for (const { key, hint } of REQUIRED) {
    if (read(key) === undefined) {
      problems.push(`${key} is required but is not set (${hint})`);
    }
  }

  const nodeEnvRaw = read('NODE_ENV') ?? 'development';
  if (!(NODE_ENVS as readonly string[]).includes(nodeEnvRaw)) {
    problems.push(`NODE_ENV must be one of ${NODE_ENVS.join(' | ')} (got "${nodeEnvRaw}")`);
  }

  const portRaw = readWithDefault('PORT');
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be an integer between 1 and 65535 (got "${portRaw}")`);
  }

  const sessionTtlRaw = readWithDefault('SESSION_TTL_DAYS');
  const sessionTtlDays = Number(sessionTtlRaw);
  if (!Number.isInteger(sessionTtlDays) || sessionTtlDays < 1) {
    problems.push(`SESSION_TTL_DAYS must be a positive integer (got "${sessionTtlRaw}")`);
  }

  const trustProxyRaw = readWithDefault('TRUST_PROXY').toLowerCase();
  if (!TRUTHY.has(trustProxyRaw) && !FALSY.has(trustProxyRaw)) {
    problems.push(`TRUST_PROXY must be a boolean such as true/false (got "${trustProxyRaw}")`);
  }

  const logLevelRaw = readWithDefault('LOG_LEVEL').toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(logLevelRaw)) {
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(' | ')} (got "${logLevelRaw}")`);
  }

  const itemCutoutServiceUrlRaw = read('JIZHANG_ITEM_CUTOUT_SERVICE_URL');
  let itemCutoutServiceUrl: string | undefined;
  if (itemCutoutServiceUrlRaw !== undefined) {
    try {
      const url = new URL(itemCutoutServiceUrlRaw);
      const privateHosts = new Set([
        'jizhang-cutout',
        'localhost',
        '127.0.0.1',
        '[::1]',
        'host.docker.internal',
      ]);
      if (
        url.protocol !== 'http:' ||
        !privateHosts.has(url.hostname) ||
        url.username !== '' ||
        url.password !== '' ||
        url.pathname !== '/' ||
        url.search !== '' ||
        url.hash !== ''
      ) {
        problems.push(
          'JIZHANG_ITEM_CUTOUT_SERVICE_URL must be a root HTTP URL on the local inference host.',
        );
      } else {
        itemCutoutServiceUrl = url.origin;
      }
    } catch {
      problems.push('JIZHANG_ITEM_CUTOUT_SERVICE_URL must be a valid local HTTP URL.');
    }
  }

  const dataDir = path.resolve(readWithDefault('DATA_DIR'));

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    nodeEnv: nodeEnvRaw as AppConfig['nodeEnv'],
    host: readWithDefault('HOST'),
    port,
    trustProxy: TRUTHY.has(trustProxyRaw),
    logLevel: logLevelRaw,
    dataDir,
    dbFile: path.join(dataDir, 'jizhang.db'),
    version: read('APP_VERSION') ?? packageVersion(),
    username: read('JIZHANG_USERNAME') ?? '',
    passwordHash: read('JIZHANG_PASSWORD_HASH') ?? '',
    sessionTtlDays,
    aiEncryptionKey: read('JIZHANG_AI_ENCRYPTION_KEY'),
    itemCutoutServiceUrl,
  };
}
