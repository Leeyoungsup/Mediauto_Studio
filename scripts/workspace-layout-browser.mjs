import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const wide = { width: 2560, height: 1080 };
const compact = { width: 390, height: 844 };
const button = (page, name) => page.getByRole('button', { name, exact: true });

try {
  const page = await browser.newPage({ baseURL, viewport: wide });
  page.setDefaultTimeout(12000);
  const login = await page.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-admin', password: 'synthetic-test-password',
  }});
  assert.equal(login.status(), 200, await login.text());
  await page.goto('/');
  await page.getByRole('heading', { name: 'Worklist', exact: true }).waitFor();
  const table = page.getByRole('region', { name: 'Case List' });
  const preview = page.getByRole('complementary', { name: 'Selected Case Preview' });
  const workspace = page.locator('.workspace-main');
  const before = await table.boundingBox();
  assert.ok((await workspace.boundingBox()).width > 2300, 'Wide desktop workspace should fill the available width');
  await button(page, 'Hide Case Preview').click();
  await preview.waitFor({ state: 'hidden' });
  assert.ok((await table.boundingBox()).width > before.width + 200, 'Hiding preview should expand the case list');
  await button(page, 'Show Case Preview').click();
  await preview.waitFor();
  await button(page, 'Collapse Navigation').click();
  assert.ok((await table.boundingBox()).width > before.width + 100, 'The navigation rail should release workspace width');
  await button(page, 'Expand Navigation').click();
  assert.equal(await page.getByRole('link', { name: 'Open Tumor Board and Collections', exact: true }).getAttribute('href'), '#collections');
  assert.equal(await page.getByRole('link', { name: 'Open Operating Room Results', exact: true }).getAttribute('href'), '#or');
  const previewTabs = preview.getByRole('tablist', { name: 'Case Preview Workspace' });
  await previewTabs.getByRole('tab', { name: 'Case Summary', exact: true }).click();
  await preview.getByRole('tabpanel', { name: 'Case Summary' }).getByText('Accessioned At', { exact: true }).waitFor();
  await previewTabs.getByRole('tab', { name: 'Review', exact: true }).click();
  await preview.getByRole('tabpanel', { name: 'Review' }).getByText('LIS Case Status', { exact: true }).waitFor();
  await previewTabs.getByRole('tab', { name: 'Slides', exact: true }).click();

  await page.getByLabel('Search Cases').fill('IMS-DEMO-101');
  await button(page, 'IMS-DEMO-101 details').click();
  await page.getByRole('heading', { name: 'IMS-DEMO-101', exact: true }).waitFor();
  const slides = page.locator('.detail-slide');
  assert.equal(await slides.count(), 2);
  assert.equal((await slides.nth(0).boundingBox()).y, (await slides.nth(1).boundingBox()).y);
  await button(page, 'Open Viewer').click();
  await button(page, 'Pan using minimap').waitFor();
  const canvas = page.getByLabel('WSI Canvas', { exact: true });
  const originalCanvas = await canvas.elementHandle();
  const canvasBefore = await canvas.boundingBox();
  assert.ok(canvasBefore.height > wide.height * .78, 'The slide should use most of the available screen height');
  assert.ok(canvasBefore.y + canvasBefore.height <= wide.height + 8, `The desktop image should fit in the initial viewport: ${JSON.stringify(canvasBefore)}`);
  await button(page, 'Hide Slide Tray').click();
  await page.getByRole('heading', { name: 'Slide Tray', exact: true }).waitFor({ state: 'hidden' });
  assert.ok((await canvas.boundingBox()).width > canvasBefore.width + 120, 'Hiding the slide tray should expand the WSI');
  assert.ok(await canvas.evaluate((node, original) => node === original, originalCanvas));
  await button(page, 'Show Slide Tray').click();
  await page.getByRole('heading', { name: 'Slide Tray', exact: true }).waitFor();
  const viewerTabs = page.getByRole('tablist', { name: 'Viewer Workspace', exact: true });
  await viewerTabs.getByRole('tab', { name: 'Slides', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const history = page.getByRole('tabpanel', { name: 'History', exact: true });
  await history.getByRole('region', { name: 'Patient History Records' }).waitFor();
  assert.equal(await canvas.isVisible(), false);
  await button(history, 'Return to Slides').click();
  assert.ok(await canvas.evaluate((node, original) => node === original, originalCanvas));
  assert.equal(await viewerTabs.getByRole('tab', { name: 'Slides', exact: true }).getAttribute('aria-selected'), 'true');

  await page.setViewportSize(compact);
  await page.goto('/');
  await page.getByLabel('Search Cases').fill('IMS-DEMO-101');
  await button(page, 'IMS-DEMO-101 details').waitFor();
  await page.locator('details.sort-menu > summary').click();
  await page.getByLabel('1: Sort Field').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Worklist must not overflow horizontally');
  await page.locator('details.sort-menu > summary').click();
  await button(page, 'IMS-DEMO-101 details').click();
  await page.getByRole('heading', { name: 'IMS-DEMO-101', exact: true }).waitFor();
  await button(page, 'Open Viewer').click();
  await button(page, 'Pan using minimap').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Viewer must not overflow horizontally');
  assert.ok((await canvas.boundingBox()).width >= compact.width - 26);
  await page.getByRole('button', { name: /SYNTH-01.*SVS/ }).click();
  await page.getByRole('button', { name: /SYNTH-01.*SVS/, pressed: true }).waitFor();
  await button(page, 'Pan using minimap').waitFor();
  console.log('PASS: full-width desktop Worklist, expandable WSI, responsive navigation and 390px viewer');
} finally {
  await browser.close();
}
