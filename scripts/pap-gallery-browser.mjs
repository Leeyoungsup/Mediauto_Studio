import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clinical = '/api/clinical/local';
async function read(request, expected = 200) {
  const response = await request;
  assert.equal(response.status(), expected, await response.text());
  return response.json();
}
async function signIn(page, username) {
  await read(page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  } }));
}
async function newPage() {
  const page = await browser.newPage({ baseURL: process.env.MEDIAUTO_DEMO_URL, viewport: { width: 1520, height: 1010 } });
  page.setDefaultTimeout(25000);
  return page;
}

try {
  const page = await newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, 'integration-admin');
  const { rows } = await read(page.request.get('/api/worklist?q=IMS-DEMO-MULTI'));
  const record = rows.find((row) => row.case_number === 'IMS-DEMO-MULTI');
  assert.ok(record);
  const scans = [];
  for (const label of ['I-KI', 'I-PR', 'I-HR']) {
    const id = record.slides.find((scan) => scan.label === label).id;
    const scan = await read(page.request.get(clinical + '/scans/' + id));
    const slide = await read(page.request.get(clinical + '/slides/' + scan.slide_id));
    await read(page.request.patch(clinical + '/editor/slides/' + slide.id, {
      data: { slide_number: slide.slide_number, version: slide.version, block_id: slide.block_id,
        stain: 'Papanicolaou', reason: 'Synthetic Pap gallery fixture' },
    }));
    scans.push({ id, file: scan.storage_key, binding: { case_id: record.record_id, specimen_id: slide.specimen_id,
      slide_id: slide.id, block_id: slide.block_id } });
  }
  const [archive, empty] = JSON.parse(execFileSync(process.env.MEDIAUTO_PAP_TEST_PYTHON, [
    '-s', resolve(root, 'scripts/seed-pap-fixture.py'), process.env.MEDIAUTO_PAP_TEST_DIR, JSON.stringify([scans[0], scans[2]]),
  ], { cwd: resolve(root, 'backend'), env: { ...process.env, PYTHONPATH: resolve(root, 'backend') }, encoding: 'utf8' }));
  const apiFor = (id) => '/api/wsi/clinical/' + id + '/pap';
  const viewer = (id) => '/#viewer/' + record.record_id + '/' + id;
  const gallery = (p) => p.getByRole('complementary', { name: 'Pap Candidate Gallery', exact: true });
  async function open(p, id) {
    await p.goto(viewer(id));
    await p.getByRole('button', { name: 'Pap Gallery', exact: true }).click();
  }
  let lost = false;
  await page.route('**/candidates/Cell-01/thumbnail?attempt=*', async (route) => {
    if (!lost) { lost = true; await route.fulfill({ status: 503 }); }
    else await route.continue();
  });
  await open(page, scans[0].id);
  const panel = gallery(page);
  const category = panel.getByRole('combobox', { name: 'Candidate Category' });
  await panel.getByRole('button', { name: 'Retry thumbnail for Cell-01' }).click();
  const first = panel.getByRole('button', { name: 'Focus candidate Cell-01' });
  await first.locator('img').waitFor();
  const sampleImage = await page.request.get(apiFor(scans[0].id) + '/' + archive.id + '/candidates/Cell-01/thumbnail');
  assert.equal(sampleImage.status(), 200);
  assert.equal(sampleImage.headers()['content-type'], 'image/png');
  assert.ok((await sampleImage.body()).length > 100);
  await category.selectOption('organisms');
  await panel.getByText('No candidates in this category.', { exact: true }).waitFor();
  await category.selectOption('high_nc_ratio');
  await panel.getByRole('button', { name: 'Next Candidates' }).click();
  const cell = panel.getByRole('button', { name: 'Focus candidate Cell-21' });
  await cell.scrollIntoViewIfNeeded();
  await cell.locator('img').click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Focus candidate Cell-21"]')?.getAttribute('aria-pressed') === 'true');
  const route = apiFor(scans[0].id);
  let persisted;
  for (let index = 0; index < 40; index++) {
    persisted = await read(page.request.get(route));
    if (persisted.resume?.candidate.id === 'Cell-21') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(persisted.resume.candidate.id, 'Cell-21');
  assert.equal(persisted.resume.page, 2);
  const bounds = persisted.resume.candidate.bounds;
  async function checkCenter(p) {
    const x = (bounds[0] + bounds[2]) / 2;
    const y = (bounds[1] + bounds[3]) / 2;
    await p.waitForFunction(([x, y]) => {
      const element = document.querySelector('[data-view-center-x]');
      return Math.abs(Number(element?.dataset.viewCenterX) - x) < 2
        && Math.abs(Number(element?.dataset.viewCenterY) - y) < 2;
    }, [x, y]);
    await p.locator('svg[aria-label="Selected Pap Candidate"] rect').waitFor({ state: 'attached' });
  }
  await checkCenter(page);
  await panel.getByText('Model and Candidate Source', { exact: true }).click();
  await panel.getByText('Synthetic Pap Adapter · qa-model-1', { exact: true }).waitFor();
  await read(page.request.put(route + '/selection', { data: {
    archive_id: archive.id, candidate_id: 'Cell-01', expected_version: 0,
  } }), 409);
  const replay = await read(page.request.put(route + '/selection', { data: {
    archive_id: archive.id, candidate_id: 'Cell-21', expected_version: 0,
  } }));
  assert.equal(replay.version, persisted.cursor_version);

  const reopened = await newPage();
  await signIn(reopened, 'integration-admin');
  await open(reopened, scans[0].id);
  await gallery(reopened).getByRole('button', { name: 'Focus candidate Cell-21', pressed: true }).waitFor();
  await gallery(reopened).getByText('Page 2 of 2', { exact: true }).waitFor();
  assert.equal(await gallery(reopened).getByRole('combobox', { name: 'Candidate Category' }).inputValue(), 'high_nc_ratio');
  await checkCenter(reopened);

  const differentUser = await newPage();
  await signIn(differentUser, 'integration-editor-admin');
  assert.equal((await read(differentUser.request.get(route))).resume, null);
  const other = await newPage();
  await signIn(other, 'integration-other');
  await read(other.request.get(route), 404);
  await read(page.request.get(apiFor(scans[1].id) + '/' + archive.id), 404);
  await read(page.request.get(apiFor(scans[1].id) + '/' + archive.id + '/candidates/Cell-01/thumbnail'), 404);

  await open(page, scans[1].id);
  await panel.getByText('No Pap results have been received for this scan.', { exact: true }).waitFor();
  assert.equal(await page.locator('svg[aria-label="Selected Pap Candidate"]').count(), 0);
  await open(page, scans[2].id);
  await panel.getByText('This analysis contains no candidates.', { exact: true }).waitFor();
  const original = await readFile(empty.file);
  await writeFile(empty.file, '{}');
  await panel.getByRole('button', { name: 'Reload Gallery' }).click();
  await panel.getByRole('alert').getByText(/Pap results could not be verified/).waitFor();
  await writeFile(empty.file, original);
  await panel.getByRole('button', { name: 'Reload Gallery' }).click();
  await panel.getByText('This analysis contains no candidates.', { exact: true }).waitFor();

  assert.deepEqual(errors, []);
  console.log('PASS: Pap candidate input, category pagination, thumbnail and source, Level 0 focus, private resume after login, scan mismatch and empty/error recovery');
} finally {
  await browser.close();
}
