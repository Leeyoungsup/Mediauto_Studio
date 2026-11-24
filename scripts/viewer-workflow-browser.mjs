import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
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
  const report = '/#case/' + record.record_id + '/report';
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
  const tool = page.getByRole('combobox', { name: 'Additional Tool' });
  async function saveAs(name) {
    await panel.getByRole('textbox', { name: 'Annotation Name' }).fill(name);
    await button(panel, 'Save Annotation').click();
    await panel.getByText(name, { exact: true }).waitFor();
    return panel.getByRole('listitem').filter({ hasText: name });
  }
  await tool.selectOption('path');
  await dragOrClick(canvas, [[-35, -35], [-35, 15], [30, 15]]);
  await button(panel, 'Finish Points').click();
  const path = await saveAs('Synthetic measured path');
  await path.getByText(/mm|µm/).waitFor();

  await tool.selectOption('count');
  await dragOrClick(canvas, [[-25, -30], [0, 0], [20, 22]]);
  await button(panel, 'Undo Point').click();
  await button(panel, 'Finish Points').click();
  const marks = await saveAs('Synthetic point count');
  await marks.getByText(/2 points/).waitFor();
  await tool.selectOption('ellipse');
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

  await tool.selectOption('preset');
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
  await page.waitForFunction((zoom) => Math.abs(Number(document.querySelector('.image-panel')?.dataset.viewZoom) - zoom) < 0.000001, zoomBefore);

  const summary = page.locator('.lymph-counts summary');
  await summary.click();
  const count = page.getByRole('form', { name: 'Lymph Node Count', exact: true });
  await count.getByRole('spinbutton', { name: 'Total', exact: true }).fill('9');
  await count.getByRole('spinbutton', { name: 'Positive', exact: true }).fill('2');
  await button(count, 'Save Lymph Node Count').click();
  await summary.filter({ hasText: /2 \/ 9/ }).waitFor();
  await page.goto(`/#viewer/${record.record_id}/${svs.id}`);
  await summary.filter({ hasText: /2 \/ 9/ }).waitFor();
  await summary.click();
  await count.getByRole('spinbutton', { name: 'Positive', exact: true }).fill('3');
  await count.getByRole('textbox', { name: 'Count Correction Reason' }).fill('Synthetic recount');
  await button(count, 'Save Count Correction').click();
  await summary.filter({ hasText: /3 \/ 9/ }).waitFor();
  await page.goto(report);
  const reportForm = page.getByRole('form', { name: 'Edit Report Draft', exact: true });
  await reportForm.getByRole('checkbox', { name: /Lymph Node Count.*3 \/ 9/ }).check();
  await reportForm.getByRole('textbox', { name: 'Diagnosis (Required)' }).fill('Synthetic linked count');
  await button(reportForm, 'Save Draft').click();
  await page.getByText('Report draft saved.', { exact: true }).waitFor();

  await page.goto(slideUrl);
  await button(page, 'Pan using minimap').waitFor();
  await button(page, 'Multi View').click();
  const pane = (i) => page.getByRole('group', { name: new RegExp('^Pane ' + i + ':') });
  const normalized = [[[270, 74], [304, 154], [309, 248], [333, 300]], [[86, 53], [105, 100], [111, 156], [125, 187]]];
  const slideInfo = [metadata, await (await page.request.get('/api/wsi/clinical/' + svs.id)).json()];
  for (const index of [1, 2]) await button(pane(index), 'Pan using minimap').waitFor();
  await page.getByText('Tissue Registration', { exact: true }).click();
  await button(page, 'Pick Tissue Landmarks').click();

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
  await button(page, 'Use Tissue Registration').click();
  await button(page, 'Sync Position').click();
  await page.getByText(/Tissue Landmark Registration.*Sync On/).waitFor();
  await button(pane(1), 'Zoom In').click();
  const results = await tissueError.textContent();
  assert.deepEqual(errors, []);
  console.log('PASS: extended geometry, calibrated preset, bookmark restore, ROI PNG, specimen recount, report evidence and tissue landmark registration');
  console.log('Browser tissue residual (rounded pointer inputs):', results);
} finally {
  await browser.close();
}
