import { demoEvidence } from './workflow-demo-evidence.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const clinical = '/api/clinical/local';
const errors = [];

async function read(request, expected = 200) {
  const response = await request;
  assert.equal(response.status(), expected, await response.text());
  return response.json();
}

async function staff(username) {
  const page = await browser.newPage({ baseURL: process.env.MEDIAUTO_DEMO_URL, viewport: { width: 1520, height: 1010 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await read(page.request.post('/api/auth/login', { data: { organization: 'local', username, password: 'synthetic-test-password' } }));
  return { page, user: await read(page.request.get('/api/auth/me')) };
}

const evidence = demoEvidence('pap');

try {
  const admin = await staff('integration-admin');
  const primary = await staff('integration-pap-primary');
  const backup = await staff('integration-pap-backup');
  const physician = await staff('integration-doctor');
  await evidence.observe(admin.page, 'Policy administrator');
  await evidence.observe(primary.page, 'Primary reviewer');
  await evidence.observe(backup.page, 'Replacement reviewer');
  await evidence.observe(physician.page, 'Follow-up pathologist');
  const unassigned = await staff('integration-other');
  const { rows } = await read(admin.page.request.get('/api/worklist?q=IMS-DEMO-MULTI'));
  const record = rows.find((row) => row.case_number === 'IMS-DEMO-MULTI');
  assert.ok(record);
  const id = record.record_id;
  const enrolled = await read(admin.page.request.get(clinical + '/cases/' + id));
  if (enrolled.assigned_to !== physician.user.id) {
    await read(admin.page.request.patch(clinical + '/cases/' + id + '/assignment', {
      data: { assignee_id: physician.user.id, version: enrolled.version, reason: 'Synthetic Pap reviewer assignment' },
    }));
  }
  const scanIds = [];
  for (const label of ['I-KI', 'I-PR']) {
    const scanId = record.slides.find((scan) => scan.label === label).id;
    const scan = await read(admin.page.request.get(clinical + '/scans/' + scanId));
    const slide = await read(admin.page.request.get(clinical + '/slides/' + scan.slide_id));
    if (slide.stain !== 'Papanicolaou') {
      await read(admin.page.request.patch(clinical + '/editor/slides/' + slide.id, {
        data: { slide_number: slide.slide_number, version: slide.version, block_id: slide.block_id,
          stain: 'Papanicolaou', reason: 'Synthetic Pap review fixture' },
      }));
    }
    scanIds.push(scanId);
  }
  const policyUrl = clinical + '/pap-policy';
  const route = (scanId = scanIds[0]) => '/api/wsi/clinical/' + scanId + '/pap-review';
  const panel = (page) => page.getByRole('region', { name: 'Pap Specimen Review', exact: true });
  async function open(account, scan = scanIds[0]) {
    await account.page.goto('/#viewer/' + id + '/' + scan);
    await account.page.getByRole('button', { name: 'Pap Review', exact: true }).click();
    return panel(account.page);
  }
  const state = async (account, stage, scan) => read(account.page.request.get(route(scan) + (stage ? '?before=' + stage : '')));
  async function send(account, current, action, options = {}, expected = 200, scan) {
    return read(account.page.request.post(route(scan) + '/revisions', {
      data: { action, expected_version: current.version, terminology_id: current.terminology.id, request_key: randomUUID(), ...options },
    }), expected);
  }
  assert.equal((await state(primary)).availability, 'not_configured');
  await read(primary.page.request.get(policyUrl), 403);
  await read(unassigned.page.request.get(route()), 404);
  await admin.page.goto('/#settings/pap');
  const config = admin.page.getByRole('region', { name: 'Pap Review Policy', exact: true });
  await config.getByRole('textbox', { name: 'Policy Name' }).fill('Synthetic Pap Terms');
  await config.getByRole('textbox', { name: /^Adequacy Terms/ }).fill('qa_ok | QA Adequate\nqa_bad | QA Inadequate | no_interpretation');
  await config.getByRole('textbox', { name: /^Interpretation Terms/ }).fill('qa_primary | QA Primary Finding\nqa_follow | QA Follow-up Finding');
  await config.getByRole('textbox', { name: /^Organism Terms/ }).fill('qa_none | QA None | exclusive\nqa_found | QA Organism');
  await config.getByRole('checkbox', { name: /Require organisms/ }).check();
  await config.getByRole('group', { name: 'Primary Reviewers', exact: true }).getByRole('checkbox', { name: primary.user.display_name, exact: true }).check();
  await config.getByRole('group', { name: 'Follow-up Reviewers', exact: true }).getByRole('checkbox', { name: physician.user.display_name, exact: true }).check();
  await config.getByRole('textbox', { name: 'Publication Reason' }).fill('Synthetic vocabulary version one');
  await config.getByRole('button', { name: 'Publish Pap Policy' }).click();
  await config.getByRole('status').getByText('Active Pap Policy Version 1', { exact: true }).waitFor();

  const unauth = await state(admin);
  assert.deepEqual(unauth.actions, []);
  await send(admin, unauth, 'submit_primary', { findings: { adequacy: 'qa_bad' } }, 403);
  const first = await open(primary);
  await first.getByRole('combobox', { name: 'Specimen Adequacy' }).selectOption('qa_ok');
  await first.getByRole('combobox', { name: 'Interpretation' }).selectOption('qa_primary');
  await first.getByRole('checkbox', { name: 'QA None', exact: true }).check();
  await first.getByRole('textbox', { name: 'Review Note' }).fill('Synthetic primary note');
  await first.getByRole('button', { name: 'Save Primary Draft' }).click();
  await first.getByRole('status').getByText(/Primary Draft · Review 1/).waitFor();
  const draft = await state(primary);
  await send(primary, draft, 'submit_primary', { findings: { adequacy: 'qa_ok', interpretation: 'qa_primary',
    organisms: ['qa_none', 'qa_found'] } }, 422);
  await primary.page.reload();
  await primary.page.getByRole('button', { name: 'Pap Review', exact: true }).click();
  await first.getByRole('checkbox', { name: 'QA None', exact: true }).waitFor();
  assert.equal(await first.getByRole('textbox', { name: 'Review Note' }).inputValue(), 'Synthetic primary note');
  await first.getByRole('button', { name: 'Submit Primary Review' }).click();
  await first.getByRole('status').getByText(/Awaiting Follow-up · Review 2/).waitFor();
  await send(primary, await state(primary), 'complete', { findings: { adequacy: 'qa_bad' } }, 403);

  const second = await open(physician, scanIds[1]);
  await second.getByRole('status').getByText(/Awaiting Follow-up · Review 2/).waitFor();
  assert.equal(await second.getByRole('combobox', { name: 'Specimen Adequacy' }).inputValue(), '');
  await second.getByRole('combobox', { name: 'Specimen Adequacy' }).selectOption('qa_ok');
  await second.getByRole('combobox', { name: 'Interpretation' }).selectOption('qa_follow');
  await second.getByRole('checkbox', { name: 'QA Organism', exact: true }).check();
  await second.getByRole('button', { name: 'Save Follow-up Draft' }).click();
  await second.getByRole('status').getByText(/Follow-up Draft · Review 3/).waitFor();
  await second.getByRole('textbox', { name: 'Action Reason' }).fill('Synthetic correction request');
  await second.getByRole('button', { name: 'Return for Correction' }).click();
  await second.getByRole('status').getByText(/Returned to Primary · Review 4/).waitFor();

  const previous = (await read(admin.page.request.get(policyUrl))).policies[0];
  const updated = { version: previous.version, name: 'Synthetic Updated Terms', reason: 'Synthetic reviewer rotation',
    terms: { ...previous.terms, interpretation: [{ code: 'qa_new', label: 'QA New Term' }] },
    permissions: { primary_reviewers: [backup.user.id], followup_reviewers: [physician.user.id] } };
  await read(admin.page.request.post(policyUrl, { data: updated }), 201);
  await read(admin.page.request.post(policyUrl, { data: updated }), 409);
  await send(primary, await state(primary), 'reopen_primary', { reason: 'Revoked account' }, 403);
  const resumed = await open(backup, scanIds[1]);
  await resumed.getByRole('status').getByText(/Synthetic Pap Terms v1 · Active permission policy v2/).waitFor();
  await resumed.getByRole('textbox', { name: 'Action Reason' }).fill('Synthetic primary resumption');
  await resumed.getByRole('button', { name: 'Resume Primary Review' }).click();
  await resumed.getByRole('status').getByText(/Primary Draft · Review 5/).waitFor();
  assert.equal(await resumed.getByRole('combobox', { name: 'Interpretation' }).inputValue(), 'qa_primary');
  const v5 = await state(backup);
  await send(backup, v5, 'save_primary', { findings: { adequacy: 'qa_ok', interpretation: 'qa_new' } }, 422);
  const retries = { request_key: randomUUID(), findings: { adequacy: 'qa_bad' } };
  const [firstAttempt, duplicate] = await Promise.all([
    send(backup, v5, 'submit_primary', retries), send(backup, v5, 'submit_primary', retries),
  ]);
  assert.deepEqual(firstAttempt, duplicate);
  assert.equal(firstAttempt.version, 6);
  await send(backup, v5, 'save_primary', { findings: { adequacy: 'qa_bad' } }, 409);
  await second.getByRole('button', { name: 'Reload Pap Review' }).click();
  await second.getByRole('status').getByText(/Awaiting Follow-up · Review 6/).waitFor();
  await second.getByRole('combobox', { name: 'Specimen Adequacy' }).selectOption('qa_bad');
  assert.equal(await second.getByRole('combobox', { name: 'Interpretation' }).isDisabled(), true);
  await second.getByRole('button', { name: 'Complete Follow-up Review' }).click();
  await second.getByRole('status').getByText(/Review Completed · Review 7/).waitFor();
  await evidence.capture(second, 'completed-follow-up');
  await second.getByRole('textbox', { name: 'Action Reason' }).fill('Synthetic second review');
  await second.getByRole('button', { name: 'Reopen Follow-up Review' }).click();
  await second.getByRole('status').getByText(/Follow-up Draft · Review 8/).waitFor();
  const final = await state(physician, undefined, scanIds[0]);
  assert.equal(final.history.length, 8);
  assert.equal(final.history[0].terminology_version, 1);
  assert.equal(final.history[0].policy_version, 2);
  assert.equal(final.history.find((entry) => entry.version === 4).reason, 'Synthetic correction request');
  assert.equal(final.history.find((entry) => entry.version === 3).findings.interpretation, 'qa_follow');
  assert.equal(new Set(final.history.map((entry) => entry.scan_id)).size, 2);
  assert.equal((await read(admin.page.request.get(clinical + '/cases/' + id + '/logs', {
    params: { entity: 'pap_review_revision' },
  }))).rows.length, 8);
  assert.deepEqual(errors, []);
  await evidence.finish();
  console.log('PASS: Pap vocabulary publication and pinned versions, independent specimen reviews, role revocation, return/resume, stale and duplicate requests, audit');
} finally {
  await browser.close();
}
