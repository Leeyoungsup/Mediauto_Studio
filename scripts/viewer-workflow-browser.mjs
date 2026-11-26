import assert from 'node:assert/strict';
import { demoEvidence } from './workflow-demo-evidence.mjs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const evidence = demoEvidence('viewer-tools-47');
const button = (root, name) => root.getByRole('button', { name, exact: true });

try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1540, height: 1040 }, acceptDownloads: true });
  page.setDefaultTimeout(18000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  assert.equal((await page.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-admin', password: 'synthetic-test-password',
  } })).status(), 200);
  const listing = await (await page.request.get('/api/worklist?q=IMS-DEMO-101')).json();
  const record = listing.rows.find((item) => item.case_number === 'IMS-DEMO-101');
  const ndpi = record.slides.find((scan) => scan.wsi.format === 'NDPI');
  const svs = record.slides.find((scan) => scan.wsi.format === 'SVS');
  const wsi = '/api/wsi/clinical/' + ndpi.id;
  const slideUrl = '/#viewer/' + record.record_id + '/' + ndpi.id;
  await page.goto(slideUrl);
  await button(page, 'Pan using minimap').waitFor();

  async function dragOrClick(canvas, points, useDrag = false) {
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const onScreen = points.map(([x, y]) => [box.x + box.width / 2 + x, box.y + box.height / 2 + y]);
    if (useDrag) {
      await page.mouse.move(...onScreen[0]);
      await page.mouse.down();
      await page.mouse.move(...onScreen[1], { steps: 5 });
      await page.mouse.up();
    } else {
      for (const point of onScreen) await page.mouse.click(...point);
    }
  }

  const canvas = page.getByLabel('WSI Canvas', { exact: true });
  const panel = page.getByRole('region', { name: 'Review Position and Annotations', exact: true });
  const tools = page.getByRole('group', { name: 'Review Tools', exact: true });
  const drawing = page.getByRole('group', { name: 'Drawing Controls', exact: true });
  async function saveAs(name) {
    await panel.getByRole('textbox', { name: 'Annotation Name' }).fill(name);
    await button(panel, 'Save Annotation').click();
    await panel.getByText(name, { exact: true }).waitFor();
    return panel.getByRole('listitem').filter({ hasText: name });
  }
  await button(tools, 'Polygon ROI').click();
  assert.equal(await button(drawing, 'Close Polygon').isDisabled(), true);
  await dragOrClick(canvas, [[-44, -28], [40, 30], [-44, 30], [40, -28]]);
  const openPolygon = page.locator('[data-record="drawing"]');
  await openPolygon.locator('.polygon-start').waitFor();
  assert.equal(await openPolygon.locator('polygon').count(), 0, 'Open polygons should have no closing edge or fill');
  await page.keyboard.press('Enter');
  await drawing.getByRole('alert').filter({ hasText: 'Polygon edges cannot cross' }).waitFor();
  await page.keyboard.press('Backspace');
  await drawing.getByText('3 / 256 points', { exact: true }).waitFor();
  await dragOrClick(canvas, [[-44, -28]]);
  const polygon = await saveAs('Synthetic polygon closure');
  await polygon.waitFor();
  await button(panel, 'Close Annotations').click();
  await panel.waitFor({ state: 'hidden' });
  await page.reload();
  await button(page, 'Annotations').click();
  await panel.getByText('Synthetic polygon closure', { exact: true }).waitFor();
  const persistedPolygon = await (await page.request.get(wsi + '/viewer-records')).json();
  const savedPolygon = persistedPolygon.annotations.find((row) => row.label === 'Synthetic polygon closure');
  assert.equal(savedPolygon.points.length, 3, 'The first vertex should only appear once in saved geometry');
  const savedShape = page.locator(`polygon[data-record="${savedPolygon.id}"]`);
  await savedShape.waitFor();
  await panel.getByRole('textbox', { name: 'Find Annotation' }).fill('no matching shape');
  await panel.getByText('No annotations match these filters.', { exact: true }).waitFor();
  await panel.getByRole('textbox', { name: 'Find Annotation' }).clear();
  await panel.getByRole('combobox', { name: 'Annotation Type' }).selectOption('polygon');
  await panel.getByRole('checkbox', { name: 'Show Saved Markup' }).uncheck();
  await savedShape.waitFor({ state: 'hidden' });
  await panel.getByRole('checkbox', { name: 'Show Saved Markup' }).check();
  await savedShape.waitFor();
  await button(tools, 'Polygon ROI').click();
  await dragOrClick(canvas, [[-25, -15], [25, 15]]);
  await button(drawing, 'Cancel Drawing').click();
  await openPolygon.waitFor({ state: 'hidden' });
  for (const [points, error] of [
    [[[100, 100], [200, 200], [300, 300]], /enclose an area/],
    [[[100, 100], [200, 200], [100, 200], [200, 100]], /cannot cross/],
  ]) {
    const response = await page.request.post(wsi + '/viewer-records/annotations', { data: {
      id: randomUUID(), kind: 'polygon', points, label: 'Invalid synthetic polygon',
    } });
    assert.equal(response.status(), 422, await response.text());
    assert.match(await response.text(), error);
  }

  await button(tools, 'Multi-segment Distance').click();
  await dragOrClick(canvas, [[-35, -35], [-35, 15], [30, 15]]);
  await drawing.locator('.drawing-length').getByText(/mm|µm/).waitFor();
  await evidence.capture(drawing, 'measurement-preview');
  await button(drawing, 'Finish Points').click();
  const path = await saveAs('Synthetic measured path');
  await path.getByText(/mm|µm/).waitFor();

  await button(tools, 'Point Count').click();
  await dragOrClick(canvas, [[-25, -30], [0, 0], [20, 22]]);
  await button(drawing, 'Undo Point').click();
  await button(drawing, 'Finish Points').click();
  const marks = await saveAs('Synthetic point count');
  await marks.getByText(/2 points/).waitFor();
  await button(tools, 'Ellipse ROI').click();
  await dragOrClick(canvas, [[-40, -30], [35, 25]], true);
  const roi = await saveAs('Synthetic ellipse');
  await panel.getByRole('checkbox', { name: 'Include ROI Annotation' }).uncheck();
  await panel.getByRole('checkbox', { name: 'Include Scale Bar' }).uncheck();
  const downloadPending = page.waitForEvent('download');
  await button(roi, 'Export ROI PNG').click();
  const download = await downloadPending;
  assert.match(download.suggestedFilename(), /^roi-[a-f0-9-]+\.png$/);
  const png = await readFile(await download.path());
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  await button(tools, 'Calibrated ROI Preset').click();
  await page.getByRole('combobox', { name: 'Preset Size' }).selectOption('500');
  await dragOrClick(canvas, [[12, 0]]);
  await saveAs('Synthetic calibrated preset');
  const metadata = await (await page.request.get(wsi)).json();
  const records = await (await page.request.get(wsi + '/viewer-records')).json();
  const savedPreset = records.annotations.find((row) => row.label === 'Synthetic calibrated preset');
  assert.ok(Math.abs((savedPreset.points[1][0] - savedPreset.points[0][0]) * metadata.mpp_x - 500) < 0.01);
  assert.ok(Math.abs((savedPreset.points[1][1] - savedPreset.points[0][1]) * metadata.mpp_y - 500) < 0.01);
  await button(page, 'Save Bookmark').click();
  const bookmark = await saveAs('Synthetic private bookmark');
  const zoomBefore = Number(await page.locator('.image-panel').getAttribute('data-view-zoom'));
  await button(page, 'Zoom In').click();
  await button(bookmark, 'Go to Position').click();
  assert.equal(await bookmark.getAttribute('data-selected'), 'true');
  await page.waitForFunction((zoom) => Math.abs(Number(document.querySelector('.image-panel')?.dataset.viewZoom) - zoom) < 0.000001, zoomBefore);

  const countsPanel = page.getByRole('region', { name: 'Specimen Lymph Node Count' });
  await button(page, 'Lymph Node Count').click();
  const count = countsPanel.getByRole('form', { name: 'Lymph Node Count', exact: true });
  await count.getByRole('spinbutton', { name: 'Total', exact: true }).fill('9');
  await count.getByRole('spinbutton', { name: 'Positive', exact: true }).fill('2');
  await button(count, 'Save Lymph Node Count').click();
  await countsPanel.getByRole('heading', { name: 'Lymph Node Count · 2 / 9', exact: true }).waitFor();
  await page.goto(`/#viewer/${record.record_id}/${svs.id}`);
  await button(page, 'Lymph Node Count').click();
  await countsPanel.getByRole('heading', { name: 'Lymph Node Count · 2 / 9', exact: true }).waitFor();
  await countsPanel.getByText('Recorded on scan ' + ndpi.id.slice(0, 8), { exact: true }).waitFor();
  await count.getByRole('spinbutton', { name: 'Positive', exact: true }).fill('3');
  await count.getByRole('textbox', { name: 'Count Correction Reason' }).fill('Synthetic recount');
  await button(count, 'Save Count Correction').click();
  await countsPanel.getByRole('heading', { name: 'Lymph Node Count · 3 / 9', exact: true }).waitFor();
  await countsPanel.getByText('Recorded on scan ' + svs.id.slice(0, 8) + ' (current scan)', { exact: true }).waitFor();
  await evidence.capture(countsPanel, 'specimen-count');
  await countsPanel.getByRole('link', { name: 'Open Report Draft', exact: true }).click();
  const reportForm = page.getByRole('form', { name: 'Edit Report Draft', exact: true });
  await reportForm.getByRole('checkbox', { name: /Lymph Node Count.*3 \/ 9/ }).check();
  await reportForm.getByRole('textbox', { name: 'Diagnosis (Required)' }).fill('Synthetic linked count');
  await button(reportForm, 'Save Draft').click();
  await page.getByText('Report draft saved.', { exact: true }).waitFor();
  await button(page, 'Open Viewer').click();
  await page.locator(`.image-panel[data-scan-id="${svs.id}"]`).waitFor();

  await page.goto(slideUrl);
  await button(page, 'Pan using minimap').waitFor();
  await page.getByRole('complementary', { name: 'Slide Tray', exact: true })
    .locator('input[type=checkbox]:not(:checked):enabled').first().check();
  const pane = (i) => page.getByRole('group', { name: new RegExp('^Pane ' + i + ':') });
  const normalized = [[[270, 74], [304, 154], [309, 248], [333, 300]], [[86, 53], [105, 100], [111, 156], [125, 187]]];
  const slideInfo = [metadata, await (await page.request.get('/api/wsi/clinical/' + svs.id)).json()];
  for (const index of [1, 2]) await button(pane(index), 'Pan using minimap').waitFor();
  await page.getByText('Tissue Registration', { exact: true }).click();
  await button(page, 'Pick Tissue Landmarks').click();
  await page.getByText(/Waiting for Pane 1, Pane 2/).waitFor();

  async function landmark(index, xy) {
    const panel = pane(index + 1).locator('.image-panel');
    const zoom = Number(await panel.getAttribute('data-view-zoom'));
    const cx = Number(await panel.getAttribute('data-view-center-x'));
    const cy = Number(await panel.getAttribute('data-view-center-y'));
    const [w, h] = slideInfo[index].dimensions;
    await dragOrClick(pane(index + 1).getByLabel('WSI Canvas', { exact: true }), [[
      (xy[0] * w / 600 - cx) * zoom, (xy[1] * h / 600 - cy) * zoom,
    ]]);
  }
  for (let i = 0; i < 4; i++) {
    await landmark(0, normalized[0][i]);
    await landmark(1, normalized[1][i]);
  }
  const tissueError = page.getByRole('list', { name: 'Registration Error by Scan' });
  await tissueError.getByText(/Check landmarks 2 · RMS .* · Maximum/).waitFor();
  await evidence.capture(page.locator('.tissue-registration'), 'landmark-checks');
  await button(page, 'Use Tissue Registration').click();
  await button(page, 'Sync Position').click();
  await page.getByText(/Tissue Landmark Registration.*Sync On/).waitFor();
  await button(pane(1), 'Zoom In').click();
  const results = await tissueError.textContent();

  const pixelOnly = await browser.newPage({ baseURL, storageState: await page.context().storageState() });
  await pixelOnly.route(`**${wsi}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), mpp_x: null, mpp_y: null } });
  });
  await pixelOnly.goto(slideUrl);
  await button(pixelOnly, 'Pan using minimap').waitFor();
  const preset = button(pixelOnly, 'Calibrated ROI Preset');
  await preset.waitFor();
  assert.ok(await preset.isDisabled());
  await button(pixelOnly, 'Multi-segment Distance').click();
  const pixelCanvas = pixelOnly.getByLabel('WSI Canvas', { exact: true });
  const box = await pixelCanvas.boundingBox();
  await pixelOnly.mouse.click(box.x + box.width / 2 - 25, box.y + box.height / 2);
  await pixelOnly.mouse.click(box.x + box.width / 2 + 25, box.y + box.height / 2);
  await pixelOnly.locator('.drawing-length').getByText(/px/).waitFor();
  await pixelOnly.locator('.drawing-length').getByText(/Pixel size unavailable/).waitFor();
  await pixelOnly.close();
  assert.deepEqual(errors, []);
  console.log('PASS: polygon preview, closing, invalid geometry, undo, cancel and reload; extended geometry, calibrated preset, bookmark restore, ROI PNG, specimen recount, report evidence and tissue landmark registration');
  console.log('Browser tissue residual (rounded pointer inputs):', results);
} finally {
  await browser.close();
}
