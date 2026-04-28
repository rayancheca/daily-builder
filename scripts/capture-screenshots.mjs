// Regenerate dashboard screenshots used by README.md.
//
// Prereq:
//   1. Dashboard must be running:  python3 ~/daily-builder/dashboard/server.py &
//   2. Playwright must be installed:  cd /tmp && npm i playwright
//
// Run:   node ~/daily-builder/scripts/capture-screenshots.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(os.homedir(), 'daily-builder');
const OUT = path.join(ROOT, 'docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

const URL = 'http://localhost:8765';

const sections = [
  { id: 'sec-overview', file: '01-overview.png' },
  { id: 'sec-activity', file: '02-activity.png' },
  { id: 'sec-projects', file: '03-projects.png' },
  { id: 'sec-wishlist', file: '04-wishlist.png' },
  { id: 'sec-log',      file: '05-log.png' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000); // SSE never reaches networkidle

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, '01-overview.png') });

for (const sec of sections.slice(1)) {
  await page.evaluate((id) => {
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, sec.id);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, sec.file) });
  console.log('captured', sec.file);
}

await page.evaluate(() => window.openWishlist && window.openWishlist());
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(OUT, '06-wishlist-drawer.png') });
await page.evaluate(() => window.closeWishlist && window.closeWishlist());
await page.waitForTimeout(500);

await page.evaluate(() => {
  document.getElementById('sec-projects')?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
await page.waitForTimeout(600);
const cardClicked = await page.evaluate(() => {
  const card = document.querySelector('#project-grid > *');
  if (card) { card.click(); return true; }
  return false;
});
if (cardClicked) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '07-project-drawer.png') });
}

await page.evaluate(() => {
  document.getElementById('drawer')?.classList.remove('open');
  document.getElementById('scrim')?.classList.remove('open');
  window.scrollTo(0, 0);
});
await page.waitForTimeout(400);

const shippedClicked = await page.evaluate(() => {
  const c = document.querySelector('#stat-shipped-card');
  if (c) { c.click(); return true; }
  return false;
});
if (shippedClicked) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '08-shipped-modal.png') });
}
await page.evaluate(() => window.closeModal && window.closeModal());
await page.waitForTimeout(400);

await page.evaluate(() => {
  document.getElementById('sec-activity')?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
await page.waitForTimeout(700);
const dayClicked = await page.evaluate(() => {
  const days = Array.from(document.querySelectorAll('#calendar .cal-day, #calendar .day, #calendar > *'))
    .filter(d => d.classList && (d.classList.contains('l4') || d.classList.contains('l3') || d.classList.contains('l2')));
  const last = days[days.length - 1];
  if (last) { last.click(); return true; }
  return false;
});
if (dayClicked) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '09-day-modal.png') });
}

await browser.close();
console.log('done');
