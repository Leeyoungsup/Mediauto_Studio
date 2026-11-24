import { demoEvidence } from './workflow-demo-evidence.mjs';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const clinical = '/api/clinical/local';
const original = 'CODIPAI-STBX-SS-04364-S-EB-01.ndpi';
const replacement = 'CODIPAI-STOP-SS-01376-I-PD-22.ndpi';
const caseNumber = 'IMS-QA-EDITOR';
const button = (page, name) => page.getByRole('button', { name, exact: true });

const evidence = demoEvidence('general-intake');

try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1500, height: 1020 } });
  page.setDefaultTimeout(15000);
  await evidence.observe(page, 'Intake administrator');
  const login = await page.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-editor-admin', password: 'synthetic-test-password',
  }});
  assert.equal(login.status(), 200, await login.text());
  const patient = await page.request.post(clinical + '/patients', {
    headers: { 'Idempotency-Key': 'case-editor-qa-patient' },
    data: { display_name: 'Synthetic Intake Patient', local_reference: 'QA-LOCAL-EDITOR' },
  });
  assert.equal(patient.status(), 201, await patient.text());

  await page.goto('/#scans');
  await button(page, original + ' Enter Manually').click();
  const intake = page.getByRole('region', { name: 'Enter Slide Details' });
  for (const [label, value] of [
    ['Case ID', caseNumber], ['Slide ID', 'QA-SLIDE'], ['Specimen', 'QA-SPECIMEN'], ['Block Number', 'B1'],
    ['Stain Code', 'HE'], ['Barcode', 'QC-STALE'], ['Medical Record Number (MRN)', 'QA-LOCAL-EDITOR'],
    ['Patient Name', 'Synthetic Intake Patient'],
  ]) await intake.getByLabel(label, { exact: true }).fill(value);
  await button(page, 'Save Slide Details').click();
  await page.getByText('Slide details saved.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Worklist', exact: true }).click();
  await button(page, 'Restore Default Worklist').click();
  await page.getByLabel('Search Cases').fill(caseNumber);
  await button(page, caseNumber + ' details').click();
  await button(page, 'Confirm Case from Registered Files').click();
  const dialog = page.getByRole('dialog');
  await button(dialog, 'Find Existing Patient').click();
  await dialog.getByText('Local Patient Record', { exact: true }).waitFor();
  await dialog.getByRole('checkbox', { name: 'I verified this is the same patient' }).check();
  await button(dialog, 'Confirm').click();
  await page.getByRole('heading', { name: 'Case Editor', exact: true }).waitFor();
  const caseId = new URL(page.url()).hash.split('/')[1];

  await page.getByText(/^Specimen F1 · QA-SPECIMEN$/).click();
  await page.getByText('Block B1', { exact: true }).waitFor();
  await page.getByText(/^QA-SLIDE · HE · 1 scans$/).click();
  await page.route('**/label.jpeg', (route) => route.fulfill({ status: 404, contentType: 'application/json',
    body: JSON.stringify({ detail: 'Synthetic label read failure.' }) }), { times: 1 });
  await page.getByText(original + ' · NDPI · Unassessed', { exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic label read failure.' }).waitFor();
  await button(page, 'Retry Label').click();
  const uploaded = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/label?version='));
  await page.getByLabel('Label Image').setInputFiles(process.env.MEDIAUTO_QA_LABEL);
  await button(page, 'Upload Label').click();
  assert.equal((await uploaded).status(), 200);
  await page.getByText('Uploaded Label', { exact: true }).waitFor();

  const viewer = await browser.newPage({ baseURL, storageState: await page.context().storageState() });
  await viewer.goto('/#viewer/' + caseId);
  await button(viewer, 'Viewer Settings').click();
  await viewer.getByLabel('Show label image').check();
  await viewer.getByRole('img', { name: 'Scan label', exact: true }).waitFor({ timeout: 15000 });
  await viewer.getByRole('complementary', { name: 'Scan Images' }).getByText('Uploaded', { exact: true }).waitFor();
  await viewer.close();

  if (process.env.MEDIAUTO_TESSERACT) {
    await page.getByLabel('OCR Reason').fill('Synthetic label verification');
    const ocr = page.waitForResponse((response) => response.url().endsWith('/ocr'));
    await button(page, 'Read Label with OCR').click();
    const response = await ocr;
    assert.equal(response.status(), 200, await response.text());
    await page.getByRole('status').filter({ hasText: 'OCR Candidate (Tesseract)' }).waitFor();
    await page.getByText('Saved barcode was not found in this candidate.', { exact: false }).waitFor();
    assert.equal(await page.getByLabel('Confirmed Label Text').inputValue(), '');
    await button(page, 'Use Candidate After Review').click();
    assert.match(await page.getByLabel('Confirmed Label Text').inputValue(), /QA-EDITOR-21/);
  } else {
    await page.getByLabel('Confirmed Label Text').fill('QA-EDITOR-21');
  }
  const slideForm = page.locator('form').filter({ has: button(page, 'Save Slide Details') });
  await slideForm.getByLabel('Barcode').fill('QA-EDITOR-21');
  await slideForm.getByLabel('Reason for Change').fill('Verified physical label');
  const edited = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/editor/slides/'));
  await button(slideForm, 'Save Slide Details').click();
  assert.equal((await edited).status(), 200);
  await page.getByText('Slide History', { exact: true }).click();
  await page.getByText('Slide Edited', { exact: true }).waitFor();

  await page.getByLabel('Structure Check Reason').fill('Verify scan structure');
  await button(page, 'Check Scan Structure').click();
  await page.getByText('Scan structure check passed.', { exact: true }).waitFor();
  await page.getByLabel('QC Source').selectOption('ai');
  await page.getByLabel('QC Outcome').selectOption('hold');
  await page.getByLabel('Provider / Version').fill('Synthetic QC v1');
  await page.getByLabel('Result Reference').fill('QC-QA-21');
  await page.getByLabel('QC Reason').fill('Synthetic external observation');
  const observed = page.waitForResponse((response) => response.url().endsWith('/qc'));
  await button(page, 'Record QC').click();
  assert.equal((await (await observed).json()).qc_status, 'unassessed');
  await page.getByText('Scan History', { exact: true }).click();
  await page.getByText('Synthetic QC v1 · QC-QA-21', { exact: true }).waitFor();

  await page.getByLabel('QC Source').selectOption('manual');
  await page.getByLabel('QC Outcome').selectOption('rescan_required');
  await page.getByLabel('QC Reason').fill('Request a replacement scan');
  await button(page, 'Record QC').click();
  await page.getByLabel('Replacement Path Under data/').waitFor();
  await button(page, 'Open Viewer').and(page.locator(':disabled')).waitFor();
  const held = (await (await page.request.get(clinical + '/editor/cases/' + caseId)).json()).scans[0];
  assert.equal((await page.request.get('/api/wsi/clinical/' + held.id)).status(), 409);
  await page.getByLabel('Replacement Path Under data/').fill(replacement);
  await page.getByLabel('Replacement Reason').fill('Register the replacement scan');
  const replaced = page.waitForResponse((response) => response.url().endsWith('/replacement'));
  await button(page, 'Register Replacement').click();
  const result = await replaced;
  assert.equal(result.status(), 201, await result.text());
  assert.equal((await result.json()).replaces_id, held.id);
  await page.getByText(replacement + ' · NDPI · Unassessed', { exact: true }).waitFor();
  await button(page, 'Open Viewer').click();
  await button(page, 'Pan using minimap').waitFor();
  await evidence.finish();
  const labelVerification = process.env.MEDIAUTO_TESSERACT ? 'OCR-assisted label confirmation' : 'manual label confirmation';
  console.log('PASS: intake patient match, block and barcode editing, label retry, ' + labelVerification +
    ' and uploaded label in WSI, QC evidence, blocked review and real NDPI replacement');
} finally {
  await browser.close();
}
