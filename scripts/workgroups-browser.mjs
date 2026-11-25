import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const clinical = '/api/clinical/local';
const entry = 'IMS-QA-QUEUES';
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function login(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1500, height: 1020 } });
  page.setDefaultTimeout(12000);
  const response = await page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  }});
  assert.equal(response.status(), 200, await response.text());
  return { page, user: await response.json() };
}

async function subscribe(page, name) {
  await page.getByText('Global Views', { exact: true }).click();
  await button(page, 'Subscribe to ' + name).click();
  await button(page, 'Unsubscribe from ' + name).waitFor();
  await page.getByText('Global Views', { exact: true }).click();
}

try {
  const { page } = await login('integration-admin');
  const doctor = await login('integration-doctor');
  const other = await login('integration-other');
  let idempotency = 0;
  async function create(category, data) {
    const response = await page.request.post(clinical + '/' + category, {
      data, headers: { 'Idempotency-Key': 'queues-browser-' + ++idempotency },
    });
    assert.equal(response.status(), 201, await response.text());
    return response.json();
  }
  const record = await create('cases', { case_number: entry });
  const specimen = await create('specimens', { case_id: record.id, specimen_number: 'QUEUE-SP' });
  await create('slides', { specimen_id: specimen.id, slide_number: 'QUEUE-SLIDE' });

  await page.goto('/#settings/groups');
  await page.getByLabel('Group Name').fill('Skin');
  await page.getByLabel('Group Key').fill('skin-qa');
  const createdGroup = page.waitForResponse((response) => response.url().endsWith('/api/worklist/workgroups')
    && response.request().method() === 'POST');
  await button(page, 'Create Workgroup').click();
  assert.equal((await createdGroup).status(), 201);
  await page.getByLabel('Workgroup', { exact: true }).locator('option[value="skin-qa"]').waitFor({ state: 'attached' });
  await page.getByLabel('Workgroup', { exact: true }).selectOption('breast');
  await page.getByLabel('Eligible Account').selectOption(doctor.user.id);
  await button(page, 'Add Member').click();
  await button(page, 'Remove Member integration-doctor').waitFor();

  await page.goto('/#case/' + record.id);
  await page.getByText('Workgroup and Priority', { exact: true }).click();
  await page.getByLabel('Case Workgroup').selectOption('breast');
  await page.getByLabel('Case Priority').selectOption('frozen');
  await page.getByLabel('Classification Reason').fill('Synthetic frozen section routing');
  await button(page, 'Save Classification').click();
  await page.getByText('Manual Classification', { exact: true }).waitFor();
  await button(page, 'Assign Case').click();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByRole('option').filter({ hasText: 'integration-other' }).count(), 0);
  await dialog.getByLabel('Assigned Pathologist').selectOption(doctor.user.id);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });

  await page.goto('/');
  await subscribe(page, 'Frozen Section');
  await button(page, 'Frozen Cases').click();
  const list = page.getByRole('region', { name: 'Case List' });
  await list.getByRole('button', { name: entry + ' details', exact: true }).waitFor();
  await list.locator('.priority-badge').filter({ hasText: /^Frozen$/ }).waitFor();
  await page.getByText('Assignment Workload', { exact: true }).click();
  const workload = list.locator('.workload-panel').getByRole('table');
  const row = workload.getByRole('row', { name: /integration-doctor/ });
  assert.deepEqual(await row.getByRole('cell').allTextContents(), ['1', '1', '0', '0', '1', '1']);

  await doctor.page.goto('/');
  await subscribe(doctor.page, 'Breast');
  const again = await login('integration-doctor');
  await again.page.goto('/');
  await button(again.page, 'Breast').click();
  await button(again.page, entry + ' details').waitFor();
  await again.page.getByText('Global Views', { exact: true }).click();
  await button(again.page, 'Unsubscribe from Breast').click();
  await button(again.page, 'Subscribe to Breast').waitFor();
  await again.page.getByText('Global Views', { exact: true }).click();
  await button(again.page, 'Clear Queue').click();
  await button(again.page, 'Breast').waitFor({ state: 'hidden' });

  await other.page.goto('/');
  await other.page.getByText('Global Views', { exact: true }).click();
  await button(other.page, 'Frozen Section').click();
  await other.page.getByText('No cases match these filters.', { exact: true }).waitFor();
  assert.equal((await other.page.request.get('/api/worklist?group_key=breast')).status(), 404);
  assert.equal((await other.page.request.get('/api/worklist/' + record.id)).status(), 404);
  console.log('PASS: workgroup roster, routing and priority, assignment workload, private subscriptions across sessions, and role isolation');
} finally {
  await browser.close();
}
