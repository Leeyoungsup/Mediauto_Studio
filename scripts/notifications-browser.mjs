import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const summary = (page) => page.locator('details.request-inbox > summary');

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
  const caseId = record.record_id;
  const notesPath = '/api/clinical/local/cases/' + caseId + '/notes';
  const caseRoute = '/#case/' + caseId;
  await doctor.goto('/#settings/notifications');
  const settings = doctor.getByRole('region', { name: 'Notification Settings' });
  await settings.getByLabel('Mentions Email', { exact: true }).check();
  await settings.getByLabel('Mentions Push', { exact: true }).check();
  await button(settings, 'Save Preferences').click();
  await settings.getByText('Notification preferences saved.', { exact: true }).waitFor();
  await doctor.reload();
  await settings.getByLabel('Mentions Email', { exact: true }).waitFor();
  assert.ok(await settings.getByLabel('Mentions Email', { exact: true }).isChecked());
  assert.ok(await settings.getByLabel('Mentions Push', { exact: true }).isChecked());

  await admin.goto(caseRoute);
  await button(admin, 'Notes').click();
  const notes = admin.getByRole('region', { name: 'Notes and Comments' });
  await button(notes, 'New Note').click();
  await notes.getByRole('textbox', { name: 'Note', exact: true }).fill('Synthetic collaboration note');
  await notes.getByLabel('Mention a User').selectOption('integration-doctor');
  await button(notes, 'Post Note').click();
  await notes.getByText('Synthetic collaboration note @integration-doctor', { exact: true }).waitFor();

  await summary(doctor).click();
  const doctorInbox = doctor.getByRole('region', { name: 'Request Inbox' });
  await button(doctorInbox, 'Refresh Notifications').click();
  const mention = doctorInbox.getByRole('listitem').filter({ hasText: 'You Were Mentioned' });
  await button(mention, 'Open Case').click();
  await doctor.waitForURL((url) => url.hash === `#case/${caseId}/notes`);
  await doctor.getByText('Synthetic collaboration note @integration-doctor', { exact: true }).waitFor();

  const scanId = record.slides.find((item) => item.wsi).id;
  await doctor.goto('/#viewer/' + caseId + '/' + scanId);
  await button(doctor, 'Pan using minimap').waitFor();
  await doctor.getByRole('tab', { name: 'Notes', exact: true }).click();
  const dialog = doctor.getByRole('tabpanel', { name: 'Notes', exact: true });
  await button(dialog, 'Add Comment').click();
  await dialog.getByRole('textbox', { name: 'Comment', exact: true }).fill('Synthetic WSI reply');
  await button(dialog, 'Post Comment').click();
  await dialog.getByText('Synthetic WSI reply', { exact: true }).waitFor();
  await button(dialog, 'Return to Slides').click();
  await button(doctor, 'Pan using minimap').waitFor();
  await doctor.getByRole('tab', { name: 'Notes', exact: true }).click();
  await dialog.getByRole('link', { name: 'Notification Preferences', exact: true }).click();
  await settings.getByLabel('Mentions Email', { exact: true }).waitFor();
  await doctor.getByRole('link', { name: 'Back to Case Notes', exact: true }).click();
  await doctor.waitForURL((url) => url.hash === `#case/${caseId}/notes/${scanId}`);
  await doctor.getByText('Synthetic WSI reply', { exact: true }).waitFor();
  await button(doctor, 'Open Viewer').click();
  await doctor.waitForURL((url) => url.hash === `#viewer/${caseId}/${scanId}`);

  await summary(admin).click();
  const adminInbox = admin.getByRole('region', { name: 'Request Inbox' });
  await button(adminInbox, 'Refresh Notifications').click();
  await adminInbox.getByText('New Case Comment · Unread', { exact: true }).waitFor();

  const statusResponse = await doctor.request.get('/api/clinical/local/notifications');
  assert.equal(statusResponse.status(), 200);
  assert.equal((await statusResponse.json()).deliveries.filter((delivery) => delivery.event === 'mention').length, 2);
  await summary(doctor).click();
  await doctorInbox.getByText('Delivery Status', { exact: true }).click();
  await doctorInbox.getByText('You Were Mentioned · Email · Blocked', { exact: true }).waitFor();
  await doctorInbox.getByText('You Were Mentioned · Push · Blocked', { exact: true }).waitFor();
  await other.goto(caseRoute);
  await other.getByText('Unable to load the case.', { exact: true }).waitFor();
  assert.equal((await other.request.get(notesPath)).status(), 404);
  console.log('PASS: case and viewer notes/comments, scoped mention delivery, persisted channel settings and external delivery status');
} finally {
  await browser.close();
}
