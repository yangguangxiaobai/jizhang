#!/usr/bin/env node
/**
 * Synthetic organization payload/batching harness. No network, Provider, database,
 * production data, or dependency required. Results are not a safety/capacity claim.
 * Run: node .trellis/tasks/10-19-ai-spending-organization/benchmarks/organization-capacity-synthetic.mjs
 */
import { performance } from 'node:perf_hooks';

const PROPOSED_CAP = 500; // provisional proposal, not accepted
const BATCH_SIZE = 25; // provisional proposal, not accepted
const MOCK_LATENCY_MS = 8;
const NOTE_CHARS = 160;
const FAIL_AT_BATCH = Number(process.env.FAIL_AT_BATCH ?? 0); // 1-based; 0 = success

function makeRows(count) {
  return Array.from({ length: count }, (_, i) => ({
    transactionId: `tx-${String(i + 1).padStart(6, '0')}`,
    type: i % 7 === 0 ? 1 : 0,
    categoryId: `category-${i % 18}`,
    categoryName: `分类-${i % 18}`,
    note: `synthetic transaction ${i + 1} ${'店铺及用途描述'.repeat(10)}`.slice(0, NOTE_CHARS),
    tags: [`标签-${i % 12}`, `渠道-${i % 5}`],
  }));
}

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mockAnalyze(batch, index) {
  // Deterministic provider-shaped response, but no HTTP/provider SDK invocation.
  await sleep(MOCK_LATENCY_MS);
  if (FAIL_AT_BATCH === index + 1) throw new Error('MOCK_BATCH_FAILURE');
  return batch.map((row) => ({ transactionId: row.transactionId, unchanged: true, reason: 'synthetic' }));
}

async function run(count) {
  const before = process.memoryUsage();
  const started = performance.now();
  if (count > PROPOSED_CAP) {
    return {
      eligible: count,
      accepted: false,
      expected: 'reject whole range before provider calls; no truncation or card',
      providerCalls: 0,
      cardPublished: false,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      heapDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed,
    };
  }
  const rows = makeRows(count);
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));
  const requests = [];
  const responseBytes = [];
  let processed = 0;
  try {
    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      requests.push(byteLength({ feature: 'organization', transactions: batch }));
      const response = await mockAnalyze(batch, i);
      responseBytes.push(byteLength({ results: response }));
      processed += response.length;
    }
    const elapsedMs = performance.now() - started;
    return {
      eligible: count,
      accepted: true,
      batchSize: BATCH_SIZE,
      batchCount: batches.length,
      providerCalls: requests.length,
      requestBytes: { total: requests.reduce((a, b) => a + b, 0), max: Math.max(0, ...requests) },
      responseBytes: { total: responseBytes.reduce((a, b) => a + b, 0), max: Math.max(0, ...responseBytes) },
      processed,
      coverageComplete: processed === count,
      cardPublished: processed === count,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      mockLatencyPerCallMs: MOCK_LATENCY_MS,
      heapDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed,
      rssDeltaBytes: process.memoryUsage().rss - before.rss,
    };
  } catch (error) {
    return {
      eligible: count,
      accepted: true,
      batchSize: BATCH_SIZE,
      batchCount: batches.length,
      providerCalls: requests.length,
      failedBatch: FAIL_AT_BATCH,
      processedBeforeFailure: processed,
      coverageComplete: false,
      cardPublished: false,
      status: 'failed',
      errorCode: error instanceof Error ? error.message : 'MOCK_ERROR',
      expected: 'discard earlier batches; no actionable result/card',
      elapsedMs: Number((performance.now() - started).toFixed(2)),
      heapDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed,
    };
  }
}

const cases = [];
for (const count of [1, 24, 25, 26, 200, 499, 500, 501]) cases.push(await run(count));
console.log(JSON.stringify({
  harness: 'synthetic-only-no-network-no-db-no-real-ledger',
  node: process.version,
  provisionalProposal: { cap: PROPOSED_CAP, batchSize: BATCH_SIZE },
  mockLatencyMs: MOCK_LATENCY_MS,
  injectedFailureBatch: FAIL_AT_BATCH || null,
  cases,
  interpretation: 'Synthetic payload byte counts and local timings are not real-provider, deployment-heap, timeout, or production safety evidence.',
}, null, 2));
