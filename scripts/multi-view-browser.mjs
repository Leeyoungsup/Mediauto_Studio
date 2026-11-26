import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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
  const pane = (i) => page.getByRole('group', { name: new RegExp('^Pane ' + i + ':') });
  const canvas = (i) => pane(i).getByLabel('WSI Canvas');
  const button = (text) => page.getByRole('button', { name: text, exact: true });
  const sync = button('Sync Position');
  const tray = page.getByRole('complementary', { name: 'Slide Tray', exact: true });
  const compare = (label) => tray.getByRole('checkbox', { name: 'Compare ' + label, exact: true });

  async function open(caseId) {
    const response = await page.request.get('/api/worklist', { params: { q: caseId } });
    assert.ok(response.ok(), await response.text());
    const { rows } = await response.json();
    const row = rows.find((entry) => entry.case_number === caseId);
    assert.ok(row?.record_id, 'Expected registered test case ' + caseId);
    await page.goto('/#case/' + row.record_id);
    await page.getByRole('heading', { name: caseId, exact: true }).waitFor();
    await button('Open Viewer').click();
    await tray.locator('input[type=checkbox]:not(:checked):enabled').first().check();
    await pane(1).getByRole('button', { name: 'Pan using minimap' }).waitFor();
    await pane(2).getByRole('button', { name: 'Pan using minimap' }).waitFor();
  }

  async function zoom(i, count) {
    for (let click = 0; click < count; click++) await pane(i).getByRole('button', { name: 'Zoom In', exact: true }).click();
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
  assert.equal(await tray.locator('input:checked').count(), 2);
  const splitBox = await canvas(1).boundingBox();
  assert.ok(splitBox.height >= 650 && splitBox.y < 220, 'Comparison should use the available height');
  const suffix = randomUUID().slice(0, 8);
  const annotationName = 'Multi View Test Polygon ' + suffix;
  const distanceName = 'Multi View Test Distance ' + suffix;
  const annotations = (i) => pane(i).getByRole('region', { name: 'Review Position and Annotations' });
  await pane(1).getByRole('button', { name: 'Annotations', exact: true }).click();
  await pane(1).getByRole('button', { name: 'Polygon ROI', exact: true }).click();
  for (const [dx, dy] of [[-32, -28], [35, -24], [8, 32]]) {
    await canvas(1).click({ position: { x: splitBox.width / 2 + dx, y: splitBox.height / 2 + dy } });
  }
  await pane(1).getByRole('button', { name: 'Close Polygon', exact: true }).click();
  await annotations(1).getByRole('textbox', { name: 'Annotation Name' }).fill(annotationName);
  const polygonSave = page.waitForResponse((response) => response.url().endsWith('/viewer-records/annotations') && response.request().method() === 'POST');
  await annotations(1).getByRole('button', { name: 'Save Annotation', exact: true }).click();
  const polygon = await (await polygonSave).json();
  const overlay = (i) => pane(i).locator(`polygon[data-record="${polygon.id}"]`);
  await annotations(1).getByText(annotationName, { exact: true }).waitFor();
  await annotations(1).getByRole('button', { name: 'Close Annotations', exact: true }).click();
  await overlay(1).waitFor();
  await pane(2).getByRole('button', { name: 'Annotations', exact: true }).click();
  assert.equal(await annotations(2).getByText(annotationName, { exact: true }).count(), 0);
  assert.equal(await overlay(2).count(), 0);
  await pane(2).getByRole('button', { name: 'Distance Measurement', exact: true }).click();
  const other = await canvas(2).boundingBox();
  await page.mouse.move(other.x + other.width / 2 - 28, other.y + other.height / 2);
  await page.mouse.down();
  await page.mouse.move(other.x + other.width / 2 + 28, other.y + other.height / 2);
  await page.mouse.up();
  await annotations(2).getByRole('textbox', { name: 'Annotation Name' }).fill(distanceName);
  const distanceSave = page.waitForResponse((response) => response.url().endsWith('/viewer-records/annotations') && response.request().method() === 'POST');
  await annotations(2).getByRole('button', { name: 'Save Annotation', exact: true }).click();
  const distance = await (await distanceSave).json();
  assert.equal(distance.unit, 'um');
  assert.ok(distance.length > 0);
  await annotations(2).getByText(distanceName, { exact: true }).waitFor();
  await annotations(2).getByRole('button', { name: 'Close Annotations', exact: true }).click();
  const unchanged = await frame(2);
  await zoom(1, 5);
  assert.deepEqual(await frame(2), unchanged);
  const beforeWheel = await frame(1);
  await canvas(1).hover({ position: { x: 125, y: 80 } });
  await page.mouse.wheel(0, -120);
  await page.waitForFunction((old) => Number(document.querySelector('.multi-view-pane .image-panel')?.dataset.viewZoom) > old, beforeWheel.zoom);
  const afterWheel = await frame(1);
  assert.ok(Math.hypot(afterWheel.x - beforeWheel.x, afterWheel.y - beforeWheel.y) < 0.01);
  assert.ok(Math.abs(afterWheel.zoom / beforeWheel.zoom - 1.1) < 0.00001);
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
  await page.getByText('Tissue Registration', { exact: true }).click();
  await button('Use Current Positions as Alignment Points').click();
  await page.getByText('Tissue Registration', { exact: true }).click();
  await page.getByText(/Manual Alignment Points/).waitFor();
  await sync.click();
  await drag(1, -34, -19);
  const anchored = report(await frame(1), await frame(2), dimensions[0], dimensions[1], anchors);

  const beforeToggle = [await frame(1), await frame(2)];
  const keepCameras = async (expected) => {
    for (const index of [0, 1]) {
      const actual = await frame(index + 1);
      assert.ok(Math.hypot(actual.x - expected[index].x, actual.y - expected[index].y) < 0.01);
      assert.ok(Math.abs(actual.zoom - expected[index].zoom) < 0.00001);
    }
  };
  await page.getByText('Tissue Registration', { exact: true }).click();
  await page.getByLabel('Tissue', { exact: true }).waitFor();
  await page.getByText('Tissue Registration', { exact: true }).click();
  await sync.click();
  await page.getByText(/Manual Alignment Points.*Tissue A.*Sync Off/).waitFor();
  await sync.click();
  await page.getByText(/Manual Alignment Points.*Tissue A.*Sync On/).waitFor();
  await keepCameras(beforeToggle);

  await button('Close Comparison').click();
  await page.getByRole('region', { name: 'Multi View' }).waitFor({ state: 'detached' });
  await compare('SYNTH-01 · SVS').check();
  await page.getByText(/Manual Alignment Points.*Tissue A.*Sync On/).waitFor();
  await keepCameras(beforeToggle);

  const reopened = await browser.newPage({ baseURL, viewport: page.viewportSize() });
  const reopenedLogin = await reopened.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-admin', password: 'synthetic-test-password',
  } });
  assert.equal(reopenedLogin.status(), 200);
  await reopened.goto(page.url());
  const restoredTray = reopened.getByRole('complementary', { name: 'Slide Tray', exact: true });
  await restoredTray.getByRole('checkbox', { name: 'Compare SYNTH-01 · SVS', exact: true }).check();
  await reopened.getByText(/Manual Alignment Points.*Tissue A.*Sync On/).waitFor();
  await reopened.waitForFunction((expected) => [...document.querySelectorAll('.multi-view-pane .image-panel')]
    .every((panel, index) => Math.hypot(Number(panel.dataset.viewCenterX) - expected[index].x,
      Number(panel.dataset.viewCenterY) - expected[index].y) < 0.01
      && Math.abs(Number(panel.dataset.viewZoom) - expected[index].zoom) < 0.00001), anchors);
  await reopened.close();

  const beforeExpand = await frame(1);
  await canvas(1).dblclick();
  await pane(2).waitFor({ state: 'hidden' });
  await page.getByText(/Sync Paused While Expanded/).waitFor();
  const expanded = await frame(1);
  assert.ok(Math.hypot(expanded.x - beforeExpand.x, expanded.y - beforeExpand.y) < 0.01);
  assert.equal(expanded.zoom, beforeExpand.zoom);
  await button('Restore Split View').click();
  await pane(2).waitFor();
  await canvas(2).focus();
  await pane(2).getByRole('button', { name: 'Fit to Window', exact: true }).click();
  await zoom(2, 5);
  const returnCamera = await frame(2);
  await button('Open Active Scan in Single View').click();
  await page.getByRole('button', { name: /SYNTH-01.*SVS/, pressed: true }).waitFor();
  assert.equal(await page.locator('.multi-view').count(), 0);
  await page.waitForFunction((camera) => {
    const data = document.querySelector('.image-panel')?.dataset;
    return data && Math.abs(Number(data.viewZoom) - camera.zoom) < 1e-6 &&
      Math.abs(Number(data.viewCenterX) - camera.x) < 1 && Math.abs(Number(data.viewCenterY) - camera.y) < 1;
  }, returnCamera);
  await open('IMS-DEMO-101');
  await overlay(1).waitFor();
  await pane(1).getByRole('button', { name: 'Annotations', exact: true }).click();
  await annotations(1).getByText(annotationName, { exact: true }).waitFor();

  // A synthetic fifth candidate exercises the limit without importing an unrelated scan.
  await page.route('**/api/worklist/' + record.id, async (route) => {
    const response = await route.fetch();
    const item = await response.json();
    const extra = ['SYNTH FIVE', 'SYNTH SIX', 'SYNTH LIMIT'].map((label, index) => ({
      ...item.slides[0], id: 'synthetic-' + index, label,
    }));
    await route.fulfill({ response, json: { ...item, slides: [...item.slides, ...extra] } });
  });
  await open(caseNumber);
  const lastScan = scans['S-TP'];
  const failurePath = '**/api/wsi/clinical/' + lastScan.id;
  const reject = (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"QA pane error"}' });
  await page.route(failurePath, reject);
  const retainedCanvas = await canvas(1).elementHandle();
  await compare('I-PR · SVS').check();
  await compare('S-TP · SVS').check();
  await compare('SYNTH FIVE · SVS').check();
  await compare('SYNTH SIX · SVS').check();
  await page.getByText('6 / 6 panes').waitFor();
  assert.ok(await compare('SYNTH LIMIT · SVS').isDisabled());
  assert.ok(await retainedCanvas?.evaluate((node) => node.isConnected));
  await pane(4).getByText('QA pane error').waitFor();
  await pane(1).getByRole('button', { name: 'Pan using minimap' }).waitFor();
  assert.ok(await sync.isDisabled());
  await page.unroute(failurePath, reject);
  await pane(4).getByRole('button', { name: 'Retry', exact: true }).click();
  for (const index of [1, 2, 3, 4, 5, 6]) await pane(index).getByRole('button', { name: 'Pan using minimap' }).waitFor();
  await sync.click();
  await zoom(1, 5);
  await drag(1, 40, 30);
  const brcaDimensions = [[117836, 82278], [87127, 82682], [85106, 82076], [79651, 82884]];
  const sixPaneSync = [];
  for (const i of [2, 3, 4, 5, 6]) sixPaneSync.push(report(await frame(1), await frame(i), brcaDimensions[0], brcaDimensions[i - 1] ?? brcaDimensions[0]));
  for (const label of ['SYNTH SIX', 'SYNTH FIVE', 'S-TP', 'I-PR', 'I-KI']) await compare(label + ' · SVS').uncheck();
  await page.getByRole('region', { name: 'Multi View' }).waitFor({state: 'detached'});
  assert.equal(await page.locator('.wsi-canvas').count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', maximumPanes: 6, normalized, reversed, anchored, manualAlignmentRestore: true, sixPaneSync,
    paneRetry: true, focusedPane: true, otherPanesKept: true, paneAnnotationsRestored: true }));
} finally {
  await browser.close();
}
