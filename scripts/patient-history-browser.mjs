import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const clinical = '/api/clinical/local';
const integration = '/api/integration/local';
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

async function check(request, status = 200) {
  const response = await request;
  assert.equal(response.status(), status, await response.text());
  return response.json();
}

async function signIn(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(12000);
  await check(page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  } }));
  return page;
}

try {
  const admin = await signIn('integration-admin');
  const doctor = await signIn('integration-doctor');
  const outsider = await signIn('integration-other');
  const { rows } = await check(admin.request.get('/api/worklist?q=IMS-DEMO-101'));
  const record = rows[0];
  const caseId = record.record_id;
  const historyPath = `${clinical}/cases/${caseId}/patient-history`;
  const caseRoute = '/#case/' + caseId;
  await doctor.goto(caseRoute);
  await button(doctor, 'History').click();
  const history = doctor.getByRole('region', { name: 'Patient History Records' });
  await history.getByText('Link a local patient to this case to open patient history.').waitFor();
  await history.getByText('EMR · Not Configured', { exact: true }).waitFor();

  const patient = await check(admin.request.post(clinical + '/patients', {
    headers: { 'Idempotency-Key': 'history-23-browser-patient' },
    data: { display_name: 'Synthetic History Patient' },
  }), 201);
  const linked = await check(admin.request.patch(`${clinical}/cases/${caseId}/patient`, {
    data: { target_id: patient.id, version: record.version, reason: 'Synthetic History browser fixture' },
  }));
  await button(history, 'Refresh History').click();
  await button(history, 'Add Clinical Record').click();
  await history.getByLabel('Clinical Date').fill('2026-11-20');
  await history.getByLabel('Title', { exact: true }).fill('Local synthetic encounter');
  await history.getByLabel('Clinical Text').fill('Manual follow-up text.\nSecond line <b>rendered as text</b>.');
  await button(history, 'Save Clinical Record').click();
  await history.getByRole('status').filter({ hasText: 'Clinical record saved.' }).waitFor();
  await history.getByText('Manual follow-up text.', { exact: false }).waitFor();
  assert.equal(await history.locator('.history-document-text b').count(), 0);

  async function send(data, state) {
    const message = await check(admin.request.post(integration + '/connections/emr/messages', { data }), 202);
    for (let n = 0; n < 60; n++) {
      const inbox = await check(admin.request.get(integration + '/messages'));
      if (inbox.some((item) => item.id === message.id && item.state === state)) return;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    assert.fail('The integration inbox did not reach the expected state');
  }

  await check(admin.request.put(integration + '/connections/emr', { data: { version: 0, mode: 'mock' } }));
  await send({ message_id: 'HIST-BROWSER-PAT', resource: 'patient', external_id: 'SYNTH-HIST-23-MRN', revision: 1,
    data: { display_name: 'Synthetic History Patient' } }, 'pending_link');
  await button(history, 'Refresh History').click();
  await history.getByText('after an operator confirms the patient match', { exact: false }).waitFor();
  await send({ message_id: 'HIST-BROWSER-DOC', resource: 'history', external_id: 'SYNTH-HIST-23-DOC', revision: 1,
    data: { patient_external_id: 'SYNTH-HIST-23-MRN', kind: 'diagnostic_report', occurred_on: '2026-11-23',
      title: 'External synthetic diagnostic report', body: 'External clinical text.' } }, 'applied');
  await button(history, 'Refresh History').click();
  await history.getByText('Local synthetic encounter', { exact: true }).first().waitFor();
  assert.equal(await history.getByText('External synthetic diagnostic report', { exact: true }).count(), 0);
  await check(admin.request.post(`${integration}/cases/${caseId}/patient-confirm`, {
    data: { external_id: 'SYNTH-HIST-23-MRN', case_version: linked.version, patient_version: patient.version,
      source_revision: 1, reason: 'Synthetic patient match confirmed' },
  }));

  await button(history, 'Refresh History').click();
  await history.getByText('External clinical text.', { exact: true }).waitFor();
  await history.getByText('No records received for this patient.', { exact: true }).waitFor();
  await check(admin.request.put(integration + '/connections/emr', { data: { version: 1, mode: 'mock', scenario: 'timeout' } }));
  await check(admin.request.post(integration + '/connections/emr/probe'), 503);
  await button(history, 'Refresh History').click();
  await history.getByText('EMR (Mock) · Connection Unavailable', { exact: true }).waitFor();
  await history.getByText('External clinical text.', { exact: true }).waitFor();

  const scanId = record.slides.find((entry) => entry.wsi).id;
  const viewerRoute = '/#viewer/' + caseId + '/' + scanId;
  await doctor.goto(viewerRoute);
  await button(doctor, 'Pan using minimap').waitFor();
  const canvas = doctor.getByLabel('WSI Canvas', { exact: true });
  const prior = await canvas.elementHandle();
  const slide = doctor.getByRole('region', { name: 'Slide Image' });
  const fitZoom = Number(await slide.getAttribute('data-view-zoom'));
  await button(doctor, 'Zoom In').click();
  await doctor.waitForFunction((fit) => Number(document.querySelector('.image-panel').dataset.viewZoom) > fit, fitZoom);
  const zoom = await slide.getAttribute('data-view-zoom');
  await doctor.locator('.viewer-case-tools summary').click();
  await button(doctor, 'Patient History').click();
  const dialog = doctor.getByRole('dialog', { name: 'Patient History' });
  await dialog.getByText('External clinical text.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: /Local synthetic encounter/ }).click();
  await dialog.getByText('Manual follow-up text.', { exact: false }).waitFor();
  await button(dialog, 'Close History').click();
  assert.ok(await canvas.evaluate((node, before) => node === before, prior));
  assert.equal(await slide.getAttribute('data-view-zoom'), zoom);

  await outsider.goto(viewerRoute);
  await outsider.getByText('Unable to load the case.', { exact: true }).waitFor();
  assert.equal(await button(outsider, 'Patient History').count(), 0);
  await check(outsider.request.get(historyPath), 404);
  console.log('PASS: patient history in case and WSI, manual entry, confirmed match, source date, absent source, timeout fallback and read denial');
} finally {
  await browser.close();
}
