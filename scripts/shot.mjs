// Screenshots of the running app for visual checks.
// Usage: node scripts/shot.mjs <base url> <email> <password file> <out dir> [phone|desktop] [path ...]
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const [base, email, pwFile, out, device = 'phone', ...paths] = process.argv.slice(2);
if (!base || !email || !pwFile || !out) {
  console.error(
    'usage: node scripts/shot.mjs <base> <email> <password file> <out dir> [phone|desktop] [paths…]',
  );
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const password = pwFile === '-' ? null : readFileSync(pwFile, 'utf8').trim();
const viewport = device === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 2,
  colorScheme: process.env.DARK ? 'dark' : 'light',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${base}/signin`);
await page.waitForTimeout(1500);
const login = !password
  ? 200
  : await page.evaluate(
      async ({ email, password }) => {
        const r = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
          credentials: 'include',
        });
        return r.status;
      },
      { email, password },
    );
if (login !== 200) throw new Error(`login failed: ${login}`);

for (const p of paths.length ? paths : ['/']) {
  const [path, action] = p.split('#');
  await page.goto(`${base}${path}`);
  await page.waitForTimeout(2500);
  if (action) {
    for (const step of action.split('+')) {
      if (step.startsWith('click:'))
        await page.getByText(step.slice(6), { exact: true }).first().click();
      else if (step.startsWith('label:')) await page.getByLabel(step.slice(6)).first().click();
      await page.waitForTimeout(1200);
    }
  }
  const name = `${device}${path === '/' ? '-jobs' : path.replace(/[/?=&]+/g, '-')}${action ? `-${action.replace(/[^a-z0-9]+/gi, '-')}` : ''}.png`;
  await page.screenshot({ path: join(out, name), fullPage: false });
  console.log(name);
}
if (errors.length) console.log(`ERRORS:\n${[...new Set(errors)].slice(0, 20).join('\n')}`);
await browser.close();
