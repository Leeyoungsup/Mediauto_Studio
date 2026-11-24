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
  async function create(resource, data, operator = page) {
    const response = await operator.request.post(clinical + '/' + resource, {
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
  const columnSearch = columns.getByRole('textbox', { name: 'Search Columns', exact: true });
  await columnSearch.fill('registered');
  await columns.getByRole('checkbox', { name: 'Registered At', exact: true }).waitFor();
  assert.equal(await columns.getByRole('checkbox', { name: 'Specimen', exact: true }).count(), 0);
  await columnSearch.clear();
  await columns.getByRole('checkbox', { name: 'Specimen', exact: true }).uncheck();
  await columns.getByRole('checkbox', { name: 'Registered At', exact: true }).check();
  await button(page, 'Review Status up').click();
  await button(page, 'Save My Default Columns').click();
  await page.getByRole('status').filter({ hasText: 'Worklist defaults saved.' }).waitFor();
  await columns.locator('summary').click();
  const headerText = await table(page).getByRole('columnheader').allTextContents();
  assert.deepEqual(headerText, ['Case ID', 'Review Status', 'Assignee', 'Slides', 'Accessioned At', 'Registered At', 'Open']);
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
  const adminPage = next.page;
  const sampleName = 'IMS-QA-ADVANCED';
  const patient = await create('patients', {
    display_name: 'Synthetic Advanced', birth_date: '2006-10-01', local_reference: 'ADV-LOCAL-QA', sex: 'female',
  }, adminPage);
  const sample = await create('cases', {
    case_number: sampleName, patient_id: patient.id, accessioned_at: '2024-10-04T15:15:00Z',
  }, adminPage);
  const specimen = await create('specimens', { case_id: sample.id, specimen_number: 'COLLECTION-QA' }, adminPage);
  await create('slides', { specimen_id: specimen.id, slide_number: 'SCAN-QA' }, adminPage);
  await button(adminPage, 'Restore Default Worklist').click();
  await adminPage.getByLabel('Search Cases').fill(sampleName);
  await button(adminPage, sampleName + ' details').click();
  await adminPage.getByText('Case and Specimen Dates', { exact: true }).click();
  await adminPage.getByLabel('COLLECTION-QA Collection Date').fill('2024-09-30');
  const savedCollection = adminPage.waitForResponse((response) => response.url().endsWith('/collection-date') && response.ok());
  await button(adminPage, 'Save Collection Date').click();
  await savedCollection;
  await button(adminPage, 'Worklist').click();
  await adminPage.getByRole('heading', { name: 'Worklist', exact: true }).waitFor();

  function more(page) {
    return page.getByRole('button', { name: /^More Filters/ });
  }
  await more(adminPage).click();
  await adminPage.getByRole('textbox', { name: 'Patient Name', exact: true }).fill('Synthetic Advanced');
  await adminPage.getByLabel('MRN or Local Patient ID').fill('ADV-LOCAL-QA');
  await adminPage.getByRole('textbox', { name: 'Specimen', exact: true }).fill('collection-qa');
  await adminPage.getByLabel('Slide ID').fill('scan-qa');
  await adminPage.getByLabel('Maximum Age at Collection').fill('17');
  await adminPage.getByLabel('From Date').fill('2024-10-05');
  await adminPage.getByLabel('Through Date').fill('2024-10-05');
  await adminPage.getByLabel('Recent Activity').selectOption('today');
  await button(adminPage, 'Apply Filters').click();
  const resultRow = table(adminPage).getByRole('row').filter({ hasText: sampleName });
  await resultRow.waitFor();
  assert.equal(await table(adminPage).locator('tbody tr').count(), 1);

  const advancedColumns = adminPage.locator('details.column-menu:not(.sort-menu)');
  await advancedColumns.locator('summary').click();
  for (const name of ['Patient Name', 'Age at Collection', 'Collection Date', 'Last Opened', 'Data Source']) {
    await advancedColumns.getByRole('checkbox', { name, exact: true }).check();
  }
  await advancedColumns.locator('summary').click();
  await resultRow.getByRole('cell', { name: '17', exact: true }).waitFor();
  assert.equal(await resultRow.getByText('2024-09-30', { exact: true }).getAttribute('title'), 'Earliest Recorded Specimen Collection Date');
  await resultRow.getByText('IMS Clinical Record', { exact: true }).waitFor();

  await adminPage.getByText('Multi-Level Sort', { exact: true }).click();
  await adminPage.getByLabel('1: Sort Field').selectOption('age');
  await button(adminPage, 'Save My Default Sort').click();
  await adminPage.getByRole('status').filter({ hasText: 'Worklist defaults saved.' }).waitFor();
  await adminPage.getByLabel('1: Sort Field').selectOption('last_opened');
  await button(adminPage, 'Restore Default Sort').click();
  assert.equal(await adminPage.getByLabel('1: Sort Field').inputValue(), 'age');
  await adminPage.getByText('Multi-Level Sort', { exact: true }).click();
  await save(adminPage, 'Advanced Private View');
  await button(adminPage, 'Set as Startup View').click();
  await adminPage.getByRole('status').filter({ hasText: 'Worklist defaults saved.' }).waitFor();

  const restored = (await login('integration-admin')).page;
  await restored.goto('/');
  await table(restored).getByRole('row').filter({ hasText: sampleName }).getByRole('cell', { name: '17', exact: true }).waitFor();
  assert.equal(await table(restored).locator('tbody tr').count(), 1);
  await restored.getByRole('button', { name: 'Remove Age at Collection: ≤ 17', exact: true }).click();
  await button(restored, 'Reapply View').click();
  await restored.getByRole('button', { name: 'Remove Age at Collection: ≤ 17', exact: true }).waitFor();
  await more(restored).click();
  await restored.getByLabel('Maximum Age at Collection').fill('16');
  await button(restored, 'Apply Filters').click();
  await restored.getByText('No cases match these filters.', { exact: true }).waitFor();
  await button(restored, 'Restore Default Worklist').click();
  assert.equal(await restored.getByLabel('Search Cases').inputValue(), '');
  await restored.getByText('Multi-Level Sort', { exact: true }).click();
  assert.equal(await restored.getByLabel('1: Sort Field').inputValue(), 'age');
  assert.equal((await doctor.page.request.post('/api/worklist/search', { data: { patient_name: 'Synthetic Advanced' } })).ok(), true);
  assert.equal((await (await doctor.page.request.post('/api/worklist/search', {
    data: { patient_name: 'Synthetic Advanced', age_max: 17 },
  })).json()).total, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: Worklist saved views across browser sessions, column order/preferences, sorting with filters and pagination, shared-view RBAC, advanced filters and provenance, and sort restore');
} finally {
  await browser.close();
}
