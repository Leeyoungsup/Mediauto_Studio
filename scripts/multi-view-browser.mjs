import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const clinical = '/api/clinical/local';
const caseNumber = 'IMS-DEMO-MULTI';
const format = (value) => Number(value.toFixed(6));

try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1500, height: 1020 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  assert.equal((await page.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-admin', password: 'synthetic-test-password',
  }})).status(), 200);

  async function create(resource, data, key) {
    const response = await page.request.post(`${clinical}/${resource}`, {
      data, headers: { 'Idempotency-Key': 'multi-view-' + key },
    });
    assert.equal(response.status(), 201, await response.text());
    return response.json();
  }

  const record = await create('cases', { case_number: caseNumber }, 'case');
  const specimen = await create('specimens', { case_id: record.id, specimen_number: 'SYNTH-BRCA' }, 'specimen');
  const scans = {};
  for (const suffix of ['I-HR', 'I-KI', 'I-PR', 'S-TP']) {
    const slide = await create('slides', { specimen_id: specimen.id, slide_number: suffix }, suffix);
    scans[suffix] = await create('scans', {
      slide_id: slide.id, storage_key: `CODIPAI-BRCA-SS-00194-${suffix}-01.svs`,
    }, suffix + '-scan');
  }
  const pane = (i) => page.getByRole('group', { name: new RegExp('^화면 ' + i + ':') });
  const canvas = (i) => pane(i).getByLabel('WSI 캔버스');
  const button = (text) => page.getByRole('button', { name: text, exact: true });
  const sync = button('위치 동기화');

  async function open(caseId) {
    await page.goto('/');
    await button(caseId + ' 상세 열기').click();
    await page.getByRole('heading', { name: caseId, exact: true }).waitFor();
    await button('뷰어 열기').click();
    await button('Multi View').click();
    await pane(1).getByRole('button', { name: '미니맵에서 이동' }).waitFor();
    await pane(2).getByRole('button', { name: '미니맵에서 이동' }).waitFor();
  }

  async function zoom(i, count) {
    for (let click = 0; click < count; click++) await pane(i).getByRole('button', { name: '확대', exact: true }).click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  async function drag(i, x, y) {
    await canvas(i).scrollIntoViewIfNeeded();
    const box = await canvas(i).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + x, box.y + box.height / 2 + y, { steps: 3 });
    await page.mouse.up();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  async function frame(i) {
    return pane(i).locator('.image-panel').evaluate((element) => {
      const canvas = element.querySelector('canvas.wsi-canvas');
      return { x: Number(element.dataset.viewCenterX), y: Number(element.dataset.viewCenterY),
        zoom: Number(element.dataset.viewZoom), width: canvas.clientWidth, height: canvas.clientHeight };
    });
  }

  function report(source, target, left, right, anchors) {
    const [start, end] = anchors ?? [null, null];
    const centerError = Math.hypot(
      target.x - ((end?.x ?? 0) + (source.x - (start?.x ?? 0)) / left[0] * right[0]),
      target.y - ((end?.y ?? 0) + (source.y - (start?.y ?? 0)) / left[1] * right[1]),
    );
    const leftBasis = start?.zoom ?? Math.min(source.width / left[0], source.height / left[1]);
    const rightBasis = end?.zoom ?? Math.min(target.width / right[0], target.height / right[1]);
    const zoomError = Math.abs(source.zoom / leftBasis - target.zoom / rightBasis);
    assert.ok(centerError < 0.01, `Unexpected camera center delta ${centerError}`);
    assert.ok(zoomError < 0.00001, `Unexpected relative zoom delta ${zoomError}`);
    return { centerErrorPx: format(centerError), ratioError: format(zoomError) };
  }

  await open('IMS-DEMO-101');
  const dimensions = [[49920, 59904], [70685, 87947]];
  const unchanged = await frame(2);
  await zoom(1, 5);
  assert.deepEqual(await frame(2), unchanged);
  await sync.click();
  await drag(1, 45, 35);
  const normalized = report(await frame(1), await frame(2), dimensions[0], dimensions[1]);
  await canvas(2).focus();
  assert.equal(await pane(2).getAttribute('data-active'), 'true');
  await canvas(2).press('ArrowRight');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const reversed = report(await frame(2), await frame(1), dimensions[1], dimensions[0]);
  await sync.click();
  await drag(2, -25, 22);
  const anchors = [await frame(1), await frame(2)];
  await button('현재 위치를 기준점으로').click();
  await page.getByText(/수동 기준점 사용/).waitFor();
  await sync.click();
  await drag(1, -34, -19);
  const anchored = report(await frame(1), await frame(2), dimensions[0], dimensions[1], anchors);

  await button('활성 화면 확대').click();
  await pane(2).waitFor({ state: 'hidden' });
  await page.getByText(/확대 중 동기화 일시 중지/).waitFor();
  await button('분할 화면 복원').click();
  await pane(2).waitFor();
  await canvas(2).focus();
  await button('활성 스캔 단일 뷰').click();
  await page.getByRole('button', { name: /SYNTH-01.*SVS/, pressed: true }).waitFor();
  assert.equal(await page.locator('.multi-view').count(), 0);

  // A synthetic fifth candidate exercises the limit without importing an unrelated scan.
  await page.route('**/api/worklist/' + record.id, async (route) => {
    const response = await route.fetch();
    const item = await response.json();
    const fifth = { ...item.slides[0], id: 'synthetic-fifth', label: 'SYNTH LIMIT' };
    await route.fulfill({ response, json: { ...item, slides: [...item.slides, fifth] } });
  });
  await open(caseNumber);
  const lastScan = scans['S-TP'];
  const failurePath = '**/api/wsi/clinical/' + lastScan.id;
  const reject = (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"QA pane error"}' });
  await page.route(failurePath, reject);
  await page.getByRole('checkbox', { name: 'I-PR · SVS', exact: true }).check();
  await page.getByRole('checkbox', { name: 'S-TP · SVS', exact: true }).check();
  await page.getByText('4 / 4 화면').waitFor();
  assert.ok(await page.getByRole('checkbox', { name: 'SYNTH LIMIT · SVS', exact: true }).isDisabled());
  await pane(4).getByText('QA pane error').waitFor();
  await pane(1).getByRole('button', { name: '미니맵에서 이동' }).waitFor();
  assert.ok(await sync.isDisabled());
  await page.unroute(failurePath, reject);
  await pane(4).getByRole('button', { name: '다시 시도', exact: true }).click();
  for (const index of [1, 2, 3, 4]) await pane(index).getByRole('button', { name: '미니맵에서 이동' }).waitFor();
  await sync.click();
  await zoom(1, 5);
  await drag(1, 40, 30);
  const brcaDimensions = [[117836, 82278], [87127, 82682], [85106, 82076], [79651, 82884]];
  const fourPaneSync = [];
  for (const i of [2, 3, 4]) fourPaneSync.push(report(await frame(1), await frame(i), brcaDimensions[0], brcaDimensions[i - 1]));
  await button('비교 닫기').click();
  await page.getByRole('button', { name: 'Multi View', exact: true }).waitFor();
  assert.equal(await page.locator('.wsi-canvas').count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', maximumPanes: 4, normalized, reversed, anchored, fourPaneSync,
    paneRetry: true, focusedPane: true, otherPanesKept: true }));
} finally {
  await browser.close();
}
