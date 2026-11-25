import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

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
  const doctor = await signIn('integration-doctor');
  const other = await signIn('integration-other');
  const { rows } = await (await admin.request.get('/api/worklist?q=IMS-DEMO-101')).json();
  const record = rows[0];
  const scanId = record.slides.find((entry) => entry.wsi.format === 'SVS').id;
  const caseRoute = '/#case/' + record.record_id;
  const viewerRoute = '/#viewer/' + record.record_id + '/' + scanId;
  const apiPath = '/api/clinical/local/cases/' + record.record_id + '/logs';
  const scanPath = '/api/wsi/clinical/' + scanId;
  const logsRow = (scope, action) => scope.getByRole('row').filter({ hasText: action });

  await doctor.route('**' + scanPath, (route) => route.fulfill({ status: 503, json: { detail: 'Synthetic audit open failure.' } }), { times: 1 });
  const failed = doctor.waitForResponse((response) => response.url().endsWith(scanPath + '/view-events') &&
    response.request().postDataJSON().result === 'failed');
  await doctor.goto(viewerRoute);
  await doctor.getByText('Synthetic audit open failure.', { exact: true }).waitFor();
  assert.equal((await failed).status(), 204);
  const viewed = doctor.waitForResponse((response) => response.url().endsWith(scanPath + '/view-events') &&
    response.request().postDataJSON().result === 'success');
  await button(doctor, 'Retry').click();
  assert.equal((await viewed).status(), 204);
  await button(doctor, 'Pan using minimap').waitFor();

  const canvas = doctor.getByLabel('WSI Canvas', { exact: true });
  await button(doctor, 'Rectangular ROI').click();
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await doctor.mouse.move(x - 15, y - 15);
  await doctor.mouse.down();
  await doctor.mouse.move(x + 30, y + 20, { steps: 3 });
  await doctor.mouse.up();
  await doctor.getByRole('textbox', { name: 'Annotation Name', exact: true }).fill('Synthetic Audit Initial');
  const created = doctor.waitForResponse((response) => response.url().endsWith(scanPath + '/viewer-records/annotations') &&
    response.request().method() === 'POST');
  await button(doctor, 'Save Annotation').click();
  const annotation = await (await created).json();
  const entry = doctor.locator('.viewer-record-list li').filter({ hasText: 'Synthetic Audit Initial' });
  await button(entry, 'Edit Name').click();
  await doctor.getByLabel('Updated Annotation Name').fill('Synthetic Audit Revised');
  await button(doctor, 'Save Name').click();
  const updated = doctor.locator('.viewer-record-list li').filter({ hasText: 'Synthetic Audit Revised' });
  await updated.waitFor();
  doctor.once('dialog', (dialog) => dialog.accept());
  await button(updated, 'Delete').click();
  await updated.waitFor({ state: 'detached' });

  await doctor.getByRole('tab', { name: 'Case Logs', exact: true }).click();
  const dialog = doctor.getByRole('tabpanel', { name: 'Case Logs', exact: true }).getByRole('region', { name: 'Case Logs', exact: true });
  await dialog.getByLabel('User').selectOption({ label: 'integration-doctor' });
  await dialog.getByLabel('Action').selectOption({ label: 'Updated Annotation' });
  await dialog.getByLabel('Entity').selectOption({ label: 'Annotation' });
  await dialog.getByLabel('Result').selectOption({ label: 'Succeeded' });
  await dialog.getByLabel('Target ID').fill(annotation.id);
  const filtered = doctor.waitForResponse((response) => response.url().includes('action=annotation_updated'));
  await button(dialog, 'Apply Filters').click();
  assert.equal((await filtered).status(), 200);
  await dialog.getByRole('row').nth(2).waitFor({ state: 'hidden' });
  await logsRow(dialog, 'Updated Annotation').waitFor();
  assert.equal(await dialog.getByRole('row').count(), 2);
  await logsRow(dialog, 'Updated Annotation').getByText('View Details', { exact: true }).click();
  await logsRow(dialog, 'Updated Annotation').getByText(/Synthetic Audit Initial/).waitFor();
  await logsRow(dialog, 'Updated Annotation').getByText(/Synthetic Audit Revised/).waitFor();
  await button(dialog, 'Clear Filters').click();
  await dialog.getByLabel('Action').selectOption({ label: 'Viewed Scan' });
  await dialog.getByLabel('Result').selectOption({ label: 'Failed' });
  await button(dialog, 'Apply Filters').click();
  await dialog.getByRole('cell', { name: 'Failed', exact: true }).first().waitFor();
  await button(dialog, 'Return to Slides').click();

  await other.goto(caseRoute);
  await other.getByText('Unable to load the case.', { exact: true }).waitFor();
  assert.equal((await other.request.get(apiPath)).status(), 404);
  await admin.goto(caseRoute);
  await button(admin, 'Case Logs').click();
  const caseLogs = admin.getByRole('dialog', { name: 'Case Logs' });
  await caseLogs.getByLabel('User').selectOption({ label: 'integration-other' });
  await caseLogs.getByLabel('Result').selectOption({ label: 'Denied' });
  await button(caseLogs, 'Apply Filters').click();
  await caseLogs.getByRole('cell', { name: 'Denied · HTTP 404', exact: true }).first().waitFor();
  console.log('PASS: case and WSI logs, rendered and failed opens, annotation create/edit/delete snapshots, combined filters and scoped denial');
} finally {
  await browser.close();
}
