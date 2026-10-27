// Exercises real source via loopback HTTP, or the exact deployed route when PREVIEW_ORIGIN is set.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..', 'site');
const businessCount = JSON.parse(execFileSync('python3', ['-c', 'import csv,json,sys; print(json.dumps(list(csv.DictReader(sys.stdin))))'], { input: fs.readFileSync(path.join(root, 'Business-Listings/Business_Listings.csv')) })).length;
const columns = ['business_id', 'company_name', 'company_description', 'industries', 'country', 'city', 'career_page_url', 'ats_provider', 'date_added_to_dataset'];
const displayColumn = key => ({ company_name: 'company', ats_provider: 'ats' })[key] || key;
const storageKey = 'business-listings-column-order-v1';
let server, browser, origin;
before(async () => {
  if (process.env.PREVIEW_ORIGIN) origin = process.env.PREVIEW_ORIGIN.replace(/\/$/, '');
  else {
    server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
      const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404); return response.end(); }
      response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.csv') ? 'text/csv' : 'text/html');
      response.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  browser = await chromium.launch({ headless: true });
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function openPage(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (options.saved !== undefined) await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: options.saved });
  if (options.blockStorage) await page.addInitScript(() => {
    Storage.prototype.getItem = Storage.prototype.setItem = Storage.prototype.removeItem = () => { throw new Error('Storage unavailable'); };
  });
  await page.goto(origin + '/Business-Listings/');
  page.errors = errors;
  return page;
}
async function settled(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function geometry(page) {
  await settled(page);
  const result = await page.evaluate(() => {
    const headers = [...document.querySelectorAll('#sticky-head [data-column]')];
    const cells = [...document.querySelector('#table-wrap tbody tr:not([hidden])').cells];
    return { count: headers.length, offsets: headers.map((header, index) => Math.abs(header.getBoundingClientRect().left - cells[index].getBoundingClientRect().left)), overflow: headers.filter(h => h.scrollWidth > h.clientWidth).map(h => h.textContent), contained: document.documentElement.scrollWidth <= innerWidth + 1 };
  });
  assert.equal(result.count, columns.length);
  assert(result.offsets.every(delta => delta < 1), JSON.stringify(result));
  assert.deepEqual(result.overflow, []);
  assert(result.contained, 'horizontal overflow stays inside the dataset');
}
async function drag(page, from, to) {
  await page.locator(`#sticky-head [data-column="${from}"]`).dragTo(page.locator(`#sticky-head [data-column="${to}"]`));
  await settled(page);
}
test('dragging columns preserves all row values, semantic widths, saved order and reset', async () => {
  const page = await openPage();
  try {
    assert.equal(await page.locator('#sticky-head [draggable="true"]').count(), 9, 'all columns can be dragged');
    const original = await page.locator('#table-wrap tbody tr').evaluateAll(rows => rows.map(row => ({ id: row.id, cells: Object.fromEntries([...row.cells].map(cell => [cell.dataset.column, cell.textContent])) })));
    await drag(page, 'company_name', 'business_id');
    const order = ['company_name', 'business_id', ...columns.slice(2)];
    assert.deepEqual(await page.locator('#sticky-head [data-column]').allTextContents(), order.map(displayColumn));
    assert.deepEqual(await page.locator('#table-wrap thead th').allTextContents(), order.map(displayColumn));
    assert.deepEqual(await page.locator('#sticky-head [data-column]').evaluateAll(headers => headers.map(header => header.dataset.column)), order);
    assert.deepEqual(await page.locator('#table-wrap tbody tr').evaluateAll(rows => rows.map(row => ({ id: row.id, cells: Object.fromEntries([...row.cells].map(cell => [cell.dataset.column, cell.textContent])) }))), original);
    await geometry(page);
    await page.reload();
    assert.deepEqual(await page.locator('#sticky-head [data-column]').allTextContents(), order.map(displayColumn));
    await page.evaluate(() => { document.querySelector('#table-top-scroll').scrollLeft = 0; window.scrollTo(0, 1400); });
    await drag(page, 'business_id', 'company_name');
    assert.deepEqual(await page.locator('#sticky-head [data-column]').allTextContents(), columns.map(displayColumn), 'dragging works while headers are frozen');
    await page.evaluate(() => document.querySelector('#table-top-scroll').scrollLeft = 10000);
    await settled(page);
    await page.evaluate(() => {
      const from = document.querySelector('#sticky-head [data-column="date_added_to_dataset"]');
      const to = document.querySelector('#sticky-head [data-column="business_id"]');
      const dataTransfer = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    });
    assert.deepEqual(await page.locator('#sticky-head [data-column]').allTextContents(), [columns[8], ...columns.slice(0, 8)].map(displayColumn));
    await geometry(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await geometry(page);
    assert.equal(await page.locator('td[data-column="career_page_url"]').first().evaluate(cell => getComputedStyle(cell).minWidth), '250px');
    assert.equal(await page.locator('td[data-column="company_name"]').first().evaluate(cell => getComputedStyle(cell).fontWeight), '400');
    await page.click('#column-order-reset');
    assert.deepEqual(await page.locator('#sticky-head [data-column]').allTextContents(), columns.map(displayColumn));
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null);
    await geometry(page);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
test('filters, empty results, mobile resizing and byte-identical CSV downloads survive reordering', async () => {
  const page = await openPage();
  try {
    await drag(page, 'company_name', 'business_id');
    const ats = page.locator('#ats details');
    assert.equal(await ats.locator('summary[aria-label="ATS"]').count(), 1);
    await ats.locator('summary').click();
    await ats.getByRole('button', { name: 'Clear all', exact: true }).click();
    await ats.getByRole('checkbox', { name: 'Greenhouse', exact: true }).check();
    await ats.locator('summary').click();
    await page.fill('#search', 'Coveo');
    assert.equal(await page.locator('#table-wrap tbody tr:visible').count(), 1);
    assert.equal(await page.locator('#count').textContent(), `1 of ${businessCount} businesses`);
    await geometry(page);
    await page.fill('#search', 'does-not-match-any-business-xyz');
    assert.equal(await page.locator('#table-wrap tbody tr:visible').count(), 0);
    assert(await page.locator('#empty').isVisible());
    await page.click('#reset');
    assert.equal(await page.locator('#table-wrap tbody tr:visible').count(), businessCount);
    assert.equal(await page.locator('#sticky-head [data-column]').first().textContent(), 'company', 'filter reset does not discard column preferences');
    assert.equal(await page.locator('#sticky-head [data-column]').first().getAttribute('data-column'), 'company_name');
    await geometry(page);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await geometry(page);
    }
    const canonical = fs.readFileSync(path.join(root, 'Business-Listings/Business_Listings.csv'));
    const downloadPromise = page.waitForEvent('download');
    await page.locator('a.download').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'Business_Listings.csv');
    assert.deepEqual(fs.readFileSync(await download.path()), canonical);
    const alias = await page.request.get(origin + '/Business-Listings/Business_Spreadsheet.csv');
    assert.equal(alias.status(), 200);
    assert.deepEqual(await alias.body(), canonical);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
test('invalid saved orders fall back to defaults and unavailable storage does not break dragging or reset', async () => {
  const page = await openPage();
  try {
    for (const saved of ['bad-json', '{}', JSON.stringify(columns.slice(1)), JSON.stringify([...columns.slice(1), columns[1]]), JSON.stringify([...columns.slice(1), 'unknown_column'])]) {
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: saved });
      await page.reload();
      assert.deepEqual(await page.locator('#sticky-head [data-column]').allTextContents(), columns.map(displayColumn));
    }
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
  const blocked = await openPage({ blockStorage: true });
  try {
    await drag(blocked, 'company_name', 'business_id');
    assert.equal(await blocked.locator('#sticky-head [data-column]').first().textContent(), 'company');
    await blocked.click('#column-order-reset');
    assert.deepEqual(await blocked.locator('#sticky-head [data-column]').allTextContents(), columns.map(displayColumn));
    assert.deepEqual(blocked.errors, []);
  } finally { await blocked.close(); }
});
test('headers and top scrollbar stay visible and aligned during document and bidirectional horizontal scroll', async () => {
  const page = await openPage();
  try {
    assert.equal(await page.locator('#table-top-scroll').count(), 1, 'a top horizontal scrollbar exists');
    assert.equal(await page.locator('#table-wrap tbody tr').count(), businessCount);
    await geometry(page);
    await page.evaluate(() => window.scrollTo(0, 1400));
    for (const selector of ['#table-top-scroll', '#sticky-head']) {
      const box = await page.locator(selector).boundingBox();
      assert(box.y >= 0 && box.y + box.height < 120, `${selector} is pinned at the viewport top`);
    }
    await page.evaluate(() => document.querySelector('#table-top-scroll').scrollLeft = 320);
    await page.waitForFunction(() => document.querySelector('#table-wrap').scrollLeft === 320);
    await geometry(page);
    await page.evaluate(() => document.querySelector('#table-wrap').scrollLeft = 500);
    await page.waitForFunction(() => document.querySelector('#table-top-scroll').scrollLeft === 500);
    await geometry(page);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
