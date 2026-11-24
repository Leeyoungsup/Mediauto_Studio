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
    await page.getByLabel('계정').fill('integration-admin');
    await page.getByLabel('비밀번호').fill('synthetic-test-password');
    await page.getByRole('button',{name:'로그인',exact:true}).click();
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
  await page.getByRole('button',{name:'IMS-DEMO-101 상세 열기'}).click();
  await page.getByRole('heading',{name:'IMS-DEMO-101',exact:true}).waitFor();
  await page.getByRole('button',{name:'뷰어 열기',exact:true}).click();
  const canvas = page.getByLabel('WSI 캔버스');
  const position = page.getByRole('button',{name:'위치 저장',exact:true});
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
    await page.getByRole('textbox',{name:'주석 이름'}).waitFor();
    return region;
  }
  await page.getByRole('button',{name:'미니맵에서 이동'}).waitFor();
  const region = await draw('사각형 ROI');
  await page.getByRole('textbox',{name:'주석 이름'}).fill('합성 ROI');
  const reject = (route)=>route.fulfill({status:503, contentType:'application/json',body:'{"detail":"QA 저장 장애"}'});
  await page.route('**' + path + '/annotations', reject);
  await page.getByRole('button',{name:'주석 저장',exact:true}).click();
  await page.getByRole('alert').getByText('QA 저장 장애').waitFor();
  assert.equal(await page.getByRole('textbox',{name:'주석 이름'}).inputValue(),'합성 ROI');
  assert.equal((await records()).annotations.length,0);
  await page.unroute('**' + path + '/annotations', reject);
  await page.getByRole('button',{name:'주석 저장',exact:true}).click();
  await page.getByText('합성 ROI',{exact:true}).waitFor();
  const roi = (await records()).annotations[0];
  const fit = Math.min(Math.round(region.width) / metadata.dimensions[0],Math.round(region.height) / metadata.dimensions[1]);
  // Browser pointer coordinates are expressed in CSS pixels, then projected to level 0.
  for (const [index, point] of roi.points.entries()) {
    for (const [axis, value] of point.entries()) {
      close(value, metadata.dimensions[axis] / 2 + points[index][axis] / fit, 0.75 / fit);
    }
  }
  const initialWidth = Number(await page.locator('rect.annotation-roi').getAttribute('width'));

  await draw('거리 측정');
  await page.getByRole('textbox',{name:'주석 이름'}).fill('합성 거리');
  await page.getByRole('button',{name:'주석 저장',exact:true}).click();
  await page.getByText('합성 거리',{exact:true}).waitFor();
  const distance = (await records()).annotations.find(a=>a.kind==='distance');
  assert.equal(distance.unit,'um');
  const [[x1,y1],[x2,y2]] = distance.points;
  close(distance.length,Math.hypot((x2-x1)*metadata.mpp_x,(y2-y1)*metadata.mpp_y));
  const readable = await page.locator('.annotation-length').textContent();
  assert.match(readable,/mm|µm/);

  for (let click = 0; click < 4; click++) await page.getByRole('button',{name:'확대',exact:true}).click();
  await page.waitForFunction((width) => Math.abs(Number(document.querySelector('rect.annotation-roi')?.getAttribute('width')) / width - 1.4 ** 4) < .001, initialWidth);
  await canvas.scrollIntoViewIfNeeded();
  const area = await canvas.boundingBox();
  await page.mouse.move(area.x+area.width/2,area.y+area.height/2);
  await page.mouse.down();
  await page.mouse.move(area.x+area.width/2+100,area.y+area.height/2+40,{steps:4});
  await page.mouse.up();
  await position.click();
  await page.getByText('현재 판독 위치를 저장했습니다.').waitFor();
  const read = await records();
  assert.notEqual(read.position.x,metadata.dimensions[0]/2);
  const displayWidth = await page.locator('rect.annotation-roi').getAttribute('width');
  const displayX = await page.locator('rect.annotation-roi').getAttribute('x');
  assert.equal(await page.locator('.annotation-length').textContent(),readable);

  const viewerHash = page.url();
  await page.reload();
  await page.getByText('합성 거리',{exact:true}).waitFor();
  await page.waitForFunction((attributes) => {
    const roi = document.querySelector('rect.annotation-roi');
    return roi && Math.abs(Number(roi.getAttribute('x')) - Number(attributes.x)) < 0.01
      && Math.abs(Number(roi.getAttribute('width')) - Number(attributes.width)) < 0.01;
  }, {x:displayX,width:displayWidth});
  assert.deepEqual((await records()).position,read.position);
  await page.locator('.viewer-tray').getByRole('button',{name:/SYNTH-01.*SVS/}).click();
  await page.getByText('저장된 주석이 없습니다.',{exact:true}).waitFor();
  await page.locator('rect.annotation-roi').waitFor({state:'detached'});
  await page.goto(viewerHash);
  await page.getByText('합성 ROI',{exact:true}).waitFor();
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();
  await signIn();
  await page.getByText('합성 거리',{exact:true}).waitFor();
  assert.equal(await page.locator('.annotation-length').textContent(),readable);
  assert.deepEqual((await records()).annotations.find(a=>a.kind==='distance').points,distance.points);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',zoomBefore:fit,zoomAfter:read.position.zoom,lengthUm:distance.length,
    displayLength:readable, savedRoi:roi.points,reload:true,reLogin:true,annotationRetry:true,otherScanSeparated:true}));
} finally {await browser.close();}
