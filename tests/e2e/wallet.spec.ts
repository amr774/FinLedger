import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
test('registration → wallet → funding → transfer → ledger → renewed session → logout', async ({
  page,
  request,
}) => {
  const unique = crypto.randomUUID();
  const password = 'Browser-Test-2026!';
  const recipient = await request.post('/api/v1/auth/register', {
    data: {
      email: `recipient-${unique}@example.test`,
      name: 'Recipient',
      password,
    },
  });
  expect(recipient.ok()).toBeTruthy();
  const { accessToken } = await recipient.json();
  const destination = await request.post('/api/v1/wallets', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const wallet = await destination.json();
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Browser Tester');
  await page.getByLabel('Email address').fill(`browser-${unique}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome, Browser.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create demo wallet' }).click();
  await page.getByRole('button', { name: 'Add demo funds' }).click();
  await expect(page.getByRole('status')).toContainText('Demo funds added');
  await page
    .getByRole('link', { name: 'Send money', exact: true })
    .first()
    .click();
  await page.getByLabel('Recipient wallet ID').fill(wallet.id);
  await page.getByLabel('Amount in EGP').fill('12.34');
  await page.getByRole('button', { name: 'Send virtual money' }).click();
  await expect(page.getByRole('status')).toContainText('Transfer completed');
  await page.getByRole('link', { name: 'View transaction' }).click();
  await expect(page.getByText('DEBIT', { exact: true })).toBeVisible();
  await expect(page.getByText('CREDIT', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Transaction details' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.balance')).toContainText('987.66');
  await page.screenshot({
    path: 'docs/screenshots/dashboard.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: 'Welcome, Browser.' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'docs/screenshots/mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/wallet');
  await expect(
    page.getByRole('heading', { name: 'My wallet', exact: true }),
  ).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy wallet ID' }).click();
  await expect(
    page.getByRole('button', { name: 'Copy wallet ID' }),
  ).toContainText('Copied');
  await page.goto('/transactions');
  await page
    .getByRole('combobox', { name: 'Type', exact: true })
    .selectOption('TRANSFER');
  await expect(page.getByText('1 transactions', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Order', exact: true })
    .selectOption('asc');
  await expect(
    page.getByRole('button', { name: 'Next', exact: true }),
  ).toBeDisabled();
  await page.goto('/profile');
  await expect(
    page.getByRole('heading', { name: 'Profile & security' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Sign out of this session', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
  await page.goto('/wallet');
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
  await page.getByLabel('Email address').fill(`browser-${unique}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid credentials');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.balance')).toContainText('987.66');
});

test('admin dashboard loads actual statistics, audit records and job status', async ({
  page,
}) => {
  test.skip(
    !!process.env.E2E_EXTERNAL,
    'Role setup is restricted to the isolated test database',
  );
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('Isolated test database required');
  const email = `admin-ui-${crypto.randomUUID()}@example.test`;
  const registration = await page.request.post('/api/v1/auth/register', {
    data: { email, name: 'Audit Admin', password: 'Browser-Test-2026!' },
  });
  expect(registration.status()).toBe(201);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    await db.user.update({ where: { email }, data: { role: 'ADMIN' } });
  } finally {
    await db.$disconnect();
  }
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: 'Administration' }),
  ).toBeVisible();
  await expect(page.locator('.stat-grid')).not.toContainText('Unavailable');
  await expect(page.locator('.stat-grid h2').first()).toHaveText(/^\d+$/);
  await expect(
    page.getByRole('heading', { name: 'Audit trail' }),
  ).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('refresh outage stays recoverable and an uncertain funding retry survives reload', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Recovery Tester');
  await page
    .getByLabel('Email address')
    .fill(`recovery-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Browser-Test-2026!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Create demo wallet' }).click();
  await page.route('**/api/v1/demo/fund', async (route) => {
    const result = await route.fetch();
    expect(result.status()).toBe(201);
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Add demo funds' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/v1/demo/fund');
  await page.reload();
  await page.getByRole('button', { name: 'Add demo funds' }).click();
  await expect(page.getByRole('status')).toContainText('Demo funds added');
  await expect(page.locator('.balance')).toContainText('1,000.00');
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'text/html',
      body: '<h1>Unavailable</h1>',
    }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(
    page.getByRole('button', { name: 'Retry connection' }),
  ).toBeVisible();
  await page.unroute('**/api/v1/auth/refresh');
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.locator('.balance')).toContainText('1,000.00');
});
