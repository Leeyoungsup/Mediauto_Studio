import { demoEvidence } from './workflow-demo-evidence.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const clinical = '/api/clinical/local';

async function read(request, expected = 200) {
  const response = await request;
  assert.equal(response.status(), expected, await response.text());
  return response.json();
}

const evidence = demoEvidence('ihc');

try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1520, height: 1010 } });
  page.setDefaultTimeout(20000);
  await evidence.observe(page, 'IHC reviewer');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await read(page.request.post('/api/auth/login', {
    data: { organization: 'local', username: 'integration-admin', password: 'synthetic-test-password' },
  }));
  const { rows } = await read(page.request.get('/api/worklist?q=IMS-DEMO-MULTI'));
  const record = rows.find((row) => row.case_number === 'IMS-DEMO-MULTI');
  assert.ok(record);
  const caseId = record.record_id;

  const card = page.getByRole('region', { name: 'IHC Results', exact: true });
  for (const [marker, label, score] of [
    ['ER', 'I-HR', 'Allred Score · 8/8'],
    ['PR', 'I-PR', 'Aggregation Approval Required'],
    ['Ki-67', 'I-KI', 'Ki-67 Index · 66.67%'],
  ]) {
    const scanId = record.slides.find((scan) => scan.label === label).id;
    const scan = await read(page.request.get(clinical + '/scans/' + scanId));
    const slide = await read(page.request.get(clinical + '/slides/' + scan.slide_id));
    await read(page.request.patch(clinical + '/editor/slides/' + slide.id, {
      data: { slide_number: slide.slide_number, version: slide.version, stain: marker, reason: 'Synthetic IHC browser test' },
    }));
    await page.goto('/#viewer/' + caseId + '/' + scanId);
    await card.getByRole('heading', { name: marker + ' Results', exact: true }).waitFor();
    await card.getByText(score, { exact: true }).waitFor();
    const overlay = page.locator(`canvas[aria-label="${marker} Cell Overlay"]`);
    await overlay.waitFor();
    const checkbox = card.getByRole('checkbox', { name: 'IHC Cell Overlay' });
    await checkbox.uncheck();
    await overlay.waitFor({ state: 'detached' });
    await checkbox.check();
    await overlay.waitFor();
    if (marker === 'ER') {
      await page.getByRole('button', { name: 'IHC Results', exact: true }).click();
      await card.getByRole('button', { name: 'Return to WSI' }).click();
      await page.waitForFunction(() => document.activeElement?.matches('canvas[aria-label="WSI Canvas"]'));
      await card.getByRole('link', { name: 'IHC Review and Best Block' }).click();
      const review = page.getByRole('region', { name: 'IHC Review', exact: true });
      await review.getByText('No IHC reviews recorded.', { exact: true }).waitFor();
      assert.equal(await review.getByRole('form', { name: 'Record IHC Review' }).count(), 0);
    }
    if (marker !== 'Ki-67') continue;

    const canvas = page.locator('canvas[aria-label="WSI Canvas"]');
    const view = page.getByRole('region', { name: 'Slide Image', exact: true });
    const original = await read(page.request.get('/api/wsi/clinical/' + scanId + '/ihc'));
    const sourceUrl = '/api/wsi/clinical/' + scanId + '/ihc/' + original.results[0].id;
    const sample = await read(page.request.get(sourceUrl + '/cells', { params: {
      left: 0, top: 0, right: original.results[0].dimensions[0], bottom: original.results[0].dimensions[1],
    } }));
    await page.getByRole('button', { name: 'Fit to Window', exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const zoom = Number(await view.getAttribute('data-view-zoom'));
    const cx = Number(await view.getAttribute('data-view-center-x'));
    const cy = Number(await view.getAttribute('data-view-center-y'));
    await canvas.click({ button: 'right', position: { x: box.width / 2 + (sample.points[0][0] - cx) * zoom,
      y: box.height / 2 + (sample.points[0][1] - cy) * zoom } });
    const menu = page.getByRole('group', { name: 'Edit Cell on Slide' });
    await menu.getByRole('button', { name: 'Strong (3+)', exact: true }).click();
    const grade = card.getByRole('combobox', { name: 'User Cell Grade' });
    assert.equal(await grade.inputValue(), '3');
    await card.getByRole('spinbutton', { name: 'Minimum Detection Confidence' }).fill('0.8');
    await card.getByRole('textbox', { name: 'Review Reason' }).fill('Synthetic threshold and grade review');
    await card.getByRole('button', { name: 'Save IHC Review' }).click();
    await card.getByText('Ki-67 Index · 100%', { exact: true }).waitFor();
    await card.getByText('Recount from Stored Detections · Confidence threshold 0.8 · 1 user decisions', { exact: true }).waitFor();
    await page.reload();
    await card.getByText('Ki-67 Index · 100%', { exact: true }).waitFor();
    const versions = card.getByRole('combobox', { name: 'IHC Result Version' });
    await versions.selectOption('0');
    await card.getByText('Ki-67 Index · 66.67%', { exact: true }).waitFor();
    assert.equal(await card.getByRole('button', { name: 'Save IHC Review' }).count(), 0);
    await versions.selectOption('latest');
    await card.getByText('Ki-67 Index · 100%', { exact: true }).waitFor();
    await card.getByRole('textbox', { name: 'Review Reason' }).fill('Synthetic source restoration');
    await card.getByRole('button', { name: 'Restore Original' }).click();
    await card.getByText('Ki-67 Index · 66.67%', { exact: true }).waitFor();
    await card.getByText('IHC Review History', { exact: true }).click();
    await card.getByText('Synthetic source restoration', { exact: true }).waitFor();
    await card.getByText('Synthetic threshold and grade review', { exact: true }).waitFor();
    await evidence.capture(card, 'restored-result-and-audit');
    const after = await read(page.request.get(sourceUrl));
    assert.equal(after.version, 2);
    assert.equal(after.threshold, 0.3);
    assert.equal(after.override_count, 0);
    await read(page.request.post(sourceUrl + '/revisions', { data: { action: 'edit', expected_version: 1,
      request_key: randomUUID(), threshold: 0.4, reason: 'Stale browser tab' } }), 409);
  }
  const denseScan = record.slides.find((scan) => scan.label === 'I-KI').id;
  const densePath = '/api/wsi/clinical/' + denseScan + '/ihc';
  const archive = await read(page.request.get(densePath));
  const source = archive.results[0];
  const [cx, cy] = source.dimensions.map((dimension) => Math.floor(dimension / 2));
  const bx = Math.floor(cx / 2048);
  const by = Math.floor(cy / 2048);
  const overlayURL = densePath + '/' + source.id + '/overlay';
  const requests = [];
  let finishDetail;
  const detailGate = new Promise((resolve) => { finishDetail = resolve; });
  await page.route('**' + densePath, (route) => route.fulfill({
    json: { ...archive, results: [{ ...source, point_count: 6200 }] },
  }));
  await page.route('**' + overlayURL + '*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query.toString());
    if (!query.has('bx')) return route.fulfill({
      json: { step: 512, bins: [[Math.floor(cx / 512) * 512, Math.floor(cy / 512) * 512, 1, 6200]] },
    });
    if (Number(query.get('bx')) !== bx || Number(query.get('by')) !== by) return route.fulfill({
      json: { points: [], next_offset: null },
    });
    const offset = Number(query.get('offset'));
    if (offset) await detailGate;
    const points = Array.from({ length: offset ? 1200 : 5000 }, (_, index) => [cx, cy, 1, offset + index, .9, 1, false]);
    return route.fulfill({ json: { points, next_offset: offset ? null : 5000 } });
  });
  await page.goto('/#viewer/' + caseId + '/' + denseScan);
  await page.reload();
  const layer = page.getByLabel('Ki-67 Cell Overlay', { exact: true });
  await page.waitForFunction(() => document.querySelector('canvas[aria-label="Ki-67 Cell Overlay"]')?.dataset.overlayMode === 'density');
  const zoom = page.getByLabel('Calibrated Magnification');
  const secondPage = page.waitForRequest((request) => request.url().includes(overlayURL) && request.url().includes('offset=5000'));
  await zoom.selectOption('20');
  await secondPage;
  assert.equal(await layer.getAttribute('data-overlay-mode'), 'density');
  finishDetail();
  await page.waitForFunction(() => document.querySelector('canvas[aria-label="Ki-67 Cell Overlay"]')?.dataset.overlayMode === 'cells');
  const before = requests.length;
  await zoom.selectOption('40');
  await page.waitForFunction(() => document.querySelector('.wsi-magnification')?.selectedOptions[0]?.textContent === '40×');
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Fit to Window', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('canvas[aria-label="Ki-67 Cell Overlay"]')?.dataset.overlayMode === 'density');
  assert.equal(requests.length, before, 'Zooming inside cached detail and back to overview must reuse existing data');
  assert.equal(requests.filter((query) => !query.includes('bx=')).length, 1);
  assert.deepEqual(errors, []);
  await evidence.finish();
  console.log('PASS: IHC cards, editing, restore, density fallback, complete paged detail and zoom cache');
} finally {
  await browser.close();
}
