import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const button = (root, name) => root.getByRole('button', { name, exact: true });

async function checked(response, status = 200) {
  const result = await response;
  assert.equal(result.status(), status, await result.text());
  return result.json();
}

try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1540, height: 1000 } });
  page.setDefaultTimeout(18000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await checked(page.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-admin', password: 'synthetic-test-password',
  } }));
  const listing = await checked(page.request.get('/api/worklist?q=IMS-DEMO-101'));
  const caseRecord = listing.rows.find((item) => item.case_number === 'IMS-DEMO-101');
  const caseId = caseRecord.record_id;

  async function makeRoi(format, name, points) {
    const scan = caseRecord.slides.find((value) => value.wsi.format === format).id;
    const wsi = '/api/wsi/clinical/' + scan;
    const result = await checked(page.request.post(wsi + '/viewer-records/annotations', { data: {
      id: randomUUID(), kind: 'rectangle', points, label: name,
    } }), 201);
    return { scan, name, result, url: '/#viewer/' + caseId + '/' + scan, endpoint: wsi + '/roi-search/rois/' + result.id };
  }

  const source = await makeRoi('NDPI', 'Synthetic source ROI', [[24500, 29000], [25500, 30000]]);
  const target = await makeRoi('SVS', 'Synthetic target ROI', [[34000, 43000], [35000, 44000]]);
  const archived = page.getByRole('region', { name: 'Review Position and Annotations' });
  const organ = page.getByRole('combobox', { name: 'Organ System' });
  const results = page.getByRole('region', { name: 'Similar ROI Results' });
  const sourceImage = page.getByRole('img', { name: 'Source ROI preview' });

  async function openSearch(roi) {
    await page.goto(roi.url);
    await button(page, 'Annotations').click();
    const item = archived.getByRole('listitem').filter({ hasText: roi.name });
    await item.getByRole('link', { name: 'Find Similar ROIs', exact: true }).click();
    await page.getByRole('heading', { name: 'ROI Similarity Search', exact: true }).waitFor();
    await organ.waitFor();
  }

  await openSearch(target);
  await sourceImage.waitFor();
  await page.waitForFunction(() => document.querySelector('.roi-search-preview img')?.naturalWidth === 256);
  await organ.selectOption('digestive');
  await page.getByText('Local Reference', { exact: true }).click();
  await button(page, 'Save as Local Reference').click();
  await page.getByText('Indexed as Digestive.', { exact: true }).waitFor();

  const previewPath = '**' + source.endpoint + '/preview.png?*';
  await page.route(previewPath, (route) => route.fulfill({ status: 503 }), { times: 1 });
  await openSearch(source);
  await button(page, 'Retry Preview').click();
  await sourceImage.waitFor();
  await page.waitForFunction(() => document.querySelector('.roi-search-preview img')?.naturalWidth === 256);
  await organ.selectOption('respiratory');
  await button(page, 'Search Similar ROIs').click();
  await results.getByText('No other indexed ROIs match this organ system in this case.', { exact: true }).waitFor();

  await organ.selectOption('digestive');
  await page.route('**' + source.endpoint + '/search', (route) => route.fulfill({ status: 503,
    json: { detail: 'Synthetic adapter outage. Try again.' } }), { times: 1 });
  await button(page, 'Search Similar ROIs').click();
  await page.getByRole('alert').getByText('Synthetic adapter outage. Try again.').waitFor();
  await button(page, 'Search Similar ROIs').click();
  await results.getByText('1 match · Digestive', { exact: true }).waitFor();
  await results.getByRole('img', { name: /Match on SVS slide/ }).waitFor();
  await page.waitForFunction(() => document.querySelector('.roi-search-results img')?.naturalWidth === 256);

  async function openAt(roi) {
    await page.waitForFunction(({ scan, points }) => {
      const image = document.querySelector('.image-panel');
      return image?.dataset.scanId === scan &&
        Math.abs(Number(image.dataset.viewCenterX) - (points[0][0] + points[1][0]) / 2) < 1 &&
        Math.abs(Number(image.dataset.viewCenterY) - (points[0][1] + points[1][1]) / 2) < 1;
    }, { scan: roi.scan, points: roi.result.points });
  }

  await results.getByRole('link', { name: 'Open Match in WSI' }).click();
  await openAt(target);
  await page.locator(`[data-selected-annotation="true"] [data-record="${target.result.id}"]`).waitFor();
  await page.getByRole('link', { name: 'Return to ROI Search' }).click();
  await sourceImage.waitFor();
  assert.equal(await organ.inputValue(), 'digestive');
  await button(page, 'Search Similar ROIs').click();
  await results.getByRole('link', { name: 'Open Match in WSI' }).click();
  await openAt(target);
  await page.getByRole('link', { name: 'Back to Source ROI' }).click();
  await openAt(source);
  const logs = await checked(page.request.get('/api/clinical/local/cases/' + caseId + '/logs', { params: {
    entity: 'roi_similarity',
  } }));
  const events = new Set(logs.rows.map((row) => row.action));
  assert.ok(events.has('roi_reference_saved'));
  assert.ok(events.has('roi_search_run'));
  assert.deepEqual(errors, []);
  console.log('PASS: ROI preview and retry, organ filtering, empty/results/failure, reference enrollment, exact target and source WSI focus, and audit');
} finally {
  await browser.close();
}
