import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { link, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const clinical = '/api/clinical/local';
const dataDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../data');
const scratch = await mkdtemp(join(dataDirectory, '.qa-related-'));
const errors = [];
const button = (root, name) => root.getByRole('button', { name, exact: true });
const scanRef = (scan) => ({ case_id: scan.case_id, specimen_id: scan.specimen_id, scan_id: scan.id, token: scan.token });

async function read(request, expected = 200) {
  const response = await request;
  assert.equal(response.status(), expected, await response.text());
  return response.json();
}

async function account(username) {
  const page = await browser.newPage({ baseURL: process.env.MEDIAUTO_DEMO_URL, viewport: { width: 1520, height: 1010 } });
  page.setDefaultTimeout(21000);
  page.on('pageerror', (error) => errors.push(error.message));
  await read(page.request.post('/api/auth/login', { data: { organization: 'local', username, password: 'synthetic-test-password' } }));
  return { page, id: (await read(page.request.get('/api/auth/me'))).id };
}

try {
  const admin = await account('integration-admin');
  const doctor = await account('integration-doctor');
  const other = await account('integration-other');
  const req = admin.page.request;
  async function create(path, data) {
    return read(req.post(clinical + '/' + path, { data, headers: { 'Idempotency-Key': randomUUID() } }), 201);
  }
  async function addCase(number, patient, stain, file, alias) {
    const record = await create('cases', { case_number: number });
    if (patient) await read(req.patch(clinical + '/cases/' + record.id + '/patient', {
      data: { target_id: patient, version: record.version, reason: 'Synthetic linked patient' },
    }));
    const specimen = await create('specimens', { case_id: record.id, specimen_number: alias });
    const alternative = await create('specimens', { case_id: record.id, specimen_number: alias + '-OTHER' });
    const slide = await create('slides', { specimen_id: specimen.id, slide_number: alias + '-01', stain });
    const local = alias + file.slice(file.lastIndexOf('.'));
    await link(join(dataDirectory, file), join(scratch, local));
    const scan = await create('scans', { slide_id: slide.id, storage_key: basename(scratch) + '/' + local });
    return { record, specimen, alternative, scan };
  }
  const patient = await create('patients', { display_name: 'Synthetic Related QA', local_reference: 'SYNTH-LINK-A' });
  const wrongPatient = await create('patients', { display_name: 'Synthetic Related QA', local_reference: 'SYNTH-LINK-B' });
  const pap = await addCase('RELATED-QA-PAP', patient.id, 'Papanicolaou', 'CODIPAI-BRCA-SS-00194-I-KI-01.svs', 'PAP');
  const biopsy = await addCase('RELATED-QA-BIOPSY', patient.id, 'H&E', 'CODIPAI-STBX-SS-04364-I-PD-22.ndpi', 'BIOPSY');
  const mismatch = await addCase('RELATED-QA-OTHER', wrongPatient.id, 'H&E', 'CODIPAI-BRCA-SS-00194-I-PR-01.svs', 'OTHER');
  const unlinked = await create('cases', { case_number: 'RELATED-QA-NO-PATIENT' });
  const endpoint = (item) => clinical + '/cases/' + item.record.id + '/related-cases';
  async function assign(item, reviewer) {
    const latest = await read(req.get(clinical + '/cases/' + item.record.id));
    return read(req.patch(clinical + '/cases/' + item.record.id + '/assignment', {
      data: { assignee_id: reviewer, version: latest.version, reason: 'Synthetic comparison assignment' },
    }));
  }
  await assign(pap, doctor.id);
  await assign(biopsy, other.id);

  const available = await read(req.get(endpoint(pap)));
  const ownScan = available.sources.find((row) => row.id === pap.scan.id);
  const otherScan = available.candidates.find((row) => row.id === biopsy.scan.id);
  const wrongScan = (await read(req.get(endpoint(mismatch)))).sources[0];
  assert.ok(ownScan && otherScan && wrongScan);
  assert.ok(!available.candidates.some((row) => row.case_id === mismatch.record.id));
  assert.equal((await read(req.get(clinical + '/cases/' + unlinked.id + '/related-cases'))).status, 'patient_required');
  assert.deepEqual((await read(doctor.page.request.get(endpoint(pap)))).candidates, []);
  const payload = { source: scanRef(ownScan), target: scanRef(otherScan), patient_confirmed: true,
    biopsy_confirmed: true, reason: 'Synthetic explicit verification', request_key: randomUUID() };
  await read(req.post(endpoint(pap), { data: { ...payload, target: scanRef(wrongScan) } }), 409);
  await read(doctor.page.request.post(endpoint(pap), { data: payload }), 404);
  await read(req.post(endpoint(pap), { data: { ...payload, target: { ...payload.target, specimen_id: biopsy.alternative.id } } }), 409);
  await read(req.post(endpoint(pap), { data: { ...payload, patient_confirmed: false } }), 422);

  await admin.page.goto('/#viewer/' + pap.record.id + '/' + pap.scan.id);
  await button(admin.page, 'Pap Review').click();
  await button(admin.page, 'Compare Related Biopsy').click();
  const dialog = admin.page.getByRole('dialog', { name: 'Related Pap and Biopsy Cases' });
  await dialog.getByRole('combobox', { name: 'Related Scan' }).selectOption(biopsy.scan.id);
  await dialog.getByRole('checkbox', { name: 'I verified the patient match' }).check();
  await dialog.getByRole('checkbox', { name: /I verified the selected H&E/ }).check();
  await dialog.getByRole('textbox', { name: 'Link Reason' }).fill('Synthetic comparison approved');
  const [approval] = await Promise.all([
    admin.page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(endpoint(pap))),
    button(dialog, 'Confirm Related Link').click(),
  ]);
  assert.equal(approval.status(), 201);
  const open = dialog.getByRole('link', { name: 'Open Independent Comparison', exact: true });
  await open.waitFor();
  const linkId = (await read(req.get(endpoint(pap)))).links[0].id;
  const path = clinical + '/related-comparisons/' + linkId;
  const replay = await read(req.post(endpoint(pap), { data: approval.request().postDataJSON() }), 201);
  assert.equal(replay.id, linkId);
  await read(req.post(endpoint(pap), { data: payload }), 409);
  await read(doctor.page.request.get(path), 404);
  await read(doctor.page.request.get(path + '/wsi/pap'), 404);
  assert.deepEqual((await read(doctor.page.request.get(clinical + '/cases/' + pap.record.id + '/logs', {
    params: { entity: 'related_case_link' },
  }))).rows, []);

  const [compare] = await Promise.all([admin.page.context().waitForEvent('page'), open.click()]);
  compare.setDefaultTimeout(21000);
  compare.on('pageerror', (error) => errors.push(error.message));
  const left = compare.getByRole('region', { name: 'Primary Case', exact: true });
  const right = compare.getByRole('region', { name: 'Related Case', exact: true });
  await left.getByText('Primary Case · RELATED-QA-PAP', { exact: true }).waitFor();
  await right.getByText('Related Case · RELATED-QA-BIOPSY', { exact: true }).waitFor();
  await compare.getByRole('link', { name: 'Return to Pap Review', exact: true }).waitFor();
  await left.getByText(/Papanicolaou · SVS · Scan/).waitFor();
  const viewport = (pane) => pane.getByRole('region', { name: 'Slide Image', exact: true });
  await button(left, 'Pan using minimap').waitFor();
  await button(right, 'Pan using minimap').waitFor();
  const oldLeft = Number(await viewport(left).getAttribute('data-view-zoom'));
  const oldRight = Number(await viewport(right).getAttribute('data-view-zoom'));
  await button(left, 'Zoom In').click();
  await compare.waitForFunction((previous) => Number(document.querySelector(
    'section[aria-label="Primary Case"] [data-view-zoom]')?.dataset.viewZoom) > previous, oldLeft);
  assert.equal(Number(await viewport(right).getAttribute('data-view-zoom')), oldRight);
  const [returned] = await Promise.all([
    compare.context().waitForEvent('page'),
    compare.getByRole('link', { name: 'Return to Pap Review', exact: true }).evaluate((link) => window.open(link.href, '_blank', 'noopener')),
  ]);
  await returned.waitForURL((target) => target.hash === `#viewer/${pap.record.id}/${pap.scan.id}?pap=review`);
  await returned.getByRole('region', { name: 'Pap Specimen Review', exact: true }).waitFor();
  await returned.getByRole('complementary', { name: 'Pap Candidate Gallery', exact: true }).waitFor();
  await returned.close();
  const primaryCenter = Number(await viewport(left).getAttribute('data-view-center-x'));
  const relatedCenter = await viewport(right).getAttribute('data-view-center-x');
  const canvas = await left.getByLabel('WSI Canvas', { exact: true }).boundingBox();
  const middle = [canvas.x + canvas.width / 2, canvas.y + canvas.height / 2];
  await compare.mouse.move(...middle);
  await compare.mouse.down();
  await compare.mouse.move(middle[0] + 48, middle[1] + 22, { steps: 3 });
  await compare.mouse.up();
  await compare.waitForFunction((previous) => Number(document.querySelector(
    'section[aria-label="Primary Case"] [data-view-center-x]')?.dataset.viewCenterX) !== previous, primaryCenter);
  assert.equal(await viewport(right).getAttribute('data-view-center-x'), relatedCenter);
  assert.match(admin.page.url(), /#viewer\//);
  assert.equal((await req.get(path + '/wsi/biopsy/0/0/0.jpeg')).status(), 200);

  await assign(biopsy, doctor.id);
  await read(doctor.page.request.get(path));
  await doctor.page.goto('/#related-comparison/' + linkId + '/' + biopsy.record.id);
  await doctor.page.getByText('Primary Case · RELATED-QA-BIOPSY', { exact: true }).waitFor();
  const doctorLog = await read(doctor.page.request.get(clinical + '/cases/' + biopsy.record.id + '/logs', {
    params: { entity: 'related_case_link' },
  }));
  assert.equal(doctorLog.rows[0].action, 'related_case_confirmed');
  await assign(biopsy, other.id);
  await doctor.page.getByRole('alert').getByText('The case pair is unavailable.', { exact: false }).waitFor();
  assert.equal(await doctor.page.locator('canvas[aria-label="WSI Canvas"]').count(), 0);
  await read(doctor.page.request.get(path + '/wsi/pap/overview.jpeg'), 404);

  const previousBiopsy = await read(req.get(clinical + '/cases/' + biopsy.record.id));
  await read(req.patch(clinical + '/cases/' + biopsy.record.id + '/patient', {
    data: { target_id: wrongPatient.id, version: previousBiopsy.version, reason: 'Synthetic patient-link correction' },
  }));
  await compare.getByRole('alert').getByText(/no longer linked to a confirmed patient match/).waitFor();
  assert.equal(await compare.locator('canvas[aria-label="WSI Canvas"]').count(), 0);
  await read(req.get(path + '/wsi/pap/0/0/0.jpeg'), 409);
  await button(dialog, 'Close Related Cases').click();
  await button(admin.page, 'Related Pap and Biopsy Cases').click();
  await dialog.getByText(/Reconciliation Required/).waitFor();
  await button(dialog, 'Unlink').click();
  await dialog.getByRole('textbox', { name: 'Unlink Reason' }).fill('Synthetic relationship withdrawn');
  await button(dialog, 'Confirm Unlink').click();
  await dialog.getByText(/Unlinked by/).waitFor();
  for (const item of [pap, biopsy]) {
    const audit = await read(req.get(clinical + '/cases/' + item.record.id + '/logs', { params: { entity: 'related_case_link' } }));
    assert.deepEqual(audit.rows.map((row) => row.action), ['related_case_revoked', 'related_case_confirmed']);
  }
  await read(req.get(path + '/wsi/biopsy'), 409);
  assert.deepEqual(errors, []);
  console.log('PASS: related Pap/biopsy reconciliation, exact bindings and privacy, independent NDPI/SVS panes, revocation and case audit');
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
