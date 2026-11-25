import { demoEvidence } from './workflow-demo-evidence.mjs';
import assert from 'node:assert/strict';
import { link, mkdtemp, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

async function checked(response, expected = 200) {
  const result = await response;
  assert.equal(result.status(), expected, await result.text());
  return result.json();
}

async function signIn(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1560, height: 950 } });
  page.setDefaultTimeout(18000);
  await checked(page.request.post('/api/auth/login', {
    data: { organization: 'local', username, password: 'synthetic-test-password' },
  }));
  return page;
}

const evidence = demoEvidence('frozen');
const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const scratch = await mkdtemp(join(dataDirectory, '.qa-frozen-'));

try {
  const admin = await signIn('integration-admin');
  const doctor = await signIn('integration-doctor');
  const viewer = await signIn('integration-or');
  await evidence.observe(admin, 'Laboratory administrator');
  await evidence.observe(doctor, 'Frozen pathologist');
  await evidence.observe(viewer, 'OR recipient');
  const prefix = '/api/clinical/local';
  const number = 'FROZEN-QA-' + Date.now();
  const record = await checked(admin.request.post(prefix + '/cases', {
    data: { case_number: number }, headers: { 'Idempotency-Key': number },
  }), 201);
  const url = prefix + '/cases/' + record.id;
  const register = (resource, data) => checked(admin.request.post(prefix + '/' + resource, {
    data, headers: { 'Idempotency-Key': number + '-' + resource },
  }), 201);
  const specimen = await register('specimens', { case_id: record.id, specimen_number: 'FROZEN-A' });
  const slide = await register('slides', { specimen_id: specimen.id, slide_number: 'FROZEN-01' });
  const sampleName = 'frozen-sample.svs';
  await link(join(dataDirectory, 'CODIPAI-BRCA-SS-00194-S-TP-01.svs'), join(scratch, sampleName));
  const scan = await register('scans', { slide_id: slide.id, storage_key: basename(scratch) + '/' + sampleName });
  const scanRoute = `#viewer/${record.id}/${scan.id}`;
  const frozenRoute = `#case/${record.id}/frozen/${scan.id}`;
  const doctorAccount = await checked(doctor.request.get('/api/auth/me'));
  const viewerAccount = await checked(viewer.request.get('/api/auth/me'));
  const assigned = await checked(admin.request.patch(url + '/assignment', {
    data: { assignee_id: doctorAccount.id, version: record.version, reason: 'Synthetic Frozen worklist' },
  }));
  await checked(admin.request.patch(url + '/classification', {
    data: { priority: 'frozen', group_key: null, version: assigned.version, reason: 'Synthetic Frozen section' },
  }));

  await admin.goto('/' + scanRoute);
  await button(admin, 'Pan using minimap').waitFor();
  await admin.getByRole('link', { name: 'Frozen Section', exact: true }).click();
  await admin.waitForURL((target) => target.hash === frozenRoute);
  const manager = admin.getByRole('form', { name: 'Manage OR Recipients' });
  await manager.locator('select').selectOption(viewerAccount.id);
  await manager.getByLabel('Authorization Reason').fill('Synthetic OR recipient authorization');
  await button(manager, 'Authorize Recipient').click();
  await manager.getByRole('button', { name: /^Revoke / }).waitFor();
  await admin.getByRole('link', { name: 'Open OR View', exact: true }).click();
  await admin.getByRole('link', { name: 'Back to Frozen Section', exact: true }).click();
  await admin.waitForURL((target) => target.hash === frozenRoute);
  await manager.getByRole('button', { name: /^Revoke / }).waitFor();
  await button(admin, 'Open Viewer').click();
  await admin.waitForURL((target) => target.hash === scanRoute);
  await button(admin, 'Pan using minimap').waitFor();

  await viewer.goto('/#or');
  const queue = viewer.getByRole('region', { name: 'OR Case Queue' });
  await queue.getByRole('link', { name: number, exact: true }).click();
  const orResult = viewer.getByRole('region', { name: 'OR Case Result' });
  await orResult.getByText('Awaiting publication of a preliminary result.', { exact: true }).waitFor();
  assert.equal((await viewer.request.get(url)).status(), 404);
  assert.equal(await viewer.getByRole('link', { name: 'Back to Frozen Section', exact: true }).count(), 0);

  await doctor.goto('/#worklist/all');
  await doctor.locator('.queue-menu > summary').click();
  await button(doctor.locator('.queue-menu-items'), 'Frozen Section').click();
  await doctor.getByRole('textbox', { name: 'Search Cases' }).fill(number);
  await button(doctor, number).click();
  await doctor.getByRole('link', { name: 'Frozen Report', exact: true }).click();
  const lab = doctor.getByRole('region', { name: 'Frozen Section Workflow' });
  await button(lab, 'New Preliminary Result').click();
  const summary = lab.getByLabel('Preliminary Report Status');
  const firstFinding = 'Synthetic frozen section finding.';
  const amendedFinding = 'Synthetic corrected frozen section finding.';
  const editor = lab.getByRole('form', { name: 'Publish Frozen Result' });
  await editor.getByLabel('Preliminary Findings').fill(firstFinding);
  await editor.getByLabel('Margin Assessment').fill('Synthetic margin assessment.');
  await button(editor, 'Publish Preliminary Result').click();
  await lab.getByRole('heading', { name: 'Preliminary Result · Version 1' }).waitFor();

  await button(orResult, 'Refresh OR Result').click();
  await orResult.getByText(firstFinding, { exact: true }).waitFor();
  await orResult.getByText('Synthetic margin assessment.', { exact: true }).waitFor();
  await orResult.getByText('Awaiting Confirmation', { exact: true }).waitFor();
  await orResult.getByLabel('Confirmation Issue').fill('Synthetic display issue resolved.');
  await button(orResult, 'Record Confirmation Issue').click();
  await orResult.getByRole('status').filter({ hasText: /Confirmation Issue/ }).waitFor();
  await orResult.getByRole('checkbox', { name: 'I have read this version.' }).check();
  await button(orResult, 'Acknowledge Result').click();
  await orResult.getByRole('status').filter({ hasText: /^Acknowledged/ }).waitFor();
  await viewer.reload();
  await orResult.getByRole('status').filter({ hasText: /^Acknowledged/ }).waitFor();

  const callback = lab.getByRole('form', { name: 'Record Telephone Callback' });
  await callback.locator('select').nth(0).selectOption(viewerAccount.id);
  await callback.locator('select').nth(1).selectOption('reached_read_back');
  await callback.getByRole('checkbox', { name: 'Recipient read back this version.' }).check();
  await callback.getByLabel('Callback Note').fill('Synthetic phone read-back completed.');
  await button(callback, 'Save Callback').click();
  await lab.getByText('Synthetic phone read-back completed.', { exact: true }).waitFor();
  await summary.getByText('1/1 Acknowledged', { exact: true }).waitFor();
  await summary.getByText('1 of 1 Attempts', { exact: true }).waitFor();
  await button(orResult, 'Refresh OR Result').click();
  await orResult.getByText(/^Telephone Callback · Reached With Read-back/).waitFor();

  await button(lab, 'Start Correction').click();
  await editor.getByLabel('Preliminary Findings').fill(amendedFinding);
  await editor.getByLabel('Correction Reason').fill('Synthetic amended wording');
  await button(editor, 'Publish Correction').click();
  await lab.getByRole('heading', { name: 'Preliminary Result · Version 2' }).waitFor();
  await summary.getByText('0/1 Acknowledged', { exact: true }).waitFor();
  await summary.getByText('0 of 0 Attempts', { exact: true }).waitFor();
  await lab.getByText('Published Version History', { exact: true }).click();
  await lab.getByText(firstFinding, { exact: true }).waitFor();
  await lab.getByText('Synthetic phone read-back completed.', { exact: true }).waitFor();

  await orResult.getByText(amendedFinding, { exact: true }).waitFor();
  await orResult.getByRole('status').filter({ hasText: /^Awaiting Confirmation$/ }).waitFor();
  await orResult.getByText('Telephone Callback · No Callback Recorded', { exact: true }).waitFor();
  await orResult.getByRole('checkbox', { name: 'I have read this version.' }).check();
  await button(orResult, 'Acknowledge Result').click();
  await orResult.getByRole('status').filter({ hasText: /^Acknowledged/ }).waitFor();

  for (const action of ['frozen_result_published', 'frozen_result_corrected', 'or_result_opened',
    'or_result_acknowledged', 'or_confirmation_failed', 'frozen_callback_recorded']) {
    const logs = await checked(admin.request.get(url + '/logs', { params: { action } }));
    assert.ok(logs.rows.some((row) => row.action === action), 'Missing Case Logs action ' + action);
  }
  await evidence.capture(orResult, 'corrected-and-acknowledged');
  await lab.getByRole('link', { name: 'View Case Logs', exact: true }).click();
  await doctor.getByRole('region', { name: 'Case Log Entries', exact: true }).waitFor();
  await evidence.finish();
  console.log('PASS: Frozen Worklist, preliminary result and margin, scoped OR confirmation and recovery, telephone read-back, correction and Case Logs');
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
