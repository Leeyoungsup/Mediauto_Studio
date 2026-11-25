import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const dir = process.env.MEDIAUTO_WORKFLOW_EVIDENCE_DIR ?? '.runtime/workflow-51/probe';
await mkdir(dir, { recursive: true });
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome' });
const button = (root, name) => root.getByRole('button', { name, exact: true });
const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };
const resultTools = ['Pap Review', 'Pap Gallery', 'Skin Review', 'Prostate AI'];

async function login(role) {
  const page = await browser.newPage({ baseURL, viewport: desktop });
  const response = await page.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-' + role, password: 'synthetic-test-password',
  } });
  assert.equal(response.status(), 200);
  return page;
}

try {
  const page = await login('admin');
  const response = await page.request.get('/api/worklist?q=IMS-DEMO-101');
  assert.equal(response.status(), 200);
  const listing = await response.json();
  const record = listing.rows.find((row) => row.case_number === 'IMS-DEMO-101');
  assert.ok(record, 'Seed IMS-DEMO-101 before running the frontend probe.');
  const caseHash = '#case/' + record.record_id;
  const scan = record.slides.find(({ wsi }) => wsi?.format === 'NDPI');
  assert.ok(scan, 'Seed the NDPI sample before running the frontend probe.');
  const scanHash = `#viewer/${record.record_id}/${scan.id}`;
  await page.goto('/#worklist/all');
  const nav = page.getByRole('navigation', { name: 'Workspace Navigation'});
  await nav.getByRole('link', { name: 'My Cases', exact: true }).click();
  await page.waitForURL('**/#worklist/mine');
  await nav.getByRole('link', { name: 'Open Slide Intake', exact: true }).click();
  await page.waitForURL('**/#scans');
  await page.goto('/' + caseHash);
  await button(page, 'Open Viewer').click();
  await button(page, 'Pan using minimap').waitFor();
  const viewer = page.getByRole('region', { name: 'Slide Review' });
  const formats = [];
  const canvas = page.getByLabel('WSI Canvas', { exact: true });
  const analysisTab = viewer.getByRole('tab', { name: 'Analysis', exact: true });
  async function measureViewer() {
    await page.evaluate(() => window.scrollTo(0, 0));
    const visibleTools = await Promise.all(resultTools.map(async (name) => {
      return await button(viewer, name).isVisible() ? name : null;
    }));
    const bounds = await canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { canvasTop: Math.round(rect.top), canvasBottom: Math.round(rect.bottom) };
    });
    return {
      headingButtons: await page.locator('.viewer-heading').getByRole('button').count(),
      imageToolbarControls: await page.locator('.image-toolbar').getByRole('button').count(),
      analysisEntryPoints: await analysisTab.count() + await button(viewer, 'Analysis').count(),
      reviewButtons: visibleTools.filter(Boolean),
      applicationOverflow: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      viewportHeight: await page.evaluate(() => window.innerHeight),
      ...bounds,
    };
  }
  formats.push({ format: 'NDPI', ...await measureViewer() });
  await analysisTab.click();
  const analysis = viewer.getByRole('complementary', { name: 'Slide Analysis' });
  await analysis.getByText('Recent Runs', { exact: true }).waitFor();
  const methods = await analysis.getByRole('combobox', { name: 'Analysis Method'}).locator('option').allTextContents();
  await button(viewer, 'Close Slide Analysis').click();
  await button(viewer, 'Analysis').click();
  await analysis.getByText('Recent Runs', { exact: true }).waitFor();
  await button(viewer, 'Close Slide Analysis').click();
  const before = await page.locator('.image-panel').getAttribute('data-view-zoom');
  await viewer.getByRole('tab', { name: 'History', exact: true }).click();
  await viewer.getByRole('region', { name: 'Patient History Records' }).waitFor();
  const historyHidesCanvas = !await canvas.isVisible();
  await button(viewer, 'Return to Slides').click();
  assert.equal(await page.locator('.image-panel').getAttribute('data-view-zoom'), before);
  assert.equal(historyHidesCanvas, true);
  await viewer.getByRole('tab', { name: 'Requests', exact: true }).click();
  const requests = viewer.getByRole('tabpanel', { name: 'Requests', exact: true });
  await button(requests, 'New Request').click();
  assert.equal(await requests.getByLabel('Target Scan').inputValue(), scan.id);
  await button(requests, 'Return to Slides').click();
  await viewer.getByRole('tab', { name: 'History', exact: true }).click();
  await viewer.getByRole('link', { name: 'Open in Case Details', exact: true }).click();
  await page.waitForURL((url) => url.hash === `${caseHash}/history/${scan.id}`);
  await button(page, 'Open Viewer').click();
  await page.waitForURL((url) => url.hash === scanHash);
  await button(page, 'Pan using minimap').waitFor();
  await viewer.getByRole('button', { name: /SYNTH-01.*SVS/ }).click();
  await viewer.getByRole('button', { name: /SYNTH-01.*SVS/, pressed: true }).waitFor();
  await button(page, 'Pan using minimap').waitFor();
  formats.push({ format: 'SVS', ...await measureViewer() });
  await page.setViewportSize(mobile);
  await page.goto('/' + scanHash);
  await button(page, 'Pan using minimap').waitFor();
  const compact = await measureViewer();
  await page.screenshot({ path: join(dir, '51-viewer-390.png') });
  await page.setViewportSize(desktop);
  await page.goto('/' + scanHash);
  await button(page, 'Pan using minimap').waitFor();
  await page.screenshot({ path: join(dir, '51-viewer-1440.png') });
  await page.goto('/#settings/accounts/audit');
  await page.getByRole('region', { name: 'Account Audit Log', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Audit Log', exact: true }).waitFor();
  const doctor = await login('doctor');
  await doctor.goto('/#settings/accounts/audit');
  await doctor.getByText('You do not have permission to open this page.', { exact: true }).waitFor();
  const doctorAuditApi = (await doctor.request.get('/api/auth/account-audit')).status();
  assert.equal(doctorAuditApi, 403);
  const doctorCanSeeAccountAudit = await doctor.getByRole('tab', { name: 'Audit Log', exact: true }).isVisible();
  assert.equal(doctorCanSeeAccountAudit, false);
  assert.ok([...formats, compact].every(({ applicationOverflow }) => applicationOverflow === 0));
  const results = {
    formats, compact, reviewControlsUseSameAnalysisPanel: true, methods,
    historyHidesCanvas, returnedWithSameZoom: true, caseDocumentReturnedToScan: true,
    viewerRequestPrefilledScan: true, doctorCanSeeAccountAudit, doctorAuditApi,
    stainByScan: record.slides.map(({ stain, wsi }) => ({ stain, format: wsi.format })),
  };
  await writeFile(join(dir, '51-frontend-probe.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('PASS: final frontend comparison, exact scan return, request prefill and account audit scope');
} finally {
  await browser.close();
}
