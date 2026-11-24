import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const clinical = '/api/clinical/local';
const captured = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function signIn(username) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => captured.push(error.message));
  const response = await page.request.post('/api/auth/login', { data: {
    organization: 'local', username, password: 'synthetic-test-password',
  }});
  assert.equal(response.status(), 200, await response.text());
  return { page, user: await response.json() };
}

async function act(page, action, input) {
  await button(page, action).click();
  if (input) await input();
  await button(page, '처리 저장').click();
}

async function state(page, label) {
  await page.getByRole('heading', { name: label, exact: true }).waitFor();
}

async function openNotice(page, title) {
  await page.locator('details.request-inbox > summary').click();
  const notice = page.getByRole('region', { name: '요청 알림함' });
  await button(notice, '알림 새로고침').click();
  await button(notice.getByRole('listitem').filter({ hasText: title }).first(), '요청 열기').click();
}

try {
  const admin = await signIn('integration-admin');
  const doctor = await signIn('integration-doctor');
  const consultant = await signIn('integration-other');
  const rows = await (await admin.page.request.get('/api/worklist?q=IMS-DEMO-101')).json();
  const caseId = rows.rows[0].record_id;
  const scan = rows.rows[0].slides.find((item) => item.wsi.format === 'SVS').wsi.id;
  const createUrl = `${clinical}/cases/${caseId}/requests`;

  await doctor.page.goto('/#viewer/' + caseId + '/' + scan);
  await doctor.page.getByRole('link', { name: '분석·자문 요청', exact: true }).click();
  await button(doctor.page, '새 요청').click();
  await doctor.page.getByLabel('대상 스캔').selectOption(scan);
  await doctor.page.getByLabel('요청 내용').fill('합성 자문 요청');
  await doctor.page.route('**/cases/*/requests', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const committed = await route.fetch();
    assert.equal(committed.status(), 201);
    await route.abort();
  }, { times: 1 });
  await button(doctor.page, '요청 생성').click();
  await doctor.page.getByRole('alert').waitFor();
  await button(doctor.page, '요청 생성').click();
  await state(doctor.page, '배정 대기');
  const requestId = new URL(doctor.page.url()).hash.split('/').at(-1);
  assert.equal((await (await doctor.page.request.get(createUrl)).json()).requests.length, 1);

  await act(doctor.page, '요청 담당자 배정', () => doctor.page.getByLabel('요청 담당자').selectOption(consultant.user.id));
  await state(doctor.page, '배정됨');
  await consultant.page.goto('/');
  await openNotice(consultant.page, '요청 배정');
  await state(consultant.page, '배정됨');
  const requestPath = `${clinical}/requests/${requestId}`;
  assert.equal((await consultant.page.request.get('/api/worklist/' + caseId)).status(), 404);
  assert.equal((await consultant.page.request.get('/api/wsi/clinical/' + scan)).status(), 404);
  await button(consultant.page, '요청 스캔 열기').click();
  await consultant.page.getByRole('button', { name: '미니맵에서 이동' }).waitFor();
  assert.equal((await consultant.page.request.get(requestPath + '/wsi/2/0/0.jpeg')).status(), 200);
  await act(consultant.page, '처리 시작');
  await state(consultant.page, '처리 중');
  await act(consultant.page, '실패 기록', () => consultant.page.getByLabel('실패 사유').fill('합성 재시도 검증'));
  await state(consultant.page, '실패');
  assert.equal((await consultant.page.request.get(requestPath + '/wsi')).status(), 404);

  await openNotice(doctor.page, '요청 실패');
  await state(doctor.page, '실패');
  await act(doctor.page, '다시 요청');
  await state(doctor.page, '배정 대기');
  await act(doctor.page, '요청 담당자 배정', () => doctor.page.getByLabel('요청 담당자').selectOption(consultant.user.id));
  await state(doctor.page, '배정됨');
  await consultant.page.reload();
  await act(consultant.page, '처리 시작');
  await state(consultant.page, '처리 중');
  await act(consultant.page, '처리 완료', () => consultant.page.getByLabel('자문 답변').fill('합성 자문 답변'));
  await state(consultant.page, '완료');

  await openNotice(doctor.page, '요청 완료');
  await state(doctor.page, '완료');
  await doctor.page.getByRole('link', { name: '보고 초안 참조 열기' }).click();
  await state(doctor.page, '보고 초안 참조');
  await doctor.page.getByText('합성 자문 답변', { exact: true }).waitFor();

  await admin.page.goto('/#case/' + caseId + '/requests');
  await button(admin.page, '새 요청').click();
  await admin.page.getByLabel('요청 유형').selectOption('ai');
  await admin.page.getByLabel('대상 스캔').selectOption(scan);
  await admin.page.getByLabel('요청 담당자').selectOption(admin.user.id);
  await admin.page.getByLabel('요청 내용').fill('합성 PD-L1 결과 참조');
  await button(admin.page, '요청 생성').click();
  await state(admin.page, '배정됨');
  await act(admin.page, '처리 시작');
  await state(admin.page, '처리 중');
  await act(admin.page, '처리 완료', async () => {
    const field = admin.page.getByLabel('보관 AI 결과');
    const edited = field.locator('option').filter({ hasText: '사용자 수정본' });
    await edited.waitFor({ state: 'attached' });
    await field.selectOption(await edited.getAttribute('value'));
  });
  await state(admin.page, '완료');
  await admin.page.getByRole('link', { name: '보고 초안 참조 열기' }).click();
  await state(admin.page, '보고 초안 참조');
  await admin.page.getByText('request-browser-fixture', { exact: true }).waitFor();
  await admin.page.getByRole('link', { name: 'WSI 결과 열기' }).click();
  await state(admin.page, 'WSI 뷰어');
  await admin.page.getByRole('region', { name: 'PD-L1 결과' }).getByText('request-browser-fixture', { exact: true }).waitFor();
  const exactReference = new URL(admin.page.url()).hash.split('/').at(-1);
  assert.equal(await admin.page.getByLabel('결과 버전').inputValue(), exactReference);
  assert.notEqual(await admin.page.getByLabel('결과 버전').locator('option').first().getAttribute('value'), exactReference);
  assert.deepEqual(captured, []);
  console.log('PASS: request creation recovery, scoped consultation WSI, assignment and failure retry, inbox, PD-L1 snapshot and report references');
} finally {
  await browser.close();
}
