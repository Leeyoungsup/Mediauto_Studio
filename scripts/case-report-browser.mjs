import assert from 'node:assert/strict';
import { demoEvidence } from './workflow-demo-evidence.mjs';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const evidence = demoEvidence('general-report');

async function signIn(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1560, height: 950 } });
  page.setDefaultTimeout(18000);
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
  await evidence.observe(admin, 'Assignment and report administrator');
  await evidence.observe(doctor, 'Assigned pathologist');
  await evidence.observe(other, 'Unassigned pathologist');
  await admin.addInitScript(() => {
    class SyntheticRecognition {
      static async available(options) {
        if (!options.processLocally) throw new Error('Remote recognition is unavailable');
        return 'available';
      }
      get processLocally() { return this.local === true; }
      set processLocally(flag) { this.local = flag; }
      start() {
        if (!this.processLocally) throw new Error('Expected local processing');
        setTimeout(() => this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: 'Synthetic local dictation.' }, isFinal: true }] }), 20);
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: SyntheticRecognition });
  });

  const prefix = '/api/clinical/local';
  const fixture = 'report-browser-' + Date.now();
  async function checked(response, expected = 200) {
    const result = await response;
    assert.equal(result.status(), expected, await result.text());
    return result.json();
  }
  const intake = await checked(admin.request.get('/api/worklist', { params: { q: 'IMS-QA-EDITOR' } }));
  const record = intake.rows.find((row) => row.case_number === 'IMS-QA-EDITOR');
  assert.ok(record, 'Run case-editor-browser.mjs first to register and QC this case.');
  const caseId = record.record_id;
  const caseUrl = prefix + '/cases/' + caseId;
  const received = await checked(admin.request.get(prefix + '/editor/cases/' + caseId));
  const replacement = received.scans.find((scan) => scan.replaces_id);
  assert.ok(replacement, 'Expected the intake QC replacement on the same case.');
  assert.equal(received.scans.find((scan) => scan.id === replacement.replaces_id).qc_status, 'replaced');

  const currentUser = await checked(doctor.request.get('/api/auth/me'));
  await admin.goto('/#case/' + caseId);
  await button(admin, 'Assign Case').click();
  const assignment = admin.getByRole('dialog');
  await assignment.getByLabel('Assigned Pathologist').selectOption(currentUser.id);
  await assignment.getByLabel('Reason for Change').fill('Assign the verified intake case');
  await button(assignment, 'Save').click();
  await assignment.waitFor({ state: 'hidden' });
  await doctor.goto('/#case/' + caseId);
  await button(doctor, 'Open Viewer').click();
  await button(doctor, 'Pan using minimap').waitFor();
  await doctor.waitForFunction((scanId) => document.querySelector('.image-panel')?.dataset.scanId === scanId, replacement.id);
  const reviewNote = 'Synthetic review of the verified replacement scan.';
  for (const [action, reason, note] of [
    ['Start Review', 'Start review after intake QC', ''],
    ['Review Complete', 'Verify and complete the slide review', reviewNote],
  ]) {
    await button(doctor, action).click();
    const dialog = doctor.getByRole('dialog');
    await dialog.getByLabel('Reason for Change').fill(reason);
    if (note) await dialog.getByLabel('Review Note (Optional)').fill(note);
    await button(dialog, 'Save').click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await doctor.locator('.page-heading .status-pill').filter({ hasText: /^Review Complete$/ }).waitFor();
  await doctor.reload();
  await button(doctor, 'Pan using minimap').waitFor();
  const reviewed = await checked(doctor.request.get('/api/worklist/' + caseId));
  assert.equal(reviewed.status, 'reviewed');
  assert.equal(reviewed.audit[0].after.review_note, reviewNote);

  const request = await checked(admin.request.post(caseUrl + '/requests', {
    data: { kind: 'consult', question: 'Synthetic report evidence', assignee_id: currentUser.id },
    headers: { 'Idempotency-Key': fixture + '-request' },
  }), 201);
  const requestUrl = prefix + '/requests/' + request.id;
  const started = await checked(doctor.request.patch(requestUrl, { data: { action: 'start', version: request.version } }));
  await checked(doctor.request.patch(requestUrl, { data: {
    action: 'complete', version: started.version, note: 'Synthetic completed consultation result.',
  } }));
  const route = '/#case/' + caseId + '/report';
  const reportOf = (page) => page.getByRole('region', { name: 'Case Report', exact: true });

  await admin.goto('/#settings');
  const lis = admin.getByRole('region', { name: 'EMR and LIS Settings' }).locator('form').filter({ has: admin.getByRole('heading', { name: /^LIS/ }) });
  await lis.locator('select[name="mode"]').selectOption('mock');
  await lis.getByLabel('Enable Mock Report Delivery').check();
  const permit = admin.waitForResponse((response) => response.url().endsWith('/connections/lis') && response.request().method() === 'PUT');
  await button(lis, 'Save').click();
  assert.equal((await permit).status(), 200);

  await admin.goto(route);
  const report = reportOf(admin);
  await button(report, 'Manage Templates').click();
  const manager = admin.getByRole('form', { name: 'Manage Report Templates' });
  const templateName = 'Synthetic Reporting ' + Date.now();
  await manager.getByLabel('Template Name').fill(templateName);
  await manager.getByLabel('Template Sections').fill('*Diagnosis\nComment');
  await button(manager, 'Save Template Version').click();
  await manager.getByText('Report template saved.', { exact: true }).waitFor();
  const edit = report.getByRole('form', { name: 'Edit Report Draft' });
  await edit.getByLabel('Report Template').selectOption({ label: templateName + ' · Version 1' });
  await report.getByText('Dictation Draft', { exact: true }).click();
  await button(report, 'Start Dictation').click();
  await admin.waitForFunction(() => Array.from(document.querySelectorAll('textarea')).some((node) => node.value === 'Synthetic local dictation.'));
  await button(report, 'Stop Dictation').click();
  await button(report, 'Apply Transcript to Section').click();
  assert.equal(await report.getByLabel('Diagnosis (Required)').inputValue(), 'Synthetic local dictation.');
  await report.getByRole('checkbox', { name: /Completed Consultation/ }).first().check();
  await button(report, 'Save Draft').click();
  await report.getByText('Report draft saved.', { exact: true }).waitFor();
  const accession = 'QA-LIS-' + fixture;
  await report.getByLabel('Mock LIS Accession').fill(accession);
  await report.getByLabel('Link Reason').fill('Synthetic accession verified');
  await button(report, 'Link Mock LIS Accession').click();
  await report.getByText('LIS accession ' + accession, { exact: true }).waitFor();
  await button(report, 'Submit for Review').click();
  await report.locator('.count').filter({ hasText: 'Version 2 · In Review' }).waitFor();
  assert.equal(await button(report, 'Approve Report').count(), 0);

  await doctor.goto(route);
  const review = reportOf(doctor);
  await review.getByText('Synthetic local dictation.', { exact: true }).waitFor();
  await review.getByText('Dictation draft used', { exact: true }).waitFor();
  await review.getByRole('checkbox', { name: 'I reviewed this report and its evidence.' }).check();
  await button(review, 'Approve Report').click();
  await review.locator('.count').filter({ hasText: 'Version 3 · Approved' }).waitFor();
  await button(review, 'Queue Mock LIS Delivery').click();
  await review.getByText(/Version 3 · Initial · Acknowledged/).waitFor();
  await review.getByLabel('Correction Reason').fill('Synthetic correction reason');
  await button(review, 'Start Correction').click();
  await review.getByText('Correction of Version 3 · Synthetic correction reason', { exact: true }).waitFor();
  await review.getByLabel('Diagnosis (Required)').fill('Synthetic amended report.');
  await button(review, 'Save Draft').click();
  await review.getByText('Report draft saved.', { exact: true }).waitFor();
  await review.getByText('Version History', { exact: true }).click();
  await button(review, 'View Version 3').click();
  await review.getByText('Synthetic local dictation.', { exact: true }).waitFor();
  assert.equal(await review.getByLabel('Diagnosis (Required)').inputValue(), 'Synthetic amended report.');
  await button(review, 'Submit for Review').click();
  await review.locator('.count').filter({ hasText: 'Version 6 · In Review' }).waitFor();
  await review.getByRole('checkbox', { name: 'I reviewed this report and its evidence.' }).check();
  await button(review, 'Approve Report').click();
  await review.locator('.count').filter({ hasText: 'Version 7 · Approved' }).waitFor();
  await button(review, 'Queue Mock LIS Delivery').click();
  await review.getByText(/Version 7 · Correction · Acknowledged/).waitFor();
  await evidence.capture(review, 'approved-correction');

  for (const [action, minimum] of [
    ['report_approved', 2], ['report_correction_started', 1], ['report_delivery_acknowledged', 2],
  ]) {
    const logs = await checked(admin.request.get(caseUrl + '/logs', { params: { action } }));
    assert.ok(logs.rows.filter((row) => row.action === action).length >= minimum, action);
  }

  await other.goto(route);
  await other.getByText('Unable to load the case.', { exact: true }).waitFor();
  assert.equal((await other.request.get('/api/clinical/local/cases/' + caseId + '/report')).status(), 404);
  await evidence.finish();
  console.log('PASS: same-case intake/QC replacement, assignment and WSI review, draft/evidence, approved original and correction, Mock LIS ACKs, and Case Logs');
} finally {
  await browser.close();
}
