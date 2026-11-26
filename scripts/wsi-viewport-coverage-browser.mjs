import assert from 'node:assert/strict';
const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });

try {
  const page = await browser.newPage({ baseURL, viewport: { width: 2200, height: 1410 } });
  await page.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-admin', password: 'synthetic-test-password',
  } });
  const response = await page.request.get('/api/worklist?q=IMS-DEMO-101');
  const { rows } = await response.json();
  const row = rows.find((item) => item.case_number === 'IMS-DEMO-101');
  const scan = row.slides.find((item) => item.wsi.format === 'NDPI');
  const endpoint = '/api/wsi/clinical/' + scan.id;
  const png = async (color) => Buffer.from(await page.evaluate((color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 64, 64);
    return canvas.toDataURL().split(',')[1];
  }, color), 'base64');
  const overview = await png('#9a9a9a');
  const tileBody = await png('#f2591d');
  const dimensions = [32768, 24576];
  await page.route('**' + endpoint, (route) => route.fulfill({ json: { dimensions, mpp_x: .25, mpp_y: .25 } }));
  await page.route(new RegExp(endpoint + '/overview\\.jpeg'), (route) => route.fulfill({ body: overview, contentType: 'image/png' }));
  const pattern = new RegExp(endpoint + '/(\\d+/\\d+/\\d+)\\.jpeg$');
  const collected = new Set();
  const fail = '0/12/10';
  let failedOnce = false;
  await page.route(pattern, (route) => {
    const key = new URL(route.request().url()).pathname.match(pattern)[1];
    if (key === fail && !failedOnce) {
      failedOnce = true;
      return route.fulfill({ status: 503, json: { detail: 'Synthetic viewport tile failure' } });
    }
    collected.add(key);
    return route.fulfill({ body: tileBody, contentType: 'image/png' });
  });
  await page.goto('/#viewer/' + row.record_id + '/' + scan.id);
  await page.locator('.image-panel[data-tiles=ok]').waitFor();
  await page.getByLabel('Calibrated Magnification').selectOption('10');
  await page.locator('.image-panel[data-tiles=partial]').waitFor();
  assert.equal(failedOnce, true);
  const pixels = () => page.locator('.wsi-canvas').evaluate((canvas) => {
    const ctx = canvas.getContext('2d');
    return [[3, 3], [canvas.width - 4, 3], [3, canvas.height - 4], [canvas.width - 4, canvas.height - 4]].map(([x, y]) =>
      Array.from(ctx.getImageData(x, y, 1, 1).data));
  });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.locator('.image-panel[data-tiles=ok]').waitFor();
  const expected = await page.locator('.image-panel').evaluate((panel) => {
    const zoom = Number(panel.dataset.viewZoom);
    const canvas = panel.querySelector('.wsi-canvas');
    const halfX = canvas.clientWidth / zoom / 2;
    const halfY = canvas.clientHeight / zoom / 2;
    const [cx, cy] = [Number(panel.dataset.viewCenterX), Number(panel.dataset.viewCenterY)];
    const ids = [];
    for (let y = Math.floor((cy - halfY) / 1024); y < Math.ceil((cy + halfY) / 1024); y++) {
      for (let x = Math.floor((cx - halfX) / 1024); x < Math.ceil((cx + halfX) / 1024); x++) ids.push(`0/${x}/${y}`);
    }
    return ids;
  });
  assert.ok(expected.length > 32, `Regression case needs more than 32 visible tiles, saw ${expected.length}`);
  assert.deepEqual(expected.filter((key) => !collected.has(key)), []);
  assert.deepEqual(await pixels(), Array.from({ length: 4 }, () => [242, 89, 29, 255]));
  console.log(`PASS: all ${expected.length} viewport tiles drawn including all four corners; failed tile retried.`);
} finally {
  await browser.close();
}
