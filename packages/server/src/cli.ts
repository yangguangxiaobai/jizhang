#!/usr/bin/env node
/**
 * `node dist/cli.js set-password` — create or rotate the single account.
 *
 * Why a CLI instead of an HTTP route or an env var:
 *   * a registration route would have to be public on a hostname reachable from
 *     the internet, i.e. anyone could claim the account;
 *   * putting a plaintext password in `.env` puts it in a file that gets copied
 *     around, and a hash in `.env` cannot be rotated without editing and
 *     redeploying.
 *
 * The prompt is read with echo disabled, so the password never appears in the
 * terminal, shell history, or the process list.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runDatabaseCommand } from './cli-db.js';
import { ConfigError, loadConfig } from './config.js';
import { closeDatabase, initializeDatabase, openDatabase } from './db/index.js';
import { AuthService } from './services/auth-service.js';
import { MIN_PASSWORD_LENGTH } from './services/password.js';

const USAGE = `Usage: node dist/cli.js <command> [args]

Commands:
  set-password                  Create or rotate the login password (interactive).
  backup <dir> [retain-days]    Snapshot the database into <dir> (default retain 30).
  verify <file.db>              Check that a backup file is a usable database.
  restore <file.db>             Replace the live database with a backup.

set-password reads JIZHANG_USERNAME from the environment (or .env) to know which
account to set, and prompts for the password twice. It needs an interactive
terminal; the database commands do not.

All commands read the same environment variables as the server (see .env.example).
`;

/** Mirrors index.ts: `.env` is only for local/CLI runs, never production containers. */
function loadLocalEnvFile(): void {
  if (process.env['NODE_ENV'] === 'production') return;
  const envFile = path.resolve(process.cwd(), '.env');
  if (!existsSync(envFile)) return;
  try {
    process.loadEnvFile(envFile);
  } catch {
    // A missing/!readable .env is not fatal: the operator may pass vars directly.
  }
}

/** Reads one line from the terminal with echo suppressed when possible. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;

    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(
        new Error(
          'set-password needs an interactive terminal (stdin is not a TTY). ' +
            'Run it with `docker compose exec -it jizhang node dist/cli.js set-password`.',
        ),
      );
      return;
    }

    output.write(question);
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();

    let value = '';
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        switch (char) {
          case '\r':
          case '\n':
            input.setRawMode(wasRaw);
            input.pause();
            input.removeListener('data', onData);
            output.write('\n');
            resolve(value);
            return;
          case '\u0003': // Ctrl-C
            input.setRawMode(wasRaw);
            input.pause();
            input.removeListener('data', onData);
            output.write('\n');
            reject(new Error('Cancelled.'));
            return;
          case '\u007f': // Backspace
          case '\b':
            value = value.slice(0, -1);
            break;
          default:
            // Ignore other control characters; keep printable input only.
            if (char >= ' ') value += char;
        }
      }
    };

    input.on('data', onData);
  });
}

async function setPassword(): Promise<void> {
  loadLocalEnvFile();

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n[jizhang] Cannot set a password — configuration error\n\n${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (config.username.trim() === '') {
    console.error(
      '\n[jizhang] JIZHANG_USERNAME is empty, so there is no account to set a password for.\n',
    );
    process.exitCode = 1;
    return;
  }

  let password: string;
  let confirmation: string;
  try {
    password = await promptHidden(`New password for "${config.username}": `);
    confirmation = await promptHidden('Repeat password: ');
  } catch (error) {
    console.error(`\n[jizhang] ${(error as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `\n[jizhang] Password must be at least ${MIN_PASSWORD_LENGTH} characters long.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (password !== confirmation) {
    console.error('\n[jizhang] The two passwords do not match.\n');
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(config);
  try {
    initializeDatabase(db, config.dataDir);

    const authService = new AuthService(db, {
      sessionTtlDays: config.sessionTtlDays,
    });
    const existed = authService.hasUser();
    await authService.setPassword(config.username, password);

    console.log(
      `\n[jizhang] Password ${existed ? 'updated' : 'set'} for "${config.username}".`,
    );
    console.log(
      existed
        ? 'All existing sessions were invalidated — sign in again on every device.\n'
        : 'You can now sign in.\n',
    );
  } finally {
    closeDatabase(db);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const rest = process.argv.slice(3);

  // Database maintenance lives in its own module to keep this file focused on the
  // interactive password flow.
  if (await runDatabaseCommand(command ?? '', rest)) {
    return;
  }

  switch (command) {
    case 'set-password':
      await setPassword();
      return;
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE);
      return;
    default:
      console.error(`[jizhang] Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

void main();
