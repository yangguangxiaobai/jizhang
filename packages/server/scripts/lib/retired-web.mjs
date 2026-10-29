/** Read-only deployment check; safe to run against an existing ledger. */
export async function checkRetiredWeb(check, paths, origin = 'http://127.0.0.1:8081') {
  for (const path of paths) {
    const response = await fetch(`${origin}${path}`);
    const type = response.headers.get('content-type') ?? '';
    const body = type.includes('application/json') ? await response.json() : undefined;
    check(`GET ${path} returns JSON NOT_FOUND`,
      response.status === 404 && body?.error?.code === 'NOT_FOUND',
      `-> ${response.status} ${type}`);
  }
}
