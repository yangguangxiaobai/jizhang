import { test, expect } from './fixtures.mjs';
import { assertPhoneLayout } from './helpers.mjs';

const jobId = 'a'.repeat(32);

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function login(page, ledger) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('用户名').fill(ledger.username);
  await page.getByLabel('密码', { exact: true }).fill(ledger.password);
  const pendingLoad = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/recurring/pending',
  );
  const rulesLoad = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/recurring/rules',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  const [pending, rules] = await Promise.all([pendingLoad, rulesLoad]);
  expect(pending.status()).toBe(200);
  expect(rules.status()).toBe(200);
}

async function makeImageFixtures(page) {
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas is unavailable');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#d22';
    context.fillRect(6, 6, 12, 12);

    const toBase64 = async (type) => {
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob((value) => (value === null ? reject(new Error('Encode failed')) : resolve(value)), type),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    };
    return { png: await toBase64('image/png'), webp: await toBase64('image/webp') };
  });
  return { png: Buffer.from(encoded.png, 'base64'), webp: Buffer.from(encoded.webp, 'base64') };
}

async function installCutoutMock(page, ledger, { createJob, jobState = 'ready', candidates, candidateImage } = {}) {
  const images = await makeImageFixtures(page);
  const stats = { creates: 0, deletes: 0, candidateDownloads: 0 };

  ledger.setCutoutFetch(async (input, init) => {
    const url = new URL(String(input));
    const pathname = url.pathname;
    const method = init?.method ?? 'GET';
    if (pathname === '/jobs' && method === 'POST') {
      stats.creates += 1;
      return createJob(stats.creates);
    }
    if (method === 'DELETE') {
      stats.deletes += 1;
      return new Response(null, { status: 204 });
    }
    if (pathname.endsWith('/preview')) {
      return new Response(images.webp, { status: 200, headers: { 'Content-Type': 'image/webp' } });
    }
    if (pathname.endsWith('/image')) {
      stats.candidateDownloads += 1;
      if (candidateImage !== undefined) return candidateImage(images);
      return new Response(images.png, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    if (pathname.startsWith(`/jobs/${jobId}`)) {
      return jsonResponse(200, {
        jobId,
        state: jobState,
        message:
          candidates?.length === 0
            ? '没有找到合适的透明候选，请使用原图或重试。'
            : jobState === 'running'
              ? '正在分析图片并生成透明候选…'
              : `已生成 ${candidates?.length ?? 1} 个透明候选，请选择一张。`,
        candidates:
          candidates === undefined
            ? [{ id: '0', width: 24, height: 24 }]
            : candidates,
      });
    }
    return jsonResponse(404, { error: { code: 'CUTOUT_JOB_NOT_FOUND', message: 'Not found' } });
  });

  return { images, stats };
}

async function openNewItem(page, ledger) {
  await login(page, ledger);
  await page.goto('/items/new');
  await expect(page.getByRole('heading', { name: '完善物品信息' })).toBeVisible();
}

async function attachOriginalPhoto(page, png) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic-item.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByRole('button', { name: 'AI 自动抠图' })).toBeVisible();
}

async function saveItem(page, name) {
  await page.getByLabel('物品名称').fill(name);
  await page.getByRole('button', { name: '保存物品', exact: true }).click();
  await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
}

test('cutout candidates stay a draft until save and never create ledger entries', async ({
  page,
  ledger,
}) => {
  await openNewItem(page, ledger);
  const beforeTransactions = await page.request.get('/api/v1/transactions?limit=500').then((r) => r.json());
  const beforeItems = await page.request.get('/api/v1/items').then((r) => r.json());
  const { images, stats } = await installCutoutMock(page, ledger, {
    createJob: async () => jsonResponse(202, { jobId }),
  });

  await attachOriginalPhoto(page, images.png);
  await page.getByRole('button', { name: 'AI 自动抠图', exact: true }).click();
  const candidate = page.getByRole('button', { name: '使用抠图候选 1', exact: true });
  await expect(candidate).toBeVisible();
  await expect(page.getByRole('img', { name: '透明抠图候选 1' })).toBeVisible();
  const previewBackground = await page.locator('.cutout-preview').evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  );
  expect(previewBackground).not.toBe('none');
  await assertPhoneLayout(page);

  const stillDraft = await page.request.get('/api/v1/items').then((r) => r.json());
  expect(stillDraft.total).toBe(beforeItems.total);
  expect(stats.creates).toBe(1);

  await candidate.click();
  await expect(page.getByText('已选择候选 1；保存物品后才会替换照片。')).toBeVisible();
  await saveItem(page, '抠图测试物品');

  const itemId = new URL(page.url()).pathname.split('/').at(-1);
  const photo = await page.request.get(`/api/v1/items/${itemId}/photo`);
  expect(photo.status()).toBe(200);
  expect(photo.headers()['content-type']).toContain('image/webp');
  const encodedPhoto = (await photo.body()).toString('base64');
  const alpha = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas is unavailable');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return {
      corner: pixels.data[3],
      center: pixels.data[(12 * canvas.width + 12) * 4 + 3],
    };
  }, encodedPhoto);
  expect(alpha.corner).toBe(0);
  expect(alpha.center).toBeGreaterThan(240);
  expect(stats.candidateDownloads).toBe(1);
  const afterTransactions = await page.request.get('/api/v1/transactions?limit=500').then((r) => r.json());
  expect(afterTransactions.total).toBe(beforeTransactions.total);
});

test('service failure and empty result keep ordinary photo upload available', async ({ page, ledger }) => {
  await openNewItem(page, ledger);
  const { images, stats } = await installCutoutMock(page, ledger, {
    createJob: async (attempt) => {
      if (attempt === 1) {
        return jsonResponse(503, {
          error: { code: 'CUTOUT_UNAVAILABLE', message: 'worker unavailable' },
        });
      }
      return jsonResponse(202, { jobId });
    },
    candidates: [],
  });

  await attachOriginalPhoto(page, images.png);
  await page.getByRole('button', { name: 'AI 自动抠图', exact: true }).click();
  await expect(page.getByText('AI 抠图服务暂时不可用；物品照片仍可普通上传。')).toBeVisible();
  await page.getByRole('button', { name: '重试自动抠图', exact: true }).click();
  await expect(page.getByText('没有找到合适的透明候选，请使用原图或重试。')).toBeVisible();
  expect(stats.creates).toBe(2);
  expect(stats.candidateDownloads).toBe(0);

  await saveItem(page, '保留原图物品');
  const itemId = new URL(page.url()).pathname.split('/').at(-1);
  const photo = await page.request.get(`/api/v1/items/${itemId}/photo`);
  expect(photo.status()).toBe(200);
  expect(photo.headers()['content-type']).toContain('image/webp');
});

test('a running cutout job can be cancelled without creating an item', async ({ page, ledger }) => {
  await openNewItem(page, ledger);
  const beforeItems = await page.request.get('/api/v1/items').then((r) => r.json());
  const { images, stats } = await installCutoutMock(page, ledger, {
    createJob: async () => jsonResponse(202, { jobId }),
    jobState: 'running',
  });

  await attachOriginalPhoto(page, images.png);
  await page.getByRole('button', { name: 'AI 自动抠图', exact: true }).click();
  const cutoutPanel = page.getByRole('region', { name: 'AI 自动抠图' });
  await expect(cutoutPanel.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await cutoutPanel.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByText('抠图已取消，原照片草稿没有更改。')).toBeVisible();
  expect(stats.deletes).toBe(1);

  const afterItems = await page.request.get('/api/v1/items').then((r) => r.json());
  expect(afterItems.total).toBe(beforeItems.total);
});


for (const candidateStatus of [200, 503]) {
  test(`removing a photo ignores a late candidate response (${candidateStatus})`, async ({ page, ledger }) => {
    await openNewItem(page, ledger);
    let deliverCandidate;
    let requestArrived;
    const arrived = new Promise((resolve) => { requestArrived = resolve; });
    const candidateResult = new Promise((resolve) => { deliverCandidate = resolve; });
    const { images } = await installCutoutMock(page, ledger, {
      createJob: async () => jsonResponse(202, { jobId }),
      candidateImage: async () => { requestArrived(); return candidateResult; },
    });
    await attachOriginalPhoto(page, images.png);
    await page.getByRole('button', { name: 'AI 自动抠图', exact: true }).click();
    await page.getByRole('button', { name: '使用抠图候选 1', exact: true }).click();
    await arrived;
    await page.getByRole('button', { name: '移除照片', exact: true }).click();
    const delivered = page.waitForResponse((response) => response.url().endsWith('/candidates/0/image'));
    deliverCandidate(candidateStatus === 200
      ? new Response(images.png, { status: 200, headers: { 'Content-Type': 'image/png' } })
      : jsonResponse(503, { error: { code: 'CUTOUT_UNAVAILABLE', message: 'late failure' } }));
    await (await delivered).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole('region', { name: 'AI 自动抠图' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '移除照片', exact: true })).toHaveCount(0);
    await saveItem(page, `移除照片回归 ${candidateStatus}`);
    const itemId = new URL(page.url()).pathname.split('/').at(-1);
    const photo = await page.request.get(`/api/v1/items/${itemId}/photo`);
    expect(photo.status()).toBe(404);
  });
}
