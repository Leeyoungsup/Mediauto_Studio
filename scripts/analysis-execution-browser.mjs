import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const button = (root, name) => root.getByRole('button', { name, exact: true });
const endpoint = '/api/clinical/local';

async function check(request, status = 200) {
  const response = await request;
  assert.equal(response.status(), status, await response.text());
  return response.json();
}

async function signIn(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1520, height: 1010 } });
  page.setDefaultTimeout(18000);
  await check(page.request.post('/api/auth/login', { data: { organization: 'local', username, password: 'synthetic-test-password' } }));
  return page;
}

try {
  const admin = await signIn('integration-admin');
  const doctor = await signIn('integration-doctor');
  const errors = [];
  for (const page of [admin, doctor]) page.on('pageerror', (error) => errors.push(error.message));
  const result = await check(admin.request.get('/api/worklist?q=IMS-DEMO-MULTI'));
  const record = result.rows.find((row) => row.case_number === 'IMS-DEMO-MULTI');
  const caseId = record.record_id;
  const caseUrl = endpoint + '/cases/' + caseId;
  const svs = record.slides.find((row) => row.label === 'I-HR').id;
  const preflightScan = record.slides.find((row) => row.label === 'I-KI').id;
  const registered = await check(admin.request.get(endpoint + '/scans/' + svs));
  const slide = await check(admin.request.get(endpoint + '/slides/' + registered.slide_id));
  const specimen = await check(admin.request.get(endpoint + '/specimens/' + slide.specimen_id));
  const reason = 'Synthetic analysis browser fixture';
  const block = await check(admin.request.post(endpoint + '/editor/specimens/' + specimen.id + '/blocks', {
    data: { block_number: 'AI-QA-B1', version: specimen.version, reason },
  }), 201);
  await check(admin.request.patch(endpoint + '/editor/slides/' + slide.id, {
    data: { slide_number: slide.slide_number, version: slide.version, block_id: block.id, stain: 'PD-L1', reason },
  }));
  const preflightRecord = await check(admin.request.get(endpoint + '/scans/' + preflightScan));
  const preflightSlide = await check(admin.request.get(endpoint + '/slides/' + preflightRecord.slide_id));
  await check(admin.request.patch(endpoint + '/editor/slides/' + preflightSlide.id, {
    data: { slide_number: preflightSlide.slide_number, version: preflightSlide.version, block_id: block.id, stain: 'PD-L1', reason },
  }));
  const doctorAccount = await check(doctor.request.get('/api/auth/me'));
  const caseRecord = await check(admin.request.get(caseUrl));
  if (caseRecord.assigned_to !== doctorAccount.id) {
    await check(admin.request.patch(caseUrl + '/assignment', {
      data: { assignee_id: doctorAccount.id, version: caseRecord.version, reason },
    }));
  }

  const requestRoute = '/#case/' + caseId + '/requests';
  await admin.goto(requestRoute);
  await button(admin, 'New Request').click();
  await admin.getByRole('combobox', { name: 'Request Type' }).selectOption('ai');
  await admin.getByRole('combobox', { name: 'Execution Model' }).selectOption('pdl1_cps_archive');
  await admin.getByRole('combobox', { name: 'Target Scan' }).selectOption(svs);
  await admin.getByRole('textbox', { name: 'Request Details' }).fill('Synthetic CPS archive replay');
  await button(admin, 'Create Request').click();
  const runs = admin.getByRole('region', { name: 'Model Runs' });
  await runs.getByText(/Attempt 1 · Completed/).waitFor();
  await runs.getByText(/Archived original.*analysis-browser-fixture/).waitFor();
  const pinned = await runs.getByRole('link', { name: 'Open Pinned Result in WSI' }).getAttribute('href');
  assert.match(pinned, new RegExp('/' + svs + '/[a-f0-9]{64}$'));
  await button(runs, 'Rerun Pinned Model').click();
  await runs.getByText(/Attempt 2 · Completed/).waitFor();
  assert.deepEqual(await runs.getByRole('link', { name: 'Open Pinned Result in WSI' }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href'))), [pinned, pinned]);

  await admin.goto('/#settings/analysis');
  const rules = admin.getByRole('region', { name: 'Analysis Pre-run Rules' });
  await rules.getByRole('combobox', { name: 'Rule Model' }).selectOption('ihc_preflight');
  await rules.getByRole('combobox', { name: 'Rule Marker' }).selectOption('pdl1');
  await button(rules, 'Enable Pre-run Rule').click();
  await rules.getByRole('status').filter({ hasText: 'Pre-run rule enabled.' }).waitFor();
  await check(admin.request.post(endpoint + '/editor/scans/' + preflightScan + '/qc', {
    data: { source: 'manual', outcome: 'passed', version: preflightRecord.version, reason },
  }));
  let auto;
  for (let i = 0; i < 60 && !auto; i++) {
    const requests = (await check(admin.request.get(caseUrl + '/requests'))).requests;
    auto = requests.find((item) => item.scan_id === preflightScan && item.model_run?.model === 'ihc_preflight');
    if (!auto) await new Promise((resolve) => setTimeout(resolve, 125));
  }
  assert.ok(auto);
  await button(rules, 'Disable Rule').click();
  await rules.getByRole('status').filter({ hasText: 'Pre-run rule disabled.' }).waitFor();
  await admin.goto('/#request/' + auto.id);
  await runs.getByText(/Attempt 1 · Completed · Pre-run Rule/).waitFor();
  await runs.getByText(/Image preflight complete/).waitFor();
  const runData = await check(admin.request.get(endpoint + '/requests/' + auto.id + '/execution'));

  await doctor.goto(requestRoute);
  const review = doctor.getByRole('region', { name: 'IHC Review' });
  await review.getByRole('combobox', { name: 'IHC Scan' }).selectOption(preflightScan);
  const form = review.getByRole('form', { name: 'Record IHC Review' });
  await form.getByRole('combobox', { name: 'Interpretation' }).selectOption('indeterminate');
  await form.getByRole('combobox', { name: 'Best Block' }).selectOption(block.id);
  await form.getByRole('combobox', { name: 'Completed Model Run' }).selectOption(runData.runs[0].id);
  await form.getByRole('textbox', { name: 'Review Rationale' }).fill('Synthetic interpretation with the selected block');
  await button(form, 'Save IHC Review').click();
  await review.getByText('IHC review saved to Result Evidence.', { exact: true }).waitFor();

  await doctor.goto('/#case/' + caseId + '/report');
  const draft = doctor.getByRole('form', { name: 'Edit Report Draft' });
  await draft.getByRole('checkbox', { name: /IHC Review · PD-L1 · Indeterminate · Best Block AI-QA-B1/ }).check();
  await draft.getByRole('checkbox', { name: /IHC Image Preflight · preflight-v1/ }).check();
  await draft.getByRole('textbox', { name: 'Diagnosis (Required)' }).fill('Synthetic analysis report');
  await button(draft, 'Save Draft').click();
  await doctor.getByText('Report draft saved.', { exact: true }).waitFor();
  const audit = await check(admin.request.get(caseUrl + '/logs', { params: { action: 'ihc_review_recorded' } }));
  assert.ok(audit.rows.length);

  const viewer = '/#viewer/' + caseId + '/' + svs;
  await doctor.goto(viewer);
  await button(doctor, 'Pan using minimap').waitFor();
  const image = doctor.getByRole('region', { name: 'Slide Image', exact: true });
  const tray = doctor.locator('#viewer-slide-tray');
  if (!await tray.isVisible()) await button(doctor, 'Show Slide Tray').click();
  await button(doctor, 'Zoom In').click();
  const camera = () => image.evaluate((node) => [node.dataset.viewZoom, node.dataset.viewCenterX, node.dataset.viewCenterY]);
  const originalCamera = await camera();
  await button(doctor, 'Analysis').click();
  const analysis = doctor.getByRole('complementary', { name: 'Slide Analysis', exact: true });
  await analysis.getByText('PD-L1 TPS Archive Replay · No matching archived result', { exact: true }).waitFor();
  const methods = analysis.getByRole('combobox', { name: 'Analysis Method' });
  assert.deepEqual(await methods.locator('option').evaluateAll((items) => items.map((item) => item.value)),
    ['', 'pdl1_cps_archive', 'ihc_preflight']);
  assert.deepEqual(await camera(), originalCamera);
  await methods.selectOption('pdl1_cps_archive');
  assert.equal(await button(analysis, 'Run Analysis').isEnabled(), true);
  await button(analysis, 'Run Analysis').click();
  const completed = analysis.locator('li').filter({ hasText: /PD-L1 CPS Archive Replay.*Completed · Attempt 1/ });
  await button(completed, 'Show Result on Slide').waitFor();
  await button(completed, 'Show Result on Slide').click();
  await analysis.waitFor({ state: 'hidden' });
  await doctor.getByRole('complementary', { name: 'PD-L1 Score Card' }).waitFor();
  assert.deepEqual(await camera(), originalCamera);
  assert.equal(new URL(doctor.url()).hash, '#viewer/' + caseId + '/' + svs);

  await button(doctor, 'Analysis').click();
  await tray.locator('[data-scan-id="' + preflightScan + '"]').click();
  await analysis.getByText('PD-L1 CPS Archive Replay · No matching archived result', { exact: true }).waitFor();
  assert.equal(await analysis.getByRole('combobox', { name: 'Analysis Method' }).inputValue(), 'ihc_preflight');
  await analysis.getByText(/Completed · Attempt 1 · preflight-v1/).waitFor();
  assert.equal(await button(analysis, 'Show Result on Slide').count(), 0);
  const outsider = await signIn('integration-other');
  await check(outsider.request.get(caseUrl + '/scans/' + preflightScan + '/analysis'), 404);
  const narrow = { width: 390, height: 900 };
  await doctor.setViewportSize(narrow);
  const panel = await analysis.boundingBox();
  assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= narrow.width);
  await button(analysis, 'Close Slide Analysis').click();
  await doctor.locator('.viewer-case-tools summary').click();
  const menu = await doctor.locator('.viewer-case-menu').boundingBox();
  assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= narrow.width);

  assert.deepEqual(errors, []);
  console.log('PASS: pinned replay and IHC evidence, Viewer launch on the active scan, unavailable options, camera retention, scan isolation, permission and mobile layout');
} finally {
  await browser.close();
}
