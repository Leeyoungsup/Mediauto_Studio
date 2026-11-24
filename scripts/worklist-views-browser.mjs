import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const prefix = 'IMS-QA-SAVED-';
const clinical = '/api/clinical/local';
const views = '/api/worklist/views';
const errors = [];

async function login(username) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1500, height: 1020 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  const result = await context.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  }});
  assert.equal(result.status(), 200, await result.text());
  return { page, context, user: await result.json() };
}

function button(page, name) {
  return page.getByRole('button', { name, exact: true });
}

function table(page) {
  return page.getByRole('region', { name: 'Case List', exact: true }).getByRole('table');
}

async function rows(page, suffixes) {
  const expected = suffixes.map((id) => prefix + id);
  await page.waitForFunction((expected) =>
    JSON.stringify([...document.querySelectorAll('.worklist-panel tbody button.case-id')].map((node) => node.textContent)) === JSON.stringify(expected), expected);
}

async function choose(page, name, visibility, starting = false) {
  await page.getByLabel('Saved View', { exact: true }).selectOption({ label: name + ' · ' + visibility + (starting ? ' · Startup' : '') });
}

async function save(page, name, shared = false, includeColumns = true) {
  await button(page, 'Save New View').click();
  await page.getByLabel('View Name').fill(name);
  if (shared) await page.getByLabel('Visibility').selectOption('shared');
  await page.getByRole('checkbox', { name: 'Include current columns' }).setChecked(includeColumns);
  await button(page, 'Save View').click();
  await page.getByRole('status').filter({ hasText: 'View saved.' }).waitFor();
  await button(page, 'Close').click();
}

try {
  const first = await login('integration-admin');
  const { page } = first;
  const doctor = await login('integration-doctor');
  const other = await login('integration-other');
  let seed = 0;
  async function create(resource, data) {
    const response = await page.request.post(clinical + '/' + resource, {
      data, headers: { 'Idempotency-Key': 'saved-view-fixture-' + ++seed },
    });
    assert.equal(response.status(), 201, await response.text());
    return response.json();
  }
  async function assign(operator, record, account) {
    const response = await operator.request.patch(`${clinical}/cases/${record.id}/assignment`, {
      data: { assignee_id: account.user.id, version: record.version, reason: 'Synthetic Worklist verification' },
    });
    assert.equal(response.status(), 200, await response.text());
  }
  const records = {};
  for (const [suffix, slides] of [['C', 2], ['A', 1], ['B', 2], ['EXCLUDED', 3]]) {
    records[suffix] = await create('cases', { case_number: prefix + suffix });
    const specimen = await create('specimens', { case_id: records[suffix].id, specimen_number: 'QA-SP' });
    for (let i = 0; i < slides; i++) await create('slides', { specimen_id: specimen.id, slide_number: 'QA-' + i });
  }
  await assign(page, records.EXCLUDED, other);
  await page.goto('/');
  await page.getByLabel('Search Cases').fill(prefix);
  await page.getByLabel('Filter by Review Status').selectOption('Awaiting Assignment');
  await page.getByText('Multi-Level Sort', { exact: true }).click();
  await page.getByLabel('1: Sort Field').selectOption('slide_count');
  await page.getByLabel('1: Sort Direction').selectOption('desc');
  await button(page, 'Add Sort Level').click();
  await page.getByLabel('2: Sort Field').selectOption('case_number');
  await page.getByLabel('2: Sort Direction').selectOption('desc');
  await rows(page, ['C', 'B', 'A']);
  await page.getByLabel('2: Sort Direction').selectOption('asc');
  await rows(page, ['B', 'C', 'A']);
  await page.getByText('Multi-Level Sort', { exact: true }).click();
  const params = new URLSearchParams({ q: prefix, status: 'registered', offset: '1', limit: '1' });
  params.append('order', 'slide_count:desc');
  params.append('order', 'case_number:asc');
  const pageWithOrder = await page.request.get('/api/worklist?' + params);
  assert.equal(pageWithOrder.status(), 200, await pageWithOrder.text());
  assert.deepEqual((await pageWithOrder.json()).rows.map(({ case_number }) => case_number), [prefix + 'C']);
  assert.equal((await page.request.get('/api/worklist?order=case_number:asc&order=case_number:desc')).status(), 422);

  const columns = page.locator('details.column-menu:not(.sort-menu)');
  await columns.locator('summary').click();
  await columns.getByRole('checkbox', { name: 'Specimen', exact: true }).uncheck();
  await columns.getByRole('checkbox', { name: 'Registered At', exact: true }).check();
  await button(page, 'Review Status up').click();
  await button(page, 'Save My Default Columns').click();
  await page.getByRole('status').filter({ hasText: 'Worklist defaults saved.' }).waitFor();
  await columns.locator('summary').click();
  const headerText = await table(page).getByRole('columnheader').allTextContents();
  assert.deepEqual(headerText, ['Case ID', 'Review Status', 'Assignee', 'Slides', 'Received At', 'Registered At', 'Open']);
  await save(page, 'Personal Filters');
  await button(page, 'Set as Startup View').click();
  await page.getByRole('status').filter({ hasText: 'Worklist defaults saved.' }).waitFor();

  await page.getByLabel('Filter by Review Status').selectOption('');
  await save(page, 'Organization Filters', true, false);
  const available = await (await page.request.get(views)).json();
  const shared = available.find(({ visibility }) => visibility === 'shared');
  assert.equal(shared.configuration.columns, null);
  await first.context.close();

  const next = await login('integration-admin');
  await next.page.goto('/');
  await rows(next.page, ['B', 'C', 'A']);
  assert.equal(await next.page.getByLabel('Search Cases').inputValue(), prefix);
  assert.equal(await next.page.getByLabel('Filter by Review Status').inputValue(), 'Awaiting Assignment');
  assert.equal(await next.page.getByLabel('Saved View', { exact: true }).inputValue(), available.find(({ visibility }) => visibility === 'private').id);
  assert.deepEqual(await table(next.page).getByRole('columnheader').allTextContents(), headerText);
  await next.page.getByText('Multi-Level Sort', { exact: true }).click();
  assert.equal(await next.page.getByLabel('1: Sort Field').inputValue(), 'slide_count');
  assert.equal(await next.page.getByLabel('2: Sort Field').inputValue(), 'case_number');
  await next.page.getByText('Multi-Level Sort', { exact: true }).click();
  await choose(next.page, 'Organization Filters', 'Organization');
  await rows(next.page, ['EXCLUDED', 'B', 'C', 'A']);
  assert.deepEqual(await table(next.page).getByRole('columnheader').allTextContents(), headerText);

  await assign(next.page, records.A, doctor);

  await doctor.page.goto('/');
  await choose(doctor.page, 'Organization Filters', 'Organization');
  await rows(doctor.page, ['A']);
  assert.equal(await doctor.page.getByLabel('Saved View', { exact: true }).getByText('Personal Filters', { exact: false }).count(), 0);
  assert.equal(await button(doctor.page, 'Edit Selected View').count(), 0);
  assert.ok((await table(doctor.page).getByRole('columnheader').allTextContents()).includes('Specimen'));
  assert.equal((await doctor.page.request.delete(`${views}/${shared.id}?version=${shared.version}`)).status(), 403);
  await save(doctor.page, 'Pathologist Personal View', false, false);
  assert.equal(await button(doctor.page, 'Edit Selected View').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: Worklist saved views across browser sessions, column order/preferences, sorting with filters and pagination, and shared-view RBAC');
} finally {
  await browser.close();
}
