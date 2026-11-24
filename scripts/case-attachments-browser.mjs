import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const pdf = process.env.MEDIAUTO_QA_PDF;
const photo = process.env.MEDIAUTO_QA_GROSS;
const pdfName = basename(pdf);

async function signIn(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1560, height: 950 } });
  page.setDefaultTimeout(15000);
  const login = await page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  } });
  assert.equal(login.status(), 200, await login.text());
  return page;
}

try {
  const admin = await signIn('integration-admin');
  const assigned = await signIn('integration-doctor');
  const other = await signIn('integration-other');
  const { rows } = await (await admin.request.get('/api/worklist?q=IMS-DEMO-101')).json();
  const record = rows[0];
  const caseId = record.record_id;
  const path = '/api/clinical/local/cases/' + caseId + '/attachments';
  const caseRoute = '/#case/' + caseId;
  const scanId = record.slides.find((item) => item.wsi).id;
  const viewerRoute = '/#viewer/' + caseId + '/' + scanId;
  const extra = await admin.request.post('/api/clinical/local/specimens', {
    headers: { 'Idempotency-Key': 'attachment-qa-specimen' },
    data: { case_id: caseId, specimen_number: 'SYNTH-B' },
  });
  assert.equal(extra.status(), 201, await extra.text());

  await admin.goto(caseRoute);
  await button(admin, 'Media').click();
  const media = admin.getByRole('region', { name: 'Media Attachments' });
  await media.getByText('No PDF documents attached to this case.', { exact: true }).waitFor();
  await button(media, 'Attach PDF').click();
  await media.getByLabel('Attachment File').setInputFiles({ name: 'damaged.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\ncorrupt') });
  await button(media, 'Upload Attachment').click();
  await media.getByRole('alert').filter({ hasText: /PDF is damaged/ }).waitFor();
  await media.getByLabel('Attachment File').setInputFiles(pdf);
  await button(media, 'Upload Attachment').click();
  await media.getByRole('img', { name: 'PDF page 1', exact: true }).waitFor();
  await admin.route('**/preview?page=2', (route) => route.fulfill({ status: 503, json: { detail: 'Synthetic preview error.' } }), { times: 1 });
  await button(media, 'Next Page').click();
  await media.getByText('Synthetic preview error.', { exact: false }).waitFor();
  await button(media, 'Retry Preview').click();
  await media.getByRole('img', { name: 'PDF page 2', exact: true }).waitFor();
  const downloading = admin.waitForEvent('download');
  await button(media, 'Download Attachment').click();
  const downloaded = await downloading;
  assert.equal(downloaded.suggestedFilename(), pdfName);
  assert.deepEqual(await readFile(await downloaded.path()), await readFile(pdf));
  await button(media, 'Attachment Activity').click();
  await media.getByText(/^Downloaded · integration-admin ·/).waitFor();

  await assigned.goto(viewerRoute);
  await button(assigned, 'Pan using minimap').waitFor();
  const canvas = assigned.getByLabel('WSI Canvas', { exact: true });
  const before = await canvas.elementHandle();
  await button(assigned, 'Media').click();
  const mediaDialog = assigned.getByRole('dialog', { name: 'Media', exact: true });
  await mediaDialog.getByRole('img', { name: 'PDF page 1', exact: true }).waitFor();
  await button(mediaDialog, 'Close Attachments').click();
  await button(assigned, 'Gross Images').click();
  const gross = assigned.getByRole('dialog', { name: 'Gross Images', exact: true });
  await button(gross, 'Add Gross Image').click();
  await gross.getByLabel('Target Specimen').selectOption({ label: 'Specimen SYNTH-A' });
  await gross.getByLabel('Attachment File').setInputFiles(photo);
  await button(gross, 'Upload Attachment').click();
  await gross.getByRole('img', { name: 'Gross specimen photograph', exact: true }).waitFor();
  await gross.getByLabel('Filter by Specimen').selectOption({ label: 'Specimen SYNTH-B' });
  await gross.getByText('No gross images for this selection.', { exact: true }).waitFor();
  await gross.getByLabel('Filter by Specimen').selectOption({ label: 'Specimen SYNTH-A' });
  await gross.getByRole('img', { name: 'Gross specimen photograph', exact: true }).waitFor();
  await button(gross, 'Close Attachments').click();
  assert.ok(await canvas.evaluate((node, prior) => node === prior, before));

  await admin.reload();
  await button(admin, 'Gross Images').click();
  await admin.getByRole('img', { name: 'Gross specimen photograph', exact: true }).waitFor();
  await other.goto(caseRoute);
  await other.getByText('Unable to load the case.', { exact: true }).waitFor();
  assert.equal(await button(other, 'Media').count(), 0);
  assert.equal((await other.request.get(path + '/pdf')).status(), 404);
  console.log('PASS: case and WSI attachments, PDF pages and corruption recovery, specimen upload and filtering, download audit and access denial');
} finally {
  await browser.close();
}
