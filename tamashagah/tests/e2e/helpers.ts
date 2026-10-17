import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

/** Directory the SERVER writes mails to (MAIL_TRANSPORT=file, MAIL_FILE_DIR). */
export const MAIL_DIR = path.resolve(process.env.E2E_MAIL_DIR ?? '.data/mailbox');

export const randomEmail = (prefix = 'e2e') => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;
export const E2E_PASSWORD = `Pw-${Math.random().toString(36).slice(2, 10)}-9x`;

/** Poll the file mailbox for a link of `kind` sent to `to`. Returns the absolute URL path + query. */
export async function waitForMailLink(to: string, kind: 'verify-email' | 'reset-password', timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let files: string[] = [];
    try {
      files = (await fs.readdir(MAIL_DIR)).filter((f) => f.endsWith('.json')).sort();
    } catch {
      /* directory not created yet */
    }
    for (const file of files.reverse()) {
      const mail = JSON.parse(await fs.readFile(path.join(MAIL_DIR, file), 'utf8')) as { to: string; text: string };
      const match = mail.to === to ? new RegExp(`https?://[^\\s]+/${kind}\\?token=[A-Za-z0-9_-]+`).exec(mail.text) : null;
      if (match) {
        const url = new URL(match[0]);
        return `${url.pathname}${url.search}`;
      }
    }
    if (Date.now() > deadline) throw new Error(`No ${kind} mail for ${to} in ${MAIL_DIR}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Register through the UI. Leaves the page on "/" with a fresh session. */
export async function registerViaUi(page: Page, email: string, password = E2E_PASSWORD, name = 'کاربر آزمایشی') {
  await page.goto('/register');
  await page.getByLabel('نام نمایشی').fill(name);
  await page.getByLabel('ایمیل').fill(email);
  await page.getByLabel('گذرواژه', { exact: true }).fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'ساخت حساب کاربری' }).click();
  await expect(page).toHaveURL(/\/$/);
}

export async function verifyEmailViaMail(page: Page, email: string) {
  const link = await waitForMailLink(email, 'verify-email');
  await page.goto(link);
  await page.getByRole('button', { name: 'تأیید ایمیل' }).click();
  await expect(page.getByText('ایمیل شما تأیید شد')).toBeVisible();
}

export async function loginViaUi(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('ایمیل').fill(email);
  await page.getByLabel('گذرواژه', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ورود به حساب' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Open the account menu (avatar button) — works on desktop and mobile. */
export async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'منوی حساب کاربری' }).click();
}
