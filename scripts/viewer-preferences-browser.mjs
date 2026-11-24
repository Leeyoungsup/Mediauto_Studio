import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

async function signIn() {
  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const result = await page.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-viewer-admin', password: 'synthetic-test-password',
  } });
  assert.equal(result.status(), 200, await result.text());
  return page;
}

try {
  const page = await signIn();
  await page.goto('/');
  await page.getByLabel('Search Cases').fill('IMS-DEMO-101');
  const preview = page.getByRole('complementary', { name: 'Selected Case Preview' });
  const svs = preview.getByRole('button', { name: /SYNTH-01.*SVS/ });
  const ndpi = preview.getByRole('button', { name: /SYNTH-01.*NDPI/ });
  const svsId = await svs.getAttribute('data-scan-id');
  const ndpiId = await ndpi.getAttribute('data-scan-id');
  assert.ok(svsId && ndpiId && svsId !== ndpiId);
  await svs.click();
  const panel = page.getByRole('region', { name: 'Slide Image' });
  const minimap = button(page, 'Pan using minimap');
  await minimap.waitFor();
  assert.equal(await panel.getAttribute('data-scan-id'), svsId);
  await button(page, 'Case Details').click();
  const selected = page.locator('.detail-slide[aria-current=true]');
  assert.equal(await selected.getAttribute('data-scan-id'), svsId);
  await button(page, 'Open Viewer').click();
  await minimap.waitFor();
  assert.equal(await panel.getAttribute('data-scan-id'), svsId);

  let overviewAttempts = 0;
  let labelAttempts = 0;
  await page.route(`**/api/wsi/clinical/${ndpiId}/overview.jpeg`, async (route) => {
    if (++overviewAttempts === 1) await route.fulfill({ status: 503, json: { detail: 'Overview unavailable.' } });
    else await route.continue();
  });
  await page.route(`**/api/wsi/clinical/${ndpiId}/label.jpeg`, async (route) => {
    if (++labelAttempts === 1) await route.fulfill({ status: 503, json: { detail: 'Label unavailable.' } });
    else await route.continue();
  });
  const tray = page.locator('.viewer-tray');
  await tray.locator(`[data-scan-id="${ndpiId}"]`).click();
  await button(page, 'Retry Overview').waitFor();
  assert.equal(await panel.getAttribute('data-scan-id'), ndpiId);
  await button(page, 'Viewer Settings').click();
  const settings = page.getByRole('form', { name: 'Viewer Settings' });
  await settings.getByLabel('Slide Tray Orientation').selectOption('horizontal');
  await settings.getByLabel('Use gallery in slide tray').check();
  await settings.getByLabel('Show label image').check();
  await settings.getByLabel('Show overview image').check();
  await settings.getByLabel('Dynamic minimap size').check();
  await settings.getByLabel('Autopan Speed').selectOption('240');
  assert.equal(await page.locator('.viewer-layout').getAttribute('data-orientation'), 'horizontal');
  assert.equal(await tray.locator('.tray-items').getAttribute('data-gallery'), 'true');
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/viewer/preferences') && response.request().method() === 'PUT');
  await button(settings, 'Save as Default').click();
  assert.equal((await saved).status(), 200);
  await button(page, 'Viewer Settings').click();

  await button(page, 'Retry Overview').click();
  await button(page, 'Fit slide from overview').waitFor();
  await minimap.waitFor();
  const label = page.waitForResponse((response) => response.url().endsWith(`/${ndpiId}/label.jpeg`));
  await button(page, 'Retry Label').click();
  const labelResult = await label;
  assert.ok([200, 404].includes(labelResult.status()));
  if (labelResult.ok()) {
    assert.equal(labelResult.headers()['x-label-source'], 'embedded');
    await page.getByRole('img', { name: 'Scan label', exact: true }).waitFor();
  } else {
    await page.getByText(/No embedded label image/).waitFor();
  }
  assert.equal(await panel.getAttribute('data-autopan'), 'false');
  const initialWidth = (await minimap.boundingBox()).width;
  await button(page, 'Start Autopan').click();
  await page.getByText(/Autopan reached the edge/).waitFor();
  const canvas = page.getByLabel('WSI Canvas', { exact: true });
  await canvas.focus();
  for (let i = 0; i < 6; i++) await canvas.press('+');
  await page.waitForFunction((width) => document.querySelector('.minimap')?.getBoundingClientRect().width > width + 10, initialWidth);
  const before = Number(await panel.getAttribute('data-view-center-x'));
  await canvas.press('Space');
  await page.waitForFunction((x) => Number(document.querySelector('.image-panel').dataset.viewCenterX) > x + 20, before);
  await canvas.press('Space');
  await button(page, 'Start Autopan').waitFor();
  await canvas.press('Space');
  await button(page, 'Pause Autopan').waitFor();
  await canvas.press('ArrowLeft');
  await button(page, 'Start Autopan').waitFor();
  const zoomed = Number(await panel.getAttribute('data-view-zoom'));
  await button(page, 'Fit slide from overview').click();
  await page.waitForFunction((zoom) => Number(document.querySelector('.image-panel').dataset.viewZoom) < zoom, zoomed);
  await canvas.focus();
  await canvas.press('m');
  await minimap.waitFor({ state: 'hidden' });
  await canvas.press('m');
  await minimap.waitFor();
  await canvas.press('g');
  assert.equal(await tray.locator('.tray-items').getAttribute('data-gallery'), 'false');
  await canvas.press('f');
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('viewer-workbench'));
  await button(page, 'Exit Fullscreen').click();
  await page.waitForFunction(() => !document.fullscreenElement);

  const reopened = await signIn();
  await reopened.goto(page.url());
  await button(reopened, 'Pan using minimap').waitFor();
  await button(reopened, 'Viewer Settings').click();
  const restored = reopened.getByRole('form', { name: 'Viewer Settings' });
  assert.equal(await restored.getByLabel('Slide Tray Orientation').inputValue(), 'horizontal');
  assert.ok(await restored.getByLabel('Use gallery in slide tray').isChecked());
  assert.ok(await restored.getByLabel('Show label image').isChecked());
  assert.ok(await restored.getByLabel('Show overview image').isChecked());
  assert.equal(await restored.getByLabel('Autopan Speed').inputValue(), '240');
  await restored.getByLabel('Enable keyboard shortcuts').uncheck();
  await button(reopened, 'Viewer Settings').click();
  const reopenedCanvas = reopened.getByLabel('WSI Canvas', { exact: true });
  await reopenedCanvas.focus();
  await reopenedCanvas.press('m');
  assert.equal(await button(reopened, 'Minimap').getAttribute('aria-pressed'), 'true');
  assert.equal(await reopened.getByRole('region', { name: 'Slide Image' }).getAttribute('data-autopan'), 'false');
  console.log('PASS: exact scan selection and return, image retry, tray/gallery, dynamic minimap, keyboard/fullscreen, Autopan and session defaults');
} finally {
  await browser.close();
}
