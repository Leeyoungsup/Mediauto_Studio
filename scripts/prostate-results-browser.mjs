import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clinical = '/api/clinical/local';
async function read(request) {
  const response = await request;
  assert.ok(response.ok(), await response.text());
  return response.json();
}
async function signIn(page, username) {
  await read(page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  } }));
}

try {
  const page = await browser.newPage({ baseURL: process.env.MEDIAUTO_DEMO_URL, viewport: { width: 1520, height: 1010 } });
  page.setDefaultTimeout(18000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, 'integration-admin');
  const { rows } = await read(page.request.get('/api/worklist?q=IMS-DEMO-MULTI'));
  const record = rows.find((row) => row.case_number === 'IMS-DEMO-MULTI');
  assert.ok(record);
  const caseId = record.record_id;
  const scans = [];

  for (const label of ['I-KI', 'I-PR']) {
    const id = record.slides.find((scan) => scan.label === label).id;
    const scan = await read(page.request.get(clinical + '/scans/' + id));
    const slide = await read(page.request.get(clinical + '/slides/' + scan.slide_id));
    await read(page.request.patch(clinical + '/editor/slides/' + slide.id, {
      data: { slide_number: slide.slide_number, version: slide.version, block_id: slide.block_id,
        stain: 'H&E', reason: 'Synthetic prostate result integration test' },
    }));
    scans.push({ file: scan.storage_key, id, binding: { case_id: caseId, specimen_id: slide.specimen_id,
      slide_id: slide.id, block_id: slide.block_id } });
  }
  const fixture = JSON.parse(execFileSync(process.env.MEDIAUTO_PROSTATE_TEST_PYTHON, [
    '-s', resolve(root, 'scripts/seed-prostate-fixtures.py'), process.env.MEDIAUTO_PROSTATE_TEST_DIR, JSON.stringify(scans),
  ], { cwd: resolve(root, 'backend'), env: { ...process.env, PYTHONPATH: resolve(root, 'backend') }, encoding: 'utf8' }));

  const apiFor = (id) => '/api/wsi/clinical/' + id + '/prostate';
  const panel = page.getByRole('region', { name: 'Prostate AI Results', exact: true });
  async function open(id) {
    await page.goto('/#viewer/' + caseId + '/' + id);
    await page.getByRole('button', { name: 'Prostate AI', exact: true }).click();
  }
  await open(scans[0].id);
  await panel.getByRole('button', { name: 'Return to WSI' }).click();
  await page.waitForFunction(() => document.activeElement?.matches('canvas[aria-label="WSI Canvas"]'));
  const analysis = panel.getByRole('combobox', { name: 'Prostate Analysis' });
  await analysis.waitFor();
  assert.equal(await analysis.inputValue(), fixture.archives.newer);
  const tumorLength = panel.locator('dl.prostate-findings > div').filter({ hasText: 'Tumor Length' });
  await tumorLength.getByText('Reference Verification Required', { exact: true }).waitFor();
  await analysis.selectOption(fixture.archives['1']);
  await tumorLength.getByText('0.75 mm · Single Focus · Source 750 µm', { exact: true }).waitFor();
  await panel.getByText('Not Identified', { exact: true }).waitFor();
  await panel.getByText('3.5 mm · Core Axis', { exact: true }).waitFor();
  const grades = panel.locator('dl.prostate-findings > div').filter({ hasText: 'Grade Group' });
  await grades.getByText('2', { exact: true }).waitFor();
  const overlay = page.locator('svg[aria-label="Prostate AI Regions"]');
  const tumor = overlay.locator('polygon[data-region="Focus-A"]');
  await tumor.waitFor();
  const before = await tumor.getAttribute('points');
  await panel.getByRole('button', { name: 'Tumor · Focus-A', exact: true }).click();
  const viewport = page.getByRole('region', { name: 'Slide Image', exact: true });
  const data = await read(page.request.get(apiFor(scans[0].id)));
  const result = data.results.find((item) => item.id === fixture.archives['1']);
  const coords = result.core_levels[0].regions.find((region) => region.id === 'Focus-A').points;
  const range = coords.map(([x]) => x);
  const expected = (Math.max(...range) + Math.min(...range)) / 2;
  await page.waitForFunction((expected) => Math.abs(Number(document.querySelector('[data-view-center-x]')?.dataset.viewCenterX) - expected) < 2, expected);
  assert.notEqual(await tumor.getAttribute('points'), before);
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click();
  const center = Number(await viewport.getAttribute('data-view-center-x'));
  assert.ok(Math.abs(center - expected) < 2);
  const select = panel.getByRole('combobox', { name: 'Core and Level' });
  await select.selectOption('1');
  await tumor.waitFor({ state: 'detached' });
  await overlay.locator('polygon[data-region="Tissue-B"]').waitFor();
  await grades.getByText('No Output for This Core and Level', { exact: true }).waitFor();

  await open(scans[1].id);
  await panel.getByRole('combobox', { name: 'Core and Level' }).getByText('Core A · Level 2', { exact: true }).waitFor({ state: 'attached' });
  await panel.getByText('0 mm · Sum of Foci', { exact: true }).waitFor();
  await grades.getByText('Model Does Not Support This Output', { exact: true }).waitFor();
  await tumor.waitFor({ state: 'detached' });
  await panel.getByRole('checkbox', { name: 'Region Overlay' }).uncheck();
  await overlay.waitFor({ state: 'detached' });
  await panel.getByRole('checkbox', { name: 'Region Overlay' }).check();
  await overlay.waitFor();
  await writeFile(fixture.evidence['2'], '[]', 'utf8');
  await panel.getByRole('button', { name: 'Refresh Prostate Results' }).click();
  await tumorLength.getByText('Reference Verification Required', { exact: true }).waitFor();

  assert.equal((await page.request.get(apiFor(record.slides.find((scan) => scan.label === 'I-HR').id))).status(), 200);
  const other = await browser.newPage({ baseURL: process.env.MEDIAUTO_DEMO_URL });
  assert.equal((await other.request.get(apiFor(scans[0].id))).status(), 401);
  await signIn(other, 'integration-other');
  assert.equal((await other.request.get(apiFor(scans[0].id))).status(), 404);
  assert.deepEqual(errors, []);
  console.log('PASS: Prostate Core/Level and model versions, WSI region coordinates across zoom and scan switch, length units, Grade Group, explicit PNI, missing outputs, evidence revocation and scope');
} finally {
  await browser.close();
}
