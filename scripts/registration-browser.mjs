import assert from 'node:assert/strict';

const { chromium } = await import(process.env.MEDIAUTO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const baseURL = process.env.MEDIAUTO_DEMO_URL ?? 'http://127.0.0.1:19920';
const browser = await chromium.launch({ executablePath: process.env.MEDIAUTO_CHROME ?? '/usr/bin/google-chrome', headless: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const password = 'synthetic-registration-password';
const username = 'qa-new-viewer';

try {
  const applicant = await browser.newPage({ baseURL, viewport: { width: 390, height: 850 } });
  const admin = await browser.newPage({ baseURL });
  applicant.setDefaultTimeout(12000);
  admin.setDefaultTimeout(12000);
  await applicant.goto('/');
  await button(applicant, 'Request an Account').click();
  const form = applicant.getByRole('form', { name: 'Request an Account', exact: true });
  await form.getByLabel('Display Name', { exact: true }).fill('Synthetic Viewer');
  await form.getByLabel('Username', { exact: true }).fill(username);
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByLabel('Confirm Password', { exact: true }).fill('different-synthetic-password');
  await button(form, 'Submit Registration Request').click();
  await form.getByRole('alert').getByText('The passwords do not match.', { exact: true }).waitFor();
  await form.getByLabel('Confirm Password', { exact: true }).fill(password);
  await button(form, 'Submit Registration Request').click();
  await applicant.getByRole('heading', { name: 'Registration Confirmation Code' }).waitFor();
  const code = await applicant.locator('.registration-code').innerText();
  assert.match(code, /^[A-F0-9]{20}$/);
  assert.equal((await applicant.request.get('/api/auth/me')).status(), 401);
  await button(applicant, 'Back to Sign In').click();
  async function signIn() {
    await applicant.getByLabel('Username', { exact: true }).fill(username);
    await applicant.getByLabel('Password', { exact: true }).fill(password);
    await button(applicant, 'Sign In').click();
  }
  await signIn();
  await applicant.getByRole('alert').getByText('Check your username and password.', { exact: true }).waitFor();
  const login = await admin.request.post('/api/auth/login', { data: {
    organization: 'local', username: 'integration-admin', password: 'synthetic-test-password',
  } });
  assert.equal(login.status(), 200);
  await admin.goto('/#settings');
  await admin.getByRole('link', { name: 'Accounts', exact: true }).click();
  const queue = admin.getByRole('region', { name: 'Account Registration Requests', exact: true });
  await button(queue, 'Review ' + username).click();
  const review = queue.getByRole('form', { name: 'Review Registration', exact: true });
  await review.getByLabel('Account Role').selectOption('viewer');
  await review.getByLabel('Applicant Confirmation Code').fill(code);
  await button(review, 'Approve Account').click();
  await queue.getByText('Registration approved.', { exact: true }).waitFor();
  await button(queue, 'Reviewed').click();
  await queue.getByRole('row').filter({ hasText: username }).getByRole('cell', { name: 'Approved', exact: true }).waitFor();
  await signIn();
  await applicant.getByRole('heading', { name: 'Worklist', exact: true }).waitFor();
  const current = await (await applicant.request.get('/api/auth/me')).json();
  assert.equal(current.role, 'viewer');
  await applicant.goto('/#settings/accounts');
  await applicant.getByText('You do not have permission to open this page.', { exact: true }).waitFor();
  assert.ok(await applicant.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  console.log('PASS: registration form, applicant code, pending sign-in denial, admin approval, reviewed history and role-based login');
} finally {
  await browser.close();
}
