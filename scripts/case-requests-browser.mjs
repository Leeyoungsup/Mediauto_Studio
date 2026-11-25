import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const clinical = '/api/clinical/local';
const captured = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function signIn(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => captured.push(error.message));
  const response = await page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  }});
  assert.equal(response.status(), 200, await response.text());
  return { page, user: await response.json() };
}

async function act(page, action, input) {
  await button(page, action).click();
  if (input) await input();
  await button(page, 'Save Action').click();
}

async function state(page, label) {
  await page.getByRole('heading', { name: label, exact: true }).waitFor();
}

async function openNotice(page, title) {
  await page.locator('details.request-inbox > summary').click();
  const notice = page.getByRole('region', { name: 'Request Inbox' });
  await button(notice, 'Refresh Notifications').click();
  await button(notice.getByRole('listitem').filter({ hasText: title }).first(), 'Open Request').click();
}

try {
  const admin = await signIn('integration-admin');
  const doctor = await signIn('integration-doctor');
  const consultant = await signIn('integration-other');
  const rows = await (await admin.page.request.get('/api/worklist?q=IMS-DEMO-101')).json();
  const caseId = rows.rows[0].record_id;
  const scan = rows.rows[0].slides.find((item) => item.wsi.format === 'SVS').wsi.id;
  const createUrl = `${clinical}/cases/${caseId}/requests`;

  await doctor.page.goto('/#viewer/' + caseId + '/' + scan);
  await button(doctor.page, 'Pan using minimap').waitFor();
  const canvas = doctor.page.getByLabel('WSI Canvas', { exact: true });
  const prior = await canvas.elementHandle();
  await doctor.page.getByRole('tab', { name: 'Requests', exact: true }).click();
  const panel = doctor.page.getByRole('tabpanel', { name: 'Requests' });
  await button(panel, 'Return to Slides').click();
  assert.ok(await canvas.evaluate((node, earlier) => node === earlier, prior));
  await button(doctor.page, 'Analysis and Consultation Requests').click();
  await button(panel, 'New Request').click();
  assert.equal(await panel.getByLabel('Target Scan').inputValue(), scan);
  await doctor.page.getByLabel('Request Details').fill('Synthetic consultation request');
  await doctor.page.route('**/cases/*/requests', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const committed = await route.fetch();
    assert.equal(committed.status(), 201);
    await route.abort();
  }, { times: 1 });
  await button(doctor.page, 'Create Request').click();
  await doctor.page.getByRole('alert').waitFor();
  await button(doctor.page, 'Create Request').click();
  await panel.getByRole('link', { name: 'Open Created Request' }).click();
  await state(doctor.page, 'Awaiting Assignment');
  const requestId = new URL(doctor.page.url()).hash.split('?')[0].split('/').at(-1);
  await doctor.page.getByRole('main').getByRole('link', { name: 'Notification Preferences' }).click();
  await doctor.page.getByRole('region', { name: 'Notification Settings' }).waitFor();
  await doctor.page.getByRole('link', { name: 'Back to Request' }).click();
  await state(doctor.page, 'Awaiting Assignment');
  await doctor.page.getByRole('link', { name: 'Back to Viewer Requests' }).click();
  await panel.getByText('Synthetic consultation request', { exact: true }).click();
  await state(doctor.page, 'Awaiting Assignment');
  assert.equal((await (await doctor.page.request.get(createUrl)).json()).requests.length, 1);

  await act(doctor.page, 'Assign Request', () => doctor.page.getByLabel('Request Assignee').selectOption(consultant.user.id));
  await state(doctor.page, 'Assigned');
  await consultant.page.goto('/');
  await openNotice(consultant.page, 'Request Assigned');
  await state(consultant.page, 'Assigned');
  await consultant.page.locator('details.request-inbox > summary').click();
  const inbox = consultant.page.getByRole('region', { name: 'Request Inbox' });
  await inbox.getByLabel('This Request Only').check();
  await inbox.getByText(/^Request Assigned/).first().waitFor();
  await consultant.page.locator('details.request-inbox > summary').click();
  assert.equal(await consultant.page.getByRole('link', { name: 'Back to Viewer Requests' }).count(), 0);
  const requestPath = `${clinical}/requests/${requestId}`;
  assert.equal((await consultant.page.request.get('/api/worklist/' + caseId)).status(), 404);
  assert.equal((await consultant.page.request.get('/api/wsi/clinical/' + scan)).status(), 404);
  await button(consultant.page, 'Open Request Scan').click();
  await consultant.page.getByRole('button', { name: 'Pan using minimap' }).waitFor();
  assert.equal((await consultant.page.request.get(requestPath + '/wsi/2/0/0.jpeg')).status(), 200);
  await act(consultant.page, 'Start Processing');
  await state(consultant.page, 'In Progress');
  await act(consultant.page, 'Record Failure', () => consultant.page.getByLabel('Failure Reason').fill('Synthetic retry verification'));
  await state(consultant.page, 'Failed');
  assert.equal((await consultant.page.request.get(requestPath + '/wsi')).status(), 404);

  await openNotice(doctor.page, 'Request Failed');
  await state(doctor.page, 'Failed');
  await act(doctor.page, 'Reopen Request');
  await state(doctor.page, 'Awaiting Assignment');
  await act(doctor.page, 'Assign Request', () => doctor.page.getByLabel('Request Assignee').selectOption(consultant.user.id));
  await state(doctor.page, 'Assigned');
  await consultant.page.reload();
  await act(consultant.page, 'Start Processing');
  await state(consultant.page, 'In Progress');
  await act(consultant.page, 'Complete Request', () => consultant.page.getByLabel('Consultation Response').fill('Synthetic consultation response'));
  await state(consultant.page, 'Completed');

  await openNotice(doctor.page, 'Request Completed');
  await state(doctor.page, 'Completed');
  await doctor.page.getByRole('link', { name: 'Open Report Draft References' }).click();
  await state(doctor.page, 'Report Draft References');
  await doctor.page.getByText('Synthetic consultation response', { exact: true }).waitFor();

  await admin.page.goto('/#case/' + caseId + '/requests');
  await button(admin.page, 'New Request').click();
  await admin.page.getByLabel('Request Type').selectOption('ai');
  await admin.page.getByLabel('Target Scan').selectOption(scan);
  await admin.page.getByLabel('Request Assignee').selectOption(admin.user.id);
  await admin.page.getByLabel('Request Details').fill('Synthetic PD-L1 result reference');
  await button(admin.page, 'Create Request').click();
  await state(admin.page, 'Assigned');
  await act(admin.page, 'Start Processing');
  await state(admin.page, 'In Progress');
  await act(admin.page, 'Complete Request', async () => {
    const field = admin.page.getByLabel('Archived AI Result');
    const edited = field.locator('option').filter({ hasText: 'User Edit' });
    await edited.waitFor({ state: 'attached' });
    await field.selectOption(await edited.getAttribute('value'));
  });
  await state(admin.page, 'Completed');
  await admin.page.getByRole('link', { name: 'Open Report Draft References' }).click();
  await state(admin.page, 'Report Draft References');
  await admin.page.getByText('request-browser-fixture', { exact: true }).waitFor();
  await admin.page.getByRole('link', { name: 'Open Result in WSI Viewer' }).click();
  await state(admin.page, 'WSI Viewer');
  await admin.page.getByRole('region', { name: 'PD-L1 Results' }).getByText('request-browser-fixture', { exact: true }).waitFor();
  const exactReference = new URL(admin.page.url()).hash.split('/').at(-1);
  assert.equal(await admin.page.getByLabel('Result Version').inputValue(), exactReference);
  assert.notEqual(await admin.page.getByLabel('Result Version').locator('option').first().getAttribute('value'), exactReference);
  assert.deepEqual(captured, []);
  console.log('PASS: request creation recovery, scoped consultation WSI, assignment and failure retry, inbox, PD-L1 snapshot and report references');
} finally {
  await browser.close();
}
