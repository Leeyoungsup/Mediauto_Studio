import { demoEvidence } from './workflow-demo-evidence.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const prefix = '/api/clinical/local';
const collections = prefix + '/collections';
const button = (root, name) => root.getByRole('button', { name, exact: true });

async function checked(response, status = 200) {
  const result = await response;
  assert.equal(result.status(), status, await result.text());
  return result.json();
}

async function login(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1500, height: 1020 } });
  page.setDefaultTimeout(18000);
  await checked(page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  } }));
  return page;
}

const evidence = demoEvidence('tumor-board');

try {
  const admin = await login('integration-admin');
  const physician = await login('integration-doctor');
  const other = await login('integration-editor-admin');
  await evidence.observe(admin, 'Board organizer');
  await evidence.observe(physician, 'Board attendee');
  await evidence.observe(other, 'Nonmember');
  const errors = [];
  for (const page of [admin, physician, other]) page.on('pageerror', ({ message }) => errors.push(message));
  const me = await checked(physician.request.get('/api/auth/me'));
  const existing = (await checked(admin.request.get('/api/worklist?q=IMS-DEMO-101'))).rows[0];
  const target = await checked(admin.request.get(prefix + '/cases/' + existing.record_id));
  const targetPath = prefix + '/cases/' + target.id;
  if (target.assigned_to !== me.id) {
    await checked(admin.request.patch(targetPath + '/assignment', { data: {
      version: target.version, assignee_id: me.id, reason: 'Synthetic meeting assignment',
    } }));
  }
  const scan = existing.slides.find((row) => row.wsi.format === 'SVS');
  const privateCase = await checked(admin.request.post(prefix + '/cases', { data: { case_number: 'BOARD-QA-RESTRICTED' },
    headers: { 'Idempotency-Key': randomUUID() },
  }), 201);
  const consult = await checked(admin.request.post(targetPath + '/requests', { data: {
    kind: 'consult', question: 'Synthetic Board consultation', scan_id: scan.id, assignee_id: me.id,
  }, headers: { 'Idempotency-Key': randomUUID() } }), 201);
  const requestPath = prefix + '/requests/' + consult.id;
  const started = await checked(physician.request.patch(requestPath, { data: { version: consult.version, action: 'start' } }));
  await checked(physician.request.patch(requestPath, { data: {
    version: started.version, action: 'complete', note: 'Synthetic Board consultation completed.',
  } }));

  await admin.addInitScript(() => {
    window.boardMetrics = { actions: 0, transitions: 0 };
    for (const type of ['click', 'change']) document.addEventListener(type, () => { window.boardMetrics.actions += 1; }, true);
    window.addEventListener('hashchange', () => { window.boardMetrics.transitions += 1; });
  });
  const preparation = performance.now();
  await admin.goto('/#worklist/all');
  await admin.getByRole('link', { name: 'Collections and Tumor Board', exact: true }).click();
  const scope = admin.getByRole('region', { name: 'Collection Detail', exact: true });
  const create = admin.getByRole('form', { name: 'Create Collection' });
  async function createCollection(type, name) {
    if (!await create.isVisible()) await admin.getByText('New Collection or Board', { exact: true }).click();
    await create.getByRole('combobox', { name: 'Collection Type' }).selectOption(type);
    await create.getByRole('textbox', { name: 'Collection Name' }).fill(name);
    await button(create, 'Create Collection').click();
    await scope.getByRole('heading', { name, exact: true }).waitFor();
    return new URL(admin.url()).hash.split('/')[1];
  }
  const personal = await createCollection('personal', 'Board QA Private');
  const shared = await createCollection('shared', 'Board QA Shared');

  const member = admin.getByRole('form', { name: 'Collection Membership' });
  async function grant(heading) {
    await scope.getByText(heading, { exact: true }).click();
    await member.getByRole('combobox', { name: 'Member', exact: true }).selectOption(me.id);
    await button(member, 'Save Member').click();
    await button(scope, 'Revoke ' + me.display_name).waitFor();
  }
  await grant('Manage Members');
  const board = await createCollection('board', 'Board QA Conference');
  await grant('Manage Participants');
  await scope.getByText('New Board Meeting', { exact: true }).click();
  const meetingForm = scope.getByRole('form', { name: 'Create Board Meeting' });
  await meetingForm.getByRole('textbox', { name: 'Meeting Title' }).fill('Board QA Session');
  await meetingForm.getByLabel('Meeting Date').fill('2026-12-01');
  await button(meetingForm, 'Create Board Meeting').click();
  await scope.getByRole('heading', { name: 'Board QA Session', exact: true }).waitFor();
  const meeting = new URL(admin.url()).hash.split('/')[1];

  async function addFromWorklist(caseNumber, destination, note) {
    await admin.goto('/#worklist/all');
    await button(admin, 'Restore Default Worklist').click();
    const search = admin.getByRole('textbox', { name: 'Search Cases' });
    await search.fill(caseNumber);
    await button(admin, caseNumber).click();
    const preview = admin.getByRole('complementary', { name: 'Selected Case Preview' });
    await button(preview, 'Add to Collection or Board').click();
    const dialog = admin.getByRole('dialog', { name: 'Add Case Reference' });
    await dialog.getByRole('combobox', { name: 'Add To' }).selectOption(destination);
    await dialog.getByRole('textbox', { name: 'Collection Note' }).fill(note);
    await button(dialog, 'Add Case Reference').click();
    await dialog.getByRole('status').filter({ hasText: 'Case reference saved.' }).waitFor();
    await button(dialog, 'Close').click();
  }
  await addFromWorklist(target.case_number, personal, 'Synthetic personal note');
  await addFromWorklist(target.case_number, shared, 'Synthetic shared note');
  await addFromWorklist(target.case_number, meeting, 'Synthetic conference note');
  await addFromWorklist(privateCase.case_number, meeting, 'Synthetic restricted note');

  await admin.goto('/#collections/' + meeting);
  const agendaItem = (scope, name) => scope.locator('.collection-entry').filter({ hasText: name });
  const first = agendaItem(scope, target.case_number);
  const second = agendaItem(scope, privateCase.case_number);
  await button(second, 'Move Earlier').click();
  await admin.waitForFunction((number) => document.querySelector('.collection-entry a')?.textContent === number, privateCase.case_number);
  await button(first, 'Edit Note').click();
  await first.getByRole('textbox', { name: 'Edit Collection Note' }).fill('Synthetic conference note revised');
  await button(first, 'Save Note').click();
  await first.getByRole('textbox', { name: 'Edit Collection Note' }).waitFor({ state: 'hidden' });
  await first.locator('.collection-note').filter({ hasText: 'Synthetic conference note revised' }).waitFor();
  const presented = admin.waitForResponse((response) =>
    response.request().method() === 'PATCH' && response.url().includes('/entries/'));
  await button(first, 'Mark Presented').click();
  await checked(presented);
  await first.getByText('Presented', { exact: true }).waitFor();
  await evidence.capture(first, 'presented-agenda');
  const preparationSeconds = Math.round((performance.now() - preparation) / 100) / 10;
  const metrics = await admin.evaluate(() => window.boardMetrics);

  await physician.goto('/#collections/' + personal);
  await physician.getByRole('alert').getByText('Collection not found.').waitFor();
  await physician.goto('/#collections/' + shared);
  await physician.getByText('Synthetic shared note', { exact: true }).waitFor();
  await physician.goto('/#collections/' + meeting);
  const attending = physician.getByRole('region', { name: 'Collection Detail', exact: true });
  const permitted = agendaItem(attending, target.case_number);
  await permitted.getByText('Presented', { exact: true }).waitFor();
  assert.equal(await attending.getByText('Synthetic restricted note', { exact: true }).count(), 0);
  assert.equal(await button(permitted, 'Edit Note').count(), 0);
  await button(permitted, 'Slides and Completed Results').click();
  await permitted.getByRole('link', { name: /SVS/ }).click();
  await physician.waitForFunction((id) => document.querySelector('.image-panel')?.dataset.scanId === id, scan.id);
  await physician.getByRole('button', { name: 'Pan using minimap', exact: true }).waitFor();
  await physician.goBack();
  await button(permitted, 'Slides and Completed Results').click();
  await permitted.getByRole('link', { name: 'Completed Consultation', exact: true })
    .and(physician.locator('a[href="#request/' + consult.id + '"]')).click();
  await physician.getByText('Synthetic Board consultation completed.', { exact: true }).waitFor();

  await other.goto('/#collections/' + meeting);
  await other.getByRole('alert').getByText('Collection not found.').waitFor();
  await physician.goto('/#collections/' + meeting);
  await permitted.getByText('Presented', { exact: true }).waitFor();
  await admin.goto('/#collections/' + board);
  await scope.getByText('Manage Participants', { exact: true }).click();
  await button(scope, 'Revoke ' + me.display_name).click();
  await physician.getByRole('alert').getByText('Collection not found.').waitFor();
  assert.equal(await physician.getByText('Synthetic conference note revised', { exact: true }).count(), 0);
  await checked(physician.request.get(collections + '/' + meeting), 404);
  assert.deepEqual(errors, []);
  await evidence.finish();
  console.log('PASS: personal/shared collections, Worklist references, Board ordering/note/Presented, WSI and completed result, intersection and live revocation');
  console.log('Synthetic browser preparation:', { seconds: preparationSeconds, ...metrics });
} finally {
  await browser.close();
}
