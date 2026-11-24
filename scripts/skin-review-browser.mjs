import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clinical = '/api/clinical/local';
async function read(request, expected = 200) {
  const response = await request;
  assert.equal(response.status(), expected, await response.text());
  return response.json();
}
async function signIn(page, username) {
  await read(page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  } }));
}

try {
  const page = await browser.newPage({ baseURL: process.env.MEDIAUTO_DEMO_URL, viewport: { width: 1520, height: 1010 } });
  page.setDefaultTimeout(22000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, 'integration-admin');
  const { rows } = await read(page.request.get('/api/worklist?q=IMS-DEMO-MULTI'));
  const record = rows.find((row) => row.case_number === 'IMS-DEMO-MULTI');
  assert.ok(record);
  const scans = [];
  for (const label of ['I-KI', 'I-PR']) {
    const id = record.slides.find((scan) => scan.label === label).id;
    const scan = await read(page.request.get(clinical + '/scans/' + id));
    const slide = await read(page.request.get(clinical + '/slides/' + scan.slide_id));
    await read(page.request.patch(clinical + '/editor/slides/' + slide.id, {
      data: { slide_number: slide.slide_number, version: slide.version, block_id: slide.block_id,
        stain: 'H&E', reason: 'Synthetic skin review fixture' },
    }));
    scans.push({ id, file: scan.storage_key, binding: { case_id: record.record_id, specimen_id: slide.specimen_id,
      slide_id: slide.id, block_id: slide.block_id } });
  }

  const source = JSON.parse(execFileSync(process.env.MEDIAUTO_SKIN_TEST_PYTHON, [
    '-s', resolve(root, 'scripts/seed-skin-fixture.py'), process.env.MEDIAUTO_SKIN_TEST_DIR, JSON.stringify(scans[0]),
  ], { cwd: resolve(root, 'backend'), env: { ...process.env, PYTHONPATH: resolve(root, 'backend') }, encoding: 'utf8' }));

  const apiFor = (id) => '/api/wsi/clinical/' + id + '/skin';
  const viewer = (id) => '/#viewer/' + record.record_id + '/' + id;
  const panel = page.getByRole('region', { name: 'Skin and Melanoma Review', exact: true });
  const overlay = page.locator('svg[aria-label="Skin Review Overlay"]');
  const count = (name) => panel.locator('dl.key-values > div').filter({ has: page.getByText(name, { exact: true }) }).locator('dd');
  const reason = panel.getByRole('textbox', { name: 'Review Reason' });
  async function open(id) {
    await page.goto(viewer(id));
    await page.getByRole('button', { name: 'Skin Review', exact: true }).click();
  }
  await open(scans[0].id);
  await overlay.locator('[data-layer="orientation"]').waitFor({ state: 'attached' });
  await overlay.locator('[data-layer="epidermis"]').waitFor();
  const heatmap = overlay.locator('[data-layer="density"]');
  await heatmap.waitFor();
  const initialX = await heatmap.getAttribute('x');
  await panel.getByRole('button', { name: 'Focus Count Field' }).click();
  await page.waitForFunction((previous) => {
    const position = document.querySelector('svg[aria-label="Skin Review Overlay"] [data-layer="density"]')?.getAttribute('x');
    return position != null && position !== previous;
  }, initialX);
  const observed = await overlay.evaluate((svg) => {
    const view = svg.closest('[data-view-zoom]');
    const canvas = view.querySelector('canvas[aria-label="WSI Canvas"]');
    const cell = svg.querySelector('[data-layer="density"]');
    return { centerX: Number(view.dataset.viewCenterX), zoom: Number(view.dataset.viewZoom),
      width: canvas.clientWidth, left: Number(cell.getAttribute('x')) };
  });
  const projection = await read(page.request.get(apiFor(scans[0].id) + '/' + source.id));
  const expectedX = observed.width / 2 + (projection.heatmap[0].bounds[0] - observed.centerX) * observed.zoom;
  assert.ok(Math.abs(expectedX - observed.left) < 1);
  await panel.getByRole('checkbox', { name: /Model Heatmap/ }).uncheck();
  await heatmap.waitFor({ state: 'detached' });
  await panel.getByRole('checkbox', { name: /Model Heatmap/ }).check();
  await heatmap.waitFor();
  await reason.fill('Synthetic candidate review');
  await panel.getByRole('combobox', { name: 'Decision for Mitosis-A' }).selectOption('confirmed');
  await count('Reviewed Density').getByText('5 confirmed/mm²', { exact: true }).waitFor();
  await count('Reference Comparison').getByText(/1 reference · 0 difference/).waitFor();
  await panel.getByRole('combobox', { name: 'Decision for Mitosis-B' }).selectOption('rejected');
  await count('Rejected').getByText('1', { exact: true }).waitFor();

  const resultPath = apiFor(scans[0].id) + '/' + source.id;
  const latest = await read(page.request.get(resultPath));
  const correction = { action: 'decide', candidate_id: 'Mitosis-B', window_id: 'Hotspot-A', status: 'pending',
    reason: 'Synthetic replay', expected_version: latest.version, request_key: randomUUID() };
  const [one, two] = await Promise.all([read(page.request.post(resultPath + '/revisions', { data: correction })),
    read(page.request.post(resultPath + '/revisions', { data: correction }))]);
  assert.deepEqual(one, two);
  await read(page.request.post(resultPath + '/revisions', { data: { ...correction, request_key: randomUUID() } }), 409);

  await page.reload();
  await page.getByRole('button', { name: 'Skin Review', exact: true }).click();
  await panel.getByText('Skin Review History', { exact: true }).click();
  await panel.getByText(/Synthetic replay/).waitFor();
  assert.equal((await read(page.request.get(clinical + '/cases/' + record.record_id + '/logs', {
    params: { entity: 'skin_review_revision' },
  }))).rows.length, 3);
  await writeFile(source.validation, '[]', 'utf8');
  await panel.getByRole('button', { name: 'Reload Skin Review' }).click();
  await count('Reviewed Density').getByText('5 confirmed/mm²', { exact: true }).waitFor();
  assert.equal(await count('Reference Comparison').count(), 0);

  await open(scans[1].id);
  await panel.getByRole('combobox', { name: 'Analysis Source' }).getByText('Manual Review', { exact: true }).waitFor({ state: 'attached' });
  await reason.fill('Synthetic manual-only review');
  await panel.getByRole('button', { name: 'Place Count Field' }).click();
  const canvas = page.locator('canvas[aria-label="WSI Canvas"]');
  await canvas.click();
  await count('Area').getByText('0.2 mm²', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Focus Count Field' }).click();
  await panel.getByRole('button', { name: 'Mark Mitosis' }).click();
  await canvas.click();
  await count('Reviewed Density').getByText('5 confirmed/mm²', { exact: true }).waitFor();
  await overlay.locator('[data-status="confirmed"]').waitFor();

  const foreign = await browser.newPage({ baseURL: process.env.MEDIAUTO_DEMO_URL });
  await signIn(foreign, 'integration-other');
  await read(foreign.request.get(apiFor(scans[0].id)), 404);
  await writeFile(source.archive, '{}', 'utf8');
  const degraded = await read(page.request.get(apiFor(scans[0].id)));
  assert.equal(degraded.status, 'archive_unavailable');
  assert.ok(degraded.manual_id);
  assert.deepEqual((await read(page.request.get(apiFor(scans[0].id) + '/' + degraded.manual_id))).windows, []);
  assert.deepEqual(errors, []);
  console.log('PASS: skin orientation/region/heatmap alignment, candidate edits, audited versions, reference withdrawal, calibrated manual-only marks and archive recovery');
} finally {
  await browser.close();
}
