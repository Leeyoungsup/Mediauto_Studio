import { demoEvidence } from './workflow-demo-evidence.mjs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const prefix = '/api/clinical/local';
const button = (root, name) => root.getByRole('button', { name, exact: true });

async function checked(response, status = 200) {
  const result = await response;
  assert.equal(result.status(), status, await result.text());
  return result.json();
}

async function login(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1520, height: 1050 } });
  page.setDefaultTimeout(20000);
  await checked(page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  } }));
  return page;
}

const evidence = demoEvidence('collaboration');

try {
  const owner = await login('integration-admin');
  const peer = await login('integration-doctor');
  await evidence.observe(owner, 'Session owner');
  await evidence.observe(peer, 'Invited pathologist');
  const errors = [];
  for (const page of [owner, peer]) page.on('pageerror', ({ message }) => errors.push(message));
  const account = await checked(peer.request.get('/api/auth/me'));
  const { rows } = await checked(owner.request.get('/api/worklist?q=IMS-DEMO-101'));
  const item = rows.find((value) => value.case_number === 'IMS-DEMO-101');
  const record = await checked(owner.request.get(prefix + '/cases/' + item.record_id));
  if (record.assigned_to !== account.id) {
    await checked(owner.request.patch(prefix + '/cases/' + record.id + '/assignment', { data: {
      version: record.version, assignee_id: account.id, reason: 'Synthetic collaborative review assignment',
    } }));
  }
  const ndpi = item.slides.find((scan) => scan.wsi.format === 'NDPI').id;
  const svs = item.slides.find((scan) => scan.wsi.format === 'SVS').id;
  const route = '/#viewer/' + record.id + '/' + ndpi;
  const panel = (page) => page.getByRole('region', { name: 'Collaborative Review', exact: true });
  const image = (page) => page.locator('.image-panel');
  const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const camera = (page) => image(page).evaluate((element) => ({
    scan: element.dataset.scanId, x: Number(element.dataset.viewCenterX), y: Number(element.dataset.viewCenterY),
    zoom: Number(element.dataset.viewZoom),
  }));
  const compare = async (following, expected) => {
    try {
      await following.waitForFunction((expected) => {
      const element = document.querySelector('.image-panel');
      return element?.dataset.scanId === expected.scan &&
        Math.hypot(Number(element.dataset.viewCenterX) - expected.x, Number(element.dataset.viewCenterY) - expected.y) < .1 &&
        Math.abs(Number(element.dataset.viewZoom) - expected.zoom) < .000001;
      }, expected);
    } catch (failure) {
      throw new Error('Camera mismatch: ' + JSON.stringify({ expected, actual: await camera(following) }), { cause: failure });
    }
    const actual = await camera(following);
    return { centerErrorPx: Math.hypot(actual.x - expected.x, actual.y - expected.y), zoomError: Math.abs(actual.zoom - expected.zoom) };
  };
  async function open(page) {
    await page.goto(route);
    try {
      await page.waitForFunction(() => Number(document.querySelector('.image-panel')?.dataset.viewZoom) > 0);
    } catch (failure) {
      throw new Error('Viewer did not load. ' + (await page.locator('main').innerText()).slice(0, 1000) + ' ' + errors.join(' '), { cause: failure });
    }
    await button(page, 'Collaborative Review').click();
    await panel(page).getByRole('status').filter({ hasText: 'Connected' }).waitFor();
  }
  await open(owner);
  await button(panel(owner), 'Start Review Session').click();
  await panel(owner).getByText('Driving', { exact: true }).waitFor();
  await panel(owner).getByRole('combobox', { name: 'Invite Participant' }).selectOption(account.id);
  await button(panel(owner), 'Invite').click();
  await open(peer);
  await button(panel(peer), 'Join Review Session').click();
  await button(panel(peer), 'Follow Driver').click();
  await panel(peer).getByText('Following', { exact: true }).waitFor();
  assert.ok(await button(peer, 'Zoom In').isDisabled());

  const changeAt = performance.now();
  await owner.locator('.tray-item[data-scan-id="' + svs + '"]').click();
  await owner.waitForFunction((scan) => document.querySelector('.image-panel')?.dataset.scanId === scan &&
    Number(document.querySelector('.image-panel')?.dataset.viewZoom) > 0, svs);
  await compare(peer, await camera(owner));
  const switchMs = Math.round(performance.now() - changeAt);
  const fittedDriver = await camera(owner);
  await peer.setViewportSize({ width: 1280, height: 900 });
  await settle(peer);
  await compare(peer, fittedDriver);
  await peer.setViewportSize({ width: 1520, height: 1050 });
  await settle(peer);
  await compare(peer, fittedDriver);
  for (let i = 0; i < 5; i++) await button(owner, 'Zoom In').click();
  await settle(owner);
  await compare(peer, await camera(owner));

  const can = owner.getByLabel('WSI Canvas', { exact: true });
  await can.scrollIntoViewIfNeeded();
  const box = await can.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const beforePan = await camera(owner);
  const start = performance.now();
  await owner.mouse.move(x, y);
  await owner.mouse.down();
  await owner.mouse.move(x + 63, y - 31, { steps: 4 });
  await owner.mouse.up();
  await settle(owner);
  await owner.waitForFunction((before) => Math.abs(Number(document.querySelector('.image-panel')?.dataset.viewCenterX) - before) > 1, beforePan.x);
  const pan = await compare(peer, await camera(owner));
  const panMs = Math.round(performance.now() - start);

  await button(panel(peer), 'Stop Following').click();
  await panel(peer).getByText('Independent View', { exact: true }).waitFor();
  const independent = await camera(peer);
  await button(owner, 'Zoom In').click();
  await owner.waitForFunction((zoom) => Number(document.querySelector('.image-panel')?.dataset.viewZoom) > zoom, independent.zoom);
  assert.deepEqual(await camera(peer), independent);
  await button(panel(peer), 'Follow Driver').click();
  await compare(peer, await camera(owner));

  await peer.context().setOffline(true);
  await panel(peer).getByRole('status').filter({ hasText: 'Reconnecting' }).waitFor();
  const oldZoom = (await camera(owner)).zoom;
  await button(owner, 'Zoom In').click();
  await owner.waitForFunction((zoom) => Number(document.querySelector('.image-panel')?.dataset.viewZoom) > zoom, oldZoom);
  const reconnect = performance.now();
  await peer.context().setOffline(false);
  await panel(peer).getByRole('status').filter({ hasText: 'Connected' }).waitFor();
  await compare(peer, await camera(owner));
  const reconnectMs = Math.round(performance.now() - reconnect);
  await peer.reload();
  await panel(peer).getByText('Following', { exact: true }).waitFor();
  await compare(peer, await camera(owner));

  const handoffStart = performance.now();
  await panel(owner).getByRole('combobox', { name: 'Next Driver' }).selectOption(account.id);
  await button(panel(owner), 'Hand Off Drive').click();
  await panel(peer).getByText('Driving', { exact: true }).waitFor();
  await evidence.capture(panel(peer), 'drive-handoff');
  const handoffMs = Math.round(performance.now() - handoffStart);
  await button(panel(owner), 'Follow Driver').click();
  await button(peer, 'Zoom Out').click();
  await settle(peer);
  const handoff = await compare(owner, await camera(peer));

  await button(panel(owner), 'Revoke ' + account.display_name).click();
  await panel(peer).getByText('No review invitation is available for this account.', { exact: true }).waitFor();
  await panel(owner).getByText('Driving', { exact: true }).waitFor();
  assert.ok(await image(peer).isVisible());

  const logs = await checked(owner.request.get(prefix + '/cases/' + record.id + '/logs', { params: { action: 'review_drive_changed' } }));
  assert.ok(logs.rows.length >= 2);
  await button(panel(owner), 'End Session').click();
  await button(panel(owner), 'Start Review Session').waitFor();
  assert.deepEqual(errors, []);
  await evidence.finish();
  console.log('PASS: paired WSI review, scan and camera sync, Follow pause, offline recovery, refresh, handoff, and invitation revocation');
  console.log('Synthetic same-viewport review:', { pan, handoff, switchMs, panMs, reconnectMs, handoffMs, networkInterruptions: 1, refreshes: 1, handoffActions: 2 });
} finally {
  await browser.close();
}
