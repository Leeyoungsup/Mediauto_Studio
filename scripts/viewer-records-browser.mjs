import assert from 'node:assert/strict';
const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';

const browser = await chromium.launch({executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true});
try {
  const page = await browser.newPage({baseURL, viewport: { width: 1400, height: 980 }});
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function signIn() {
    await page.getByLabel('Username').fill('integration-admin');
    await page.getByLabel('Password').fill('synthetic-test-password');
    await page.getByRole('button',{name:'Sign In',exact:true}).click();
  }
  await page.goto('/');
  await signIn();
  await page.getByRole('heading',{name:'Worklist',exact:true}).waitFor();
  const list = await (await page.request.get('/api/worklist')).json();
  const record = list.rows.find(row=>row.case_number==='IMS-DEMO-101');
  const scan = record.slides.find(slide=>slide.wsi.format==='NDPI');
  const wsi = '/api/wsi/clinical/' + scan.id;
  const path = wsi + '/viewer-records';
  const metadata = await (await page.request.get(wsi)).json();
  const records = async () => (await page.request.get(path)).json();
  await page.getByRole('button',{name:'IMS-DEMO-101 details'}).click();
  await page.getByRole('heading',{name:'IMS-DEMO-101',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open Viewer',exact:true}).click();
  const canvas = page.getByLabel('WSI Canvas');
  const position = page.getByRole('button',{name:'Save Position',exact:true});
  const points = [[-70,-55],[65,42]];
  const close = (a,b,tolerance=0.00001) => assert.ok(Math.abs(a-b)<tolerance,`expected ${a} vs ${b}`);
  async function draw(tool) {
    await page.getByRole('button',{name:tool,exact:true}).click();
    await canvas.scrollIntoViewIfNeeded();
    const region = await canvas.boundingBox();
    const start = points[0].map((value,ix)=>value+[region.x+region.width/2,region.y+region.height/2][ix]);
    const end = points[1].map((value,ix)=>value+[region.x+region.width/2,region.y+region.height/2][ix]);
    await page.mouse.move(...start);
    await page.mouse.down();
    await page.mouse.move(...end,{steps:4});
    await page.mouse.up();
    await page.getByRole('textbox',{name:'Annotation Name'}).waitFor();
    return region;
  }
  await page.getByRole('button',{name:'Pan using minimap'}).waitFor();
  const region = await draw('Rectangular ROI');
  await page.getByRole('textbox',{name:'Annotation Name'}).fill('Synthetic ROI');
  const reject = (route)=>route.fulfill({status:503, contentType:'application/json',body:'{"detail":"QA save failure"}'});
  await page.route('**' + path + '/annotations', reject);
  await page.getByRole('button',{name:'Save Annotation',exact:true}).click();
  await page.getByRole('alert').getByText('QA save failure').waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Annotation Name'}).inputValue(),'Synthetic ROI');
  assert.equal((await records()).annotations.length,0);
  await page.unroute('**' + path + '/annotations', reject);
  await page.getByRole('button',{name:'Save Annotation',exact:true}).click();
  await page.getByText('Synthetic ROI',{exact:true}).waitFor();
  await page.getByRole('button', { name: 'Export Current View', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export Current View' });
  const preview = exportDialog.getByRole('img', { name: 'Current slide view preview' });
  await preview.waitFor();
  const annotatedPreview = await preview.getAttribute('src');
  assert.equal(await exportDialog.getByLabel('Include Saved Annotations').isChecked(), true);
  await exportDialog.getByLabel('Include Saved Annotations').uncheck();
  await page.waitForFunction((url) => !!document.querySelector('.viewport-export-preview img')?.src
    && document.querySelector('.viewport-export-preview img').src !== url, annotatedPreview);
  await exportDialog.getByLabel('Format').selectOption('image/jpeg');
  await exportDialog.getByLabel('Resolution').selectOption('0.5');
  const expectedImageWidth = Number((await exportDialog.getByLabel('Resolution').locator('option:checked').textContent()).split(' ')[0]);
  await page.waitForFunction((width) => document.querySelector('.viewport-export-preview img')?.naturalWidth === width, expectedImageWidth);
  await exportDialog.getByRole('slider', { name: 'Preview Zoom' }).focus();
  await page.keyboard.press('End');
  await exportDialog.getByText('300%', { exact: true }).waitFor();
  const download = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Download Image' }).click();
  assert.equal((await download).suggestedFilename(), 'slide-current-view.jpg');
  const logged = await page.request.get(`/api/clinical/local/cases/${record.record_id}/logs`, { params: { action: 'viewport_exported' } });
  assert.equal(logged.status(), 200);
  assert.ok(JSON.stringify(await logged.json()).includes('viewport_exported'));
  await exportDialog.getByRole('button', { name: 'Close', exact: true }).click();
  const roi = (await records()).annotations[0];
  const fit = Math.min(Math.round(region.width) / metadata.dimensions[0],Math.round(region.height) / metadata.dimensions[1]);
  // Browser pointer coordinates are expressed in CSS pixels, then projected to level 0.
  for (const [index, point] of roi.points.entries()) {
    for (const [axis, value] of point.entries()) {
      close(value, metadata.dimensions[axis] / 2 + points[index][axis] / fit, 0.75 / fit);
    }
  }
  const initialWidth = Number(await page.locator('rect.annotation-roi').getAttribute('width'));

  await draw('Distance Measurement');
  await page.getByRole('textbox',{name:'Annotation Name'}).fill('Synthetic distance');
  await page.getByRole('button',{name:'Save Annotation',exact:true}).click();
  await page.getByText('Synthetic distance',{exact:true}).waitFor();
  const distance = (await records()).annotations.find(a=>a.kind==='distance');
  assert.equal(distance.unit,'um');
  const [[x1,y1],[x2,y2]] = distance.points;
  close(distance.length,Math.hypot((x2-x1)*metadata.mpp_x,(y2-y1)*metadata.mpp_y));
  const readable = await page.locator('.annotation-length').textContent();
  assert.match(readable,/mm|µm/);

  for (let click = 0; click < 4; click++) await page.getByRole('button',{name:'Zoom In',exact:true}).click();
  await page.waitForFunction((width) => Math.abs(Number(document.querySelector('rect.annotation-roi')?.getAttribute('width')) / width - 1.4 ** 4) < .001, initialWidth);
  await page.getByRole('button', { name: 'Close Annotations', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const area = await canvas.boundingBox();
  await page.mouse.move(area.x+area.width/2,area.y+area.height/2);
  await page.mouse.down();
  await page.mouse.move(area.x+area.width/2+100,area.y+area.height/2+40,{steps:4});
  await page.mouse.up();
  await position.click();
  await page.getByText('Review position saved.').waitFor();
  const read = await records();
  assert.notEqual(read.position.x,metadata.dimensions[0]/2);
  const displayWidth = await page.locator('rect.annotation-roi').getAttribute('width');
  const displayX = await page.locator('rect.annotation-roi').getAttribute('x');
  assert.equal(await page.locator('.annotation-length').textContent(),readable);

  const viewerHash = page.url();
  await page.reload();
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  await page.getByText('Synthetic distance',{exact:true}).waitFor();
  await page.waitForFunction((attributes) => {
    const roi = document.querySelector('rect.annotation-roi');
    return roi && Math.abs(Number(roi.getAttribute('x')) - Number(attributes.x)) < 0.01
      && Math.abs(Number(roi.getAttribute('width')) - Number(attributes.width)) < 0.01;
  }, {x:displayX,width:displayWidth});
  assert.deepEqual((await records()).position,read.position);
  await page.locator('.viewer-tray').getByRole('button',{name:/SYNTH-01.*SVS/}).click();
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  await page.getByText('No saved annotations.',{exact:true}).waitFor();
  await page.locator('rect.annotation-roi').waitFor({state:'detached'});
  await page.goto(viewerHash);
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  await page.getByText('Synthetic ROI',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Sign Out',exact:true}).click();
  await signIn();
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  await page.getByText('Synthetic distance',{exact:true}).waitFor();
  assert.equal(await page.locator('.annotation-length').textContent(),readable);
  assert.deepEqual((await records()).annotations.find(a=>a.kind==='distance').points,distance.points);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',zoomBefore:fit,zoomAfter:read.position.zoom,lengthUm:distance.length,
    displayLength:readable, savedRoi:roi.points,reload:true,reLogin:true,annotationRetry:true,otherScanSeparated:true,viewportExport:true}));
} finally {await browser.close();}
