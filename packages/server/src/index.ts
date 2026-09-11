/**
 * Process entry point: env → config → SQLite → Fastify listen → graceful exit.
 * `pnpm --filter server start` (or the container CMD) runs `node dist/index.js`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { closeDatabase, initializeDatabase, openDatabase } from './db/index.js';

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Loads `.env` for local runs only. Inside the container the environment comes
 * from compose (`NODE_ENV=production`), so a stray file can never mask a
 * missing variable there — which is what AC12 exercises.
 */
function loadLocalEnvFile(): void {
  if (process.env['NODE_ENV'] === 'production') {
    return;
  }

  const envFile = path.resolve(process.cwd(), '.env');
  if (!existsSync(envFile)) {
    return;
  }

  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    console.error(`[jizhang] Could not read ${envFile}: ${(error as Error).message}`);
  }
}

function resolveConfig(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Deliberate: a short, actionable message, no stack (AC12).
      console.error(`\n[jizhang] Startup aborted — configuration error\n\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  loadLocalEnvFile();
  const config = resolveConfig();

  const db = openDatabase(config);
  const { migrations, seed } = initializeDatabase(db, config.dataDir);
  const app = buildApp({ config, db });

  app.log.info(
    {
      dbFile: config.dbFile,
      dataDir: config.dataDir,
      migrationsApplied: migrations.applied,
      backupPath: migrations.backupPath,
      ...seed,
    },
    'sqlite ready',
  );

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'shutdown requested — draining connections');
    try {
      await app.close();
      closeDatabase(db);
      app.log.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  for (const signal of SIGNALS) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  try {
    const address = await app.listen({ host: config.host, port: config.port });
    app.log.info({ address, version: config.version }, 'jizhang server listening');
  } catch (error) {
    app.log.error({ err: error }, 'failed to start');
    closeDatabase(db);
    process.exit(1);
  }
}

void main();
