// Read-only API delivery probe. Does not reset, modify or authenticate a ledger.
import assert from 'node:assert/strict';
import { checkRetiredWeb } from './lib/retired-web.mjs';

const origin = process.argv[2] ?? 'http://127.0.0.1:8081';
try {
  const health = await fetch(`${origin}/api/v1/health`);
  assert.equal(health.status, 200, `Health endpoint returned HTTP ${health.status}`);
  assert.equal((await health.json()).status, 'ok', 'Health endpoint did not report ok');
  await checkRetiredWeb((label, passes, detail) => {
    assert.ok(passes, `${label}: ${detail}`);
  }, ['/', '/login', '/transactions/42', '/index.html', '/assets/old.js', '/sw.js', '/manifest.webmanifest'], origin);
  console.log('API-only delivery checks passed');
} catch (error) {
  const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
  console.error(`API-only delivery check failed: ${detail}`);
  process.exitCode = 1;
}
