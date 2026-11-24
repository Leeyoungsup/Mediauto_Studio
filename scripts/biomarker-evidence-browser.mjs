import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const clinical = '/api/clinical/local';
async function read(request) {
  const response = await request;
  assert.ok(response.ok(), await response.text());
  return response.json();
}

try {
  const page = await browser.newPage({ baseURL: process.env.MEDIAUTO_DEMO_URL, viewport: { width: 1520, height: 1010 } });
  page.setDefaultTimeout(18000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await read(page.request.post('/api/auth/login', {
    data: { organization: 'local', username: 'integration-admin', password: 'synthetic-test-password' },
  }));
  const { rows } = await read(page.request.get('/api/worklist?q=IMS-DEMO-MULTI'));
  const record = rows.find((row) => row.case_number === 'IMS-DEMO-MULTI');
  assert.ok(record);
  const her2Scan = record.slides.find((scan) => scan.label === 'I-HR').id;
  const pdl1Scan = record.slides.find((scan) => scan.label === 'S-TP').id;
  async function setStain(scanId, stain) {
    const scan = await read(page.request.get(clinical + '/scans/' + scanId));
    const slide = await read(page.request.get(clinical + '/slides/' + scan.slide_id));
    await read(page.request.patch(clinical + '/editor/slides/' + slide.id, {
      data: { slide_number: slide.slide_number, version: slide.version, block_id: slide.block_id,
        stain, reason: 'Synthetic biomarker contract fixture' },
    }));
  }
  await setStain(her2Scan, 'HER2');
  await setStain(pdl1Scan, 'PD-L1');
  await page.goto('/#viewer/' + record.record_id + '/' + her2Scan);
  const her2 = page.getByRole('region', { name: 'IHC Results' });
  const analyses = her2.getByRole('combobox', { name: 'IHC Source Analysis' });
  await analyses.selectOption({ label: await analyses.locator('option').filter({ hasText: /HER2/ }).textContent() });
  await her2.getByText('HER2 Composite · 12.5', { exact: true }).waitFor();
  await her2.getByText('Membrane Staining Patterns', { exact: true }).waitFor();
  await her2.getByText('Complete Strong · 1', { exact: true }).waitFor();
  await page.locator('canvas[aria-label="HER2 Cell Overlay"]').waitFor();
  await her2.getByText('Result Contract and Validation', { exact: true }).click();
  await her2.getByText('SYNTH-HER2', { exact: true }).waitFor();
  const her2Results = await read(page.request.get('/api/wsi/clinical/' + her2Scan + '/ihc'));
  assert.equal(her2Results.results.find((item) => item.marker === 'her2').source_value, undefined);
  await her2.getByRole('spinbutton', { name: 'Minimum Detection Confidence' }).fill('0.4');
  await her2.getByRole('textbox', { name: 'Review Reason' }).fill('Synthetic HER2 change');
  await her2.getByRole('button', { name: 'Save IHC Review' }).click();
  await her2.getByText('Edited HER2 Score Unverified', { exact: true }).waitFor();
  await her2.getByRole('textbox', { name: 'Review Reason' }).fill('Synthetic HER2 restore');
  await her2.getByRole('button', { name: 'Restore Original' }).click();
  await her2.getByText('HER2 Composite · 12.5', { exact: true }).waitFor();

  const pdl = page.getByRole('region', { name: 'PD-L1 Results', exact: true });
  await page.goto('/#viewer/' + record.record_id + '/' + pdl1Scan);
  const route = '/api/wsi/clinical/' + pdl1Scan + '/pdl1';
  const data = await read(page.request.get(route));
  const originals = data.results.filter((item) => item.kind === 'original');
  assert.equal(originals.length, 2);
  assert.ok(data.comparison.pair.reference_results_verified);
  const versions = pdl.getByRole('combobox', { name: 'Result Version' });
  await versions.selectOption(originals.find((item) => item.score_type === 'CPS').id);
  const card = page.getByRole('complementary', { name: 'PD-L1 Score Card', exact: true });
  await card.getByText('75', { exact: true }).waitFor();
  await card.getByText('25%', { exact: true }).waitFor();
  await pdl.getByText('Combined Display Validation Evidence', { exact: true }).click();
  await pdl.getByText('Both reference results verified', { exact: false }).waitFor();
  await pdl.getByText('Result Contract and Validation', { exact: true }).click();
  await pdl.getByText('SYNTH-CPS', { exact: true }).waitFor();
  await versions.selectOption(data.results.find((item) => item.kind === 'edited').id);
  await card.getByText('Edited Score Unverified', { exact: true }).waitFor();
  await pdl.getByRole('button', { name: 'View Original' }).click();
  await card.getByText('75', { exact: true }).waitFor();

  const scratch = process.env.MEDIAUTO_BIOMARKER_TEST_DIR;
  const { pdl1 } = JSON.parse(await readFile(join(scratch, 'biomarker-evidence-location.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(pdl1, 'utf8'));
  await writeFile(pdl1, JSON.stringify(evidence.slice(0, 1)));
  await page.reload();
  await pdl.getByText('Displaying CPS and TPS together requires verified input conditions and validation evidence for this scan.').waitFor();
  const rejected = await read(page.request.get(route));
  assert.equal(rejected.comparison.pair, null);
  assert.ok(rejected.results.every((item) => item.score === null && item.evidence === null));
  assert.deepEqual(errors, []);
  console.log('PASS: explicit HER2 membrane patterns and verified Composite; HER2 edit and restore; CPS/TPS reference results, original link and evidence revocation');
} finally {
  await browser.close();
}
