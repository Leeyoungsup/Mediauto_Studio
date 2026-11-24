import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const base = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const { chromium, request } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const password = 'synthetic-test-password';
const accounts = { admin: 'integration-admin', doctor: 'integration-doctor', other: 'integration-other' };
const caseNumber = 'IMS-DEMO-101';
const missingNumber = 'IMS-DEMO-NO-SCAN';
const memo = 'Synthetic demo note. NDPI and SVS switching verified.';
const samples = {
  NDPI: process.env.MEDIAUTO_DEMO_NDPI ?? 'CODIPAI-STBX-SS-04364-I-PD-22.ndpi',
  SVS: process.env.MEDIAUTO_DEMO_SVS ?? 'CODIPAI-STBX-SS-04364-I-PD-22.svs',
};
const credentials = (username) => ({ organization: 'local', username, password });
const clinical = '/api/clinical/local';
const detailPath = (id) => '/api/worklist/' + id;

async function seed() {
  const api = await request.newContext({ baseURL: base });
  async function create(resource, data, key) {
    const response = await api.post(`${clinical}/${resource}`, { data, headers: { 'Idempotency-Key': `integration-${key}` } });
    assert.equal(response.status(), 201, await response.text());
    return response.json();
  }
  try {
    const { emr } = await (await api.get('/api/health')).json();
    assert.equal(emr, 'unconfigured');
    assert.equal((await api.post('/api/auth/login', { data: credentials(accounts.admin) })).status(), 200);
    const record = await create('cases', { case_number: caseNumber }, 'case');
    const specimen = await create('specimens', { case_id: record.id, specimen_number: 'SYNTH-A' }, 'specimen');
    const slide = await create('slides', { specimen_id: specimen.id, slide_number: 'SYNTH-01' }, 'slide');
    const entries = {};
    for (const [format, filename] of Object.entries(samples)) {
      const file = await stat('data/' + filename);
      const scan = await create('scans', { slide_id: slide.id, storage_key: filename }, format);
      const url = `/api/wsi/clinical/${scan.id}`;
      const response = await api.get(url);
      assert.equal(response.status(), 200);
      const { dimensions } = await response.json();
      entries[format] = { id: scan.id, url, dimensions, bytes: file.size };
    }
    const missing = await create('cases', { case_number: missingNumber }, 'missing');
    return { record, missing, entries };
  } finally {
    await api.dispose();
  }
}

const fixture = await seed();
if (process.argv.includes('--seed-only')) {
  console.log(JSON.stringify({ case_number: caseNumber, missing_case_number: missingNumber, accounts, samples: fixture.entries }, null, 2));
  process.exit(0);
}

const browser = await chromium.launch({
  executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome',
  headless: true,
});
const sampleRuns = [];
const actions = {};
const transitions = { admin: 0, doctor: 0 };
const errors = [];
let retries = 0;
const time = {};
const tilePattern = (scan) => new RegExp(scan.url + '/[012]/[0-9]+/[0-9]+\\.jpeg$');
const dialog = (page) => page.getByRole('dialog');
const measure = async (name, task) => {
  const start = performance.now();
  await task();
  time[name] = Math.round(performance.now() - start);
};
async function step(actor, label, operation) {
  actions[actor] ??= [];
  actions[actor].push(label);
  return operation();
}
async function setupPage() {
  const page = await browser.newPage({ baseURL: base, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  return page;
}
async function signIn(page, actor, measured = true) {
  const enter = async () => {
    await page.getByLabel('Username').fill(accounts[actor]);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  };
  if (measured) {
    await measure(actor + '_login_to_worklist_ms', async () => {
      await step(actor, 'Enter Username', () => page.getByLabel('Username').fill(accounts[actor]));
      await step(actor, 'Enter Password', () => page.getByLabel('Password').fill(password));
      const list = page.waitForResponse((response) => response.url().includes('/api/worklist?') && response.ok());
      await step(actor, 'Sign In', () => page.getByRole('button', { name: 'Sign In', exact: true }).click());
      await list;
      await page.getByRole('heading', { name: 'Worklist', exact: true }).waitFor();
    });
    transitions[actor]++;
  } else {
    await enter();
    await page.getByRole('heading', { name: 'Worklist', exact: true }).waitFor();
  }
}
async function openCase(page, number, actor) {
  const open = () => page.getByRole('button', { name: number + ' details' }).click();
  if (actor) { await step(actor, 'Open Case Details', open); transitions[actor]++; }
  else await open();
  await page.getByRole('heading', { name: number, exact: true }).waitFor();
}
async function displayed(page) {
  await page.getByRole('button', { name: 'Pan using minimap' }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.wsi-canvas');
    if (!canvas?.width || !canvas.height) return false;
    const [red, green, blue] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    return (red || green || blue) && (red !== 40 || green !== 36 || blue !== 51);
  });
}
async function selectScan(page, format, actor) {
  const tab = page.getByRole('complementary').getByRole('button', { name: new RegExp('SYNTH-01.*' + format) });
  if (actor) await step(actor, format + ' Select', () => tab.click());
  else await tab.click();
  await tab.and(page.locator('[aria-pressed="true"]')).waitFor();
  await displayed(page);
}
async function review(page, button, reason, note) {
  const action = (label, event) => step('doctor', label, event);
  await action(button, () => page.getByRole('button', { name: button, exact: true }).click());
  await action('Enter Reason for Change', () => dialog(page).getByLabel('Reason for Change').fill(reason));
  if (note) await action('Enter Review Note', () => dialog(page).getByLabel('Review Note (Optional)').fill(note));
  await action('Save', () => dialog(page).getByRole('button', { name: 'Save', exact: true }).click());
  await dialog(page).waitFor({ state: 'hidden' });
}
try {
  const admin = await setupPage();
  await measure('admin_task_ms', async () => {
    await signIn(admin, 'admin');
    await step('admin', 'Enter Case ID', () => admin.getByLabel('Search Cases').fill('ims-demo-101'));
    await openCase(admin, caseNumber, 'admin');
    await step('admin', 'Assign Case', () => admin.getByRole('button', { name: 'Assign Case', exact: true }).click());
    const target = dialog(admin).getByLabel('Assigned Pathologist');
    const doctor = await target.getByRole('option', { name: /integration-doctor/ }).getAttribute('value');
    await step('admin', 'Select Pathologist', () => target.selectOption(doctor));
    await step('admin', 'Enter Assignment Reason', () => dialog(admin).getByLabel('Reason for Change').fill('Assign Synthetic Case'));
    await step('admin', 'Save Assignment', () => dialog(admin).getByRole('button', { name: 'Save', exact: true }).click());
    await admin.getByRole('complementary').getByText(accounts.doctor, { exact: true }).waitFor();
  });

  const doctor = await setupPage();
  await measure('doctor_task_ms', async () => {
    await signIn(doctor, 'doctor');
    await step('doctor', 'Assigned to Me', () => doctor.getByRole('link', { name: /Assigned to Me/ }).click());
    await step('doctor', 'Enter Case ID', () => doctor.getByLabel('Search Cases').fill('ims-demo-101'));
    await openCase(doctor, caseNumber, 'doctor');
    await measure('detail_to_first_slide_ms', async () => {
      await step('doctor', 'Open Viewer', () => doctor.getByRole('button', { name: 'Open Viewer', exact: true }).click());
      transitions.doctor++;
      await displayed(doctor);
      await doctor.getByRole('complementary').getByRole('button', { name: /SYNTH-01.*NDPI/, pressed: true }).waitFor();
    });
    const zoom = doctor.getByLabel('Zoom relative to scan');
    const initial = await zoom.innerText();
    const canvas = doctor.getByLabel('WSI Canvas');
    const position = await canvas.boundingBox();
    await canvas.hover();
    const tile = doctor.waitForResponse((response) => tilePattern(fixture.entries.NDPI).test(response.url()) && response.ok());
    await measure('wheel_to_zoom_update_ms', async () => {
      await step('doctor', 'Zoom with Wheel', () => doctor.mouse.wheel(0, -320));
      await doctor.waitForFunction((label) => document.querySelector('.zoom-value')?.textContent !== label, initial);
    });
    for (let zoomClick = 0; zoomClick < 3; zoomClick++) {
      await step('doctor', 'Zoom In Further', () => doctor.getByRole('button', { name: 'Zoom In', exact: true }).click());
    }
    assert.match((await tile).headers()['content-type'], /image\/jpeg/);
    const initialRegion = await doctor.locator('.minimap span').getAttribute('style');
    await doctor.mouse.move(position.x + position.width / 2, position.y + position.height / 2);
    await measure('drag_to_viewport_update_ms', async () => {
      await step('doctor', 'Drag Canvas', async () => {
        await doctor.mouse.down();
        await doctor.mouse.move(position.x + position.width / 2 + 100, position.y + position.height / 2 + 60, { steps: 4 });
        await doctor.mouse.up();
      });
      await doctor.waitForFunction((region) => document.querySelector('.minimap span')?.getAttribute('style') !== region, initialRegion);
    });
    await measure('ndpi_to_svs_ms', () => selectScan(doctor, 'SVS', 'doctor'));
    const svsTile = doctor.waitForResponse((response) => tilePattern(fixture.entries.SVS).test(response.url()) && response.ok());
    for (let zoomClick = 0; zoomClick < 4; zoomClick++) {
      await step('doctor', 'Zoom In on SVS', () => doctor.getByRole('button', { name: 'Zoom In', exact: true }).click());
    }
    assert.match((await svsTile).headers()['content-type'], /image\/jpeg/);
    await review(doctor, 'Start Review', 'Start Demo Review');
    await review(doctor, 'Review Complete', 'Complete Demo Review', memo);
    await doctor.waitForFunction(() => document.querySelector('.page-heading .status-pill')?.textContent === 'Review Complete');
  });

  const viewerUrl = doctor.url();
  for (let cycle = 0; cycle < 5; cycle++) {
    const row = {};
    for (const format of ['NDPI', 'SVS']) {
      const start = performance.now();
      await selectScan(doctor, format);
      row[format] = Math.round(performance.now() - start);
    }
    sampleRuns.push(row);
  }
  await doctor.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await doctor.getByRole('button', { name: 'Sign In', exact: true }).waitFor();
  await signInAfterLogout();
  async function signInAfterLogout() {
    await doctor.getByLabel('Username').fill(accounts.doctor);
    await doctor.getByLabel('Password').fill(password);
    await doctor.getByRole('button', { name: 'Sign In', exact: true }).click();
    await doctor.waitForURL(viewerUrl);
    await displayed(doctor);
    await doctor.getByRole('button', { name: 'Case Details', exact: true }).click();
    await doctor.getByRole('button', { name: 'History', exact: true }).click();
    await doctor.getByText(memo, { exact: true }).waitFor();
    const audit = await (await doctor.request.get(detailPath(fixture.record.id))).json();
    assert.equal(audit.status, 'reviewed');
    assert.equal(audit.audit[0].after.review_note, memo);
  }

  const unauthenticated = await setupPage();
  assert.equal((await unauthenticated.request.get(fixture.entries.NDPI.url + '/2/0/0.jpeg')).status(), 401);
  await unauthenticated.getByLabel('Username').fill(accounts.other);
  await unauthenticated.getByLabel('Password').fill('invalid-synthetic-password');
  await unauthenticated.getByRole('button', { name: 'Sign In', exact: true }).click();
  await unauthenticated.getByRole('alert').getByText('Check your username and password.').waitFor();
  retries++;
  await signIn(unauthenticated, 'other', false);
  assert.equal((await unauthenticated.request.get(detailPath(fixture.record.id))).status(), 404);
  assert.equal((await unauthenticated.request.get(fixture.entries.NDPI.url + '/2/0/0.jpeg')).status(), 404);
  assert.equal((await unauthenticated.request.patch(`${clinical}/cases/${fixture.record.id}/assignment`, {
    data: { version: 1, assignee_id: (await (await unauthenticated.request.get('/api/auth/me')).json()).id, reason: 'Denied test' },
  })).status(), 403);

  await admin.getByRole('button', { name: 'Worklist', exact: true }).click();
  await admin.getByLabel('Search Cases').fill('does-not-exist');
  await admin.getByText('No cases match these filters.').waitFor();
  await admin.getByLabel('Search Cases').fill(missingNumber);
  await openCase(admin, missingNumber);
  assert.ok(await admin.getByRole('button', { name: 'Open Viewer', exact: true }).isDisabled());
  const doctorId = (await (await doctor.request.get('/api/auth/me')).json()).id;
  const assignment = await admin.request.patch(`${clinical}/cases/${fixture.missing.id}/assignment`, {
    data: { version: 1, assignee_id: doctorId, reason: 'Incomplete input fixture' },
  });
  assert.equal(assignment.status(), 200);
  const incomplete = await doctor.request.patch(`${clinical}/cases/${fixture.missing.id}/review`, {
    data: { version: 2, status: 'in_review', reason: 'Incomplete input fixture' },
  });
  assert.equal(incomplete.status(), 409);

  await doctor.goto(viewerUrl.replace(/\/[^/]*$/, '/' + fixture.entries.NDPI.id));
  await displayed(doctor);
  const rejectTile = (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Synthetic tile outage"}' });
  await doctor.route(tilePattern(fixture.entries.NDPI), rejectTile);
  const zoomIn = doctor.getByRole('button', { name: 'Zoom In', exact: true });
  for (let click = 0; click < 8; click++) await zoomIn.click();
  await doctor.getByText('Some tiles could not be loaded.', { exact: false }).waitFor();
  await doctor.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const previous = await doctor.getByLabel('Zoom relative to scan').innerText();
  const previousRect = await doctor.locator('.minimap span').getAttribute('style');
  await doctor.unroute(tilePattern(fixture.entries.NDPI), rejectTile);
  const recovered = doctor.waitForResponse((response) => tilePattern(fixture.entries.NDPI).test(response.url()) && response.ok());
  await doctor.getByRole('button', { name: 'Retry', exact: true }).click();
  retries++;
  const jpeg = await recovered;
  assert.match(jpeg.headers()['content-type'], /image\/jpeg/);
  assert.equal(jpeg.headers()['cache-control'], 'private, no-store');
  await doctor.getByText('Some tiles could not be loaded.', { exact: false }).waitFor({ state: 'hidden' });
  assert.equal(await doctor.getByLabel('Zoom relative to scan').innerText(), previous);
  assert.equal(await doctor.locator('.minimap span').getAttribute('style'), previousRect);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    result: 'PASS', samples: fixture.entries, timings_ms: time, switch_runs_ms: sampleRuns,
    ui_actions: Object.fromEntries(Object.entries(actions).map(([actor, events]) => [actor, events.length])),
    normal_screen_transitions: transitions, normal_errors: 0, normal_retries: 0,
    injected_retries: retries, javaScript_errors: errors.length,
    failures_verified: ['bad credentials', 'anonymous tile', 'unassigned case and tile', 'assignment RBAC',
      'search empty', 'missing scan', 'tile 503 then recover'],
    environments_verified: { emr: 'unconfigured', reopened_note: true },
  }, null, 2));
} finally {
  await browser.close();
}
