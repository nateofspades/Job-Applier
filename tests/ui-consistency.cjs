// UI redesign acceptance. ONLY this suite intercepts jobs.json with a small,
// explicitly identified fixture of unchanged REAL records. listings-preview.cjs
// continues to render and filter the complete real dataset without interception.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..', 'site');
const prefix = process.env.PREVIEW_PREFIX || '';
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'Job-Listings/jobs.json')));
const businesses = JSON.parse(execFileSync('python3', ['-c', 'import csv,json,sys; print(json.dumps(list(csv.DictReader(sys.stdin))))'], { input: fs.readFileSync(path.join(root, 'Business-Listings/Business_Listings.csv')) }));
const levels = ['internship', 'entry-level / junior', 'mid-level / intermediate', 'senior', 'lead', 'staff', 'principal', 'manager', 'director', 'executive'];
const businessColumns = Object.keys(businesses[0]);
const jobColumns = ['job_url', 'company_name', 'job_title', 'job_experience_level', 'job_category', 'city', 'country', 'remote_policy', 'is_fulltime', 'salary', 'date_posted', 'job_summary', 'job_responsibilities', 'experience_required', 'full_job_post', 'job_id', 'ats_provider', 'date_added_to_dataset'];
const displayColumn = key => ({ company_name: 'company', ats_provider: 'ats' })[key] || key;
const split = value => (value || '').split(';').map(token => token.trim()).filter(Boolean);
// Diversity, not invented data: first records plus actual examples of every
// recorded experience token and ATS provider, keeping original row order.
const picked = new Set(snapshot.jobs.slice(0, 3));
for (const key of ['ats_provider', 'job_experience_level']) {
  const seen = new Set();
  for (const row of snapshot.jobs) {
    for (const value of key === 'job_experience_level' ? (split(row[key]).length ? split(row[key]) : ['']) : [row[key] || '']) {
      if (!seen.has(value)) { seen.add(value); picked.add(row); }
    }
  }
}
const jobs = snapshot.jobs.filter(row => picked.has(row));
const fixture = { ...snapshot, jobs, company_count: new Set(jobs.map(row => row.company_name)).size };
const assets = ['Business-Listings/Business_Listings.csv', 'Business-Listings/Business_Spreadsheet.csv', 'Job-Listings/Job_Listings.csv', 'Job-Listings/Job_Filters.csv', 'Job-Listings/jobs.json'];
const originalBytes = new Map(assets.map(asset => [asset, fs.readFileSync(path.join(root, asset))]));
let server, browser, origin;
before(async () => {
  if (process.env.PREVIEW_ORIGIN) origin = process.env.PREVIEW_ORIGIN.replace(/\/$/, '');
  else {
    server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
      const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404); return response.end(); }
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.csv': 'text/csv' })[path.extname(file)] || 'application/octet-stream');
      response.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  browser = await chromium.launch({ headless: true });
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function openPage(route, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
  page.setDefaultTimeout(7000);
  page.setDefaultNavigationTimeout(60000);
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') page.errors.push(message.text()); });
  if (route === 'Job-Listings') {
    await page.route('**/Job-Listings/jobs.json*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  }
  try {
    const response = await page.goto(origin + prefix + '/' + route + '/');
    assert.equal(response.status(), 200);
    // Immediate missing-feature assertion: do not hang waiting on the old DOM.
    assert.equal(await page.locator('link[rel="stylesheet"][href^="../shared/listings.css"]').count(), 1, `${route} must use ../shared/listings.css`);
    await page.waitForFunction(({ route, count }) => route === 'Job-Listings' ? document.querySelectorAll('#results tr').length === count : document.querySelectorAll('tbody tr').length === count, { route, count: route === 'Job-Listings' ? jobs.length : businesses.length });
    return page;
  } catch (error) { await page.close(); throw error; }
}
async function toggle(page, id, open) {
  const details = page.locator(`#${id} details`);
  assert.equal(await details.count(), 1, `${id}: one native details component`);
  if (await details.evaluate(element => element.open) !== open) await details.locator('summary').click();
  return details;
}
async function choose(page, id, values) {
  const details = await toggle(page, id, true);
  await details.getByRole('button', { name: 'Clear all', exact: true }).click();
  for (const value of values) await details.locator(`input[type="checkbox"][value=${JSON.stringify(value)}]`).check();
  await toggle(page, id, false);
}
async function assertRows(page, route, expected) {
  if (route === 'Job-Listings') {
    assert.deepEqual(await page.locator('#results tr td:first-child a').evaluateAll(links => links.map(link => link.href)), expected.map(row => row.job_url));
    assert.equal(await page.locator('#status').textContent(), `${expected.length.toLocaleString()} of ${jobs.length.toLocaleString()} jobs`);
  } else {
    assert.deepEqual(await page.locator('tbody tr:not([hidden])').evaluateAll(rows => rows.map(row => row.id)), expected.map(row => row.business_id));
    assert.equal(await page.locator('#count').textContent(), `${expected.length.toLocaleString()} of ${businesses.length.toLocaleString()} businesses`);
  }
}
async function assertDefault(page, ids) {
  for (const id of ids) {
    const inputs = page.locator(`#${id} input[type="checkbox"]`);
    assert(await inputs.count() > 0, `${id}: checkbox options populated`);
    assert.equal(await inputs.evaluateAll(options => options.every(option => option.checked)), true, `${id}: all options selected`);
  }
}
test('Business Listings always includes the total in its result count', async () => {
  const page = await openPage('Business-Listings');
  try {
    await assertRows(page, 'Business-Listings', businesses);
    await page.fill('#search', businesses[0].business_id);
    await assertRows(page, 'Business-Listings', [businesses[0]]);
    await page.fill('#search', 'no-matching-business-count-regression');
    await assertRows(page, 'Business-Listings', []);
    await page.click('#reset');
    await assertRows(page, 'Business-Listings', businesses);
    await choose(page, 'company', []);
    await assertRows(page, 'Business-Listings', []);
    const details = await toggle(page, 'company', true);
    await details.getByRole('button', { name: 'Select all', exact: true }).click();
    await toggle(page, 'company', false);
    await assertRows(page, 'Business-Listings', businesses);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
for (const route of ['Business-Listings', 'Job-Listings']) {
  test(`${route} company values use normal weight without weakening counts or headers`, async () => {
    const page = await openPage(route);
    try {
      const cells = page.locator('#table-wrap tbody td[data-column="company_name"]');
      assert(await cells.count() > 0);
      assert.deepEqual(await cells.evaluateAll(elements => [...new Set(elements.map(cell => getComputedStyle(cell).fontWeight))]), ['400']);
      const count = page.locator(route === 'Job-Listings' ? '#status' : '#count');
      assert.equal(await count.evaluate(element => getComputedStyle(element).fontWeight), '700');
      for (const selector of ['#sticky-head [data-column="company_name"]', '#table-wrap thead [data-column="company_name"]']) {
        assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).fontWeight), '600');
      }
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}
test('Job Listings job_title values use normal weight while title headers stay bold', async () => {
  const page = await openPage('Job-Listings');
  try {
    const cells = page.locator('#results td[data-column="job_title"]');
    assert.equal(await cells.count(), jobs.length);
    assert.deepEqual(await cells.evaluateAll(elements => [...new Set(elements.map(cell => getComputedStyle(cell).fontWeight))]), ['400']);
    for (const selector of ['#sticky-head [data-column="job_title"]', '#head [data-column="job_title"]']) {
      assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).fontWeight), '600');
    }
    assert.equal(await page.locator('#status').evaluate(element => getComputedStyle(element).fontWeight), '700');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
test('both listing pages load the shared stylesheet and native checkbox filters', async () => {
  for (const route of ['Business-Listings', 'Job-Listings']) {
    const page = await openPage(route);
    try {
      for (const [id, label] of [['company', 'Company'], ['ats', 'ATS'], ...(route === 'Job-Listings' ? [['experience-levels', 'Experience level']] : [])]) {
        assert.equal(await page.locator(`div#${id} details summary[aria-label="${label}"]`).count(), 1, `${route}: ${label} is inside its stable div host`);
        const details = await toggle(page, id, true);
        assert.equal(await details.getByRole('button', { name: 'Select all', exact: true }).count(), 1);
        assert.equal(await details.getByRole('button', { name: 'Clear all', exact: true }).count(), 1);
        const labels = await details.locator('input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => ({ value: input.value, label: [...input.labels].map(label => label.textContent.trim()).join(' ') })));
        const blankLabel = 'Not specified';
        assert(labels.every(option => option.label === (option.value || blankLabel)), `${id}: exact source/vocabulary labels, blanks are ${blankLabel}`);
        await toggle(page, id, false);
      }
      const columns = route === 'Job-Listings' ? jobColumns : businessColumns;
      assert.deepEqual(await page.locator('#sticky-head [data-column]').evaluateAll(headers => headers.map(header => header.dataset.column)), columns, 'data-column identities retain the published schema');
      assert.deepEqual(await page.locator('#sticky-head [data-column]').allTextContents(), columns.map(displayColumn));
      const status = route === 'Job-Listings' ? 'status' : 'count';
      assert.equal(await page.locator(`.toolbar strong#${status}`).count(), 1);
      const toolbar = page.locator('.toolbar').filter({ has: page.locator(`#${status}`) });
      assert.deepEqual(await toolbar.locator('.toolbar-actions button').allTextContents(), ['Reset column order', 'Reset filters']);
      const layout = await toolbar.evaluate(element => {
        const status = element.querySelector('strong').getBoundingClientRect();
        const actions = element.querySelector('.toolbar-actions').getBoundingClientRect();
        return { statusRight: status.right, actionsLeft: actions.left };
      });
      assert(layout.actionsLeft > layout.statusRight, 'desktop toolbar actions sit to the right of the status');
      assert.equal(await page.locator('#category').count(), 0, 'category remains a column, not a filter');
      if (route === 'Job-Listings') {
        assert.equal(await page.locator('#coverage-note, #url-audit-note, #remote-filter-help, .eyebrow, #experience-unspecified').count(), 0);
        const bodyText = await page.locator('body').innerText();
        for (const stale of ['No selections means all levels', 'A dash means the source did not specify', 'Blank date_added_to_dataset means the insertion date is unknown', 'Long lists scroll within their cells', 'remote_policy uses remote', 'URL review:']) assert(!bodyText.includes(stale), `removed stale help: ${stale}`);
        assert.deepEqual(await page.locator('#experience-levels input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => input.value)), [...levels, '']);
        assert.deepEqual(await page.locator('#results tr td:first-child a').allTextContents(), jobs.map(() => 'View posting'));
      }
      await assertDefault(page, ['company', 'ats', ...(route === 'Job-Listings' ? ['experience-levels'] : [])]);
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  }
});
test('shared computed typography, control heights and table viewport geometry at 1440, 1024 and 390px', async () => {
  const pages = [];
  try {
    for (const route of ['Business-Listings', 'Job-Listings']) pages.push(await openPage(route));
    for (const width of [1440, 1024, 390]) {
      const metrics = [];
      for (const page of pages) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        metrics.push(await page.evaluate(() => {
          const style = selector => { const s = getComputedStyle(document.querySelector(selector)); return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing }; };
          const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, width: r.width }; };
          const controls = [...document.querySelectorAll('#search, #query, #remote, #company summary, #ats summary, #experience-levels summary, .toolbar-actions button, a.download')];
          return { body: style('body'), heading: style('h1'), tablehead: style('#sticky-head [data-column]'), controlFonts: controls.map(control => getComputedStyle(control).fontFamily), controlHeights: controls.map(control => control.getBoundingClientRect().height), main: rect('main'), wrap: rect('#table-wrap'), tableWidth: document.querySelector('#table-wrap table').getBoundingClientRect().width, contained: document.documentElement.scrollWidth <= innerWidth + 1 };
        }));
      }
      const [business, job] = metrics;
      for (const key of ['body', 'heading', 'tablehead', 'main', 'wrap']) assert.deepEqual(business[key], job[key], `${width}px: shared ${key}`);
      for (const [index, metric] of metrics.entries()) {
        assert(metric.contained, `${width}px: page ${index} stays inside viewport`);
        assert(metric.tableWidth >= metric.wrap.width - 2, 'wide table fills its viewport');
        assert(metric.controlHeights.length >= 5);
        assert(metric.controlHeights.every(height => height >= 44 && Math.abs(height - business.controlHeights[0]) < 1), `${width}px: equal accessible control heights ${JSON.stringify(metric.controlHeights)}`);
        assert(metric.controlFonts.every(font => font === metric.body.family), `${width}px: controls inherit the shared body font`);
      }
    }
    for (const page of pages) assert.deepEqual(page.errors, []);
  } finally { for (const page of pages) await page.close(); }
});
test('checkbox filters union within a filter, intersect between filters, select none and reset on both pages', async () => {
  for (const [route, rows] of [['Business-Listings', businesses], ['Job-Listings', jobs]]) {
    const page = await openPage(route);
    try {
      await assertRows(page, route, rows);
      const companies = [...new Set(rows.map(row => row.company_name))].slice(0, 2);
      assert.equal(companies.length, 2);
      await choose(page, 'company', companies);
      await assertRows(page, route, rows.filter(row => companies.includes(row.company_name)));
      const provider = rows.find(row => row.company_name === companies[0]).ats_provider || '';
      await choose(page, 'ats', [provider]);
      await assertRows(page, route, rows.filter(row => companies.includes(row.company_name) && (row.ats_provider || '') === provider));
      await choose(page, 'ats', []);
      await assertRows(page, route, []);
      assert(await page.locator('#empty').isVisible());
      let details = await toggle(page, 'ats', true);
      await details.getByRole('button', { name: 'Select all', exact: true }).click();
      await toggle(page, 'ats', false);
      await assertRows(page, route, rows.filter(row => companies.includes(row.company_name)));
      await choose(page, 'company', []);
      await assertRows(page, route, []);
      details = await toggle(page, 'company', true);
      await details.getByRole('button', { name: 'Select all', exact: true }).click();
      await toggle(page, 'company', false);
      await assertRows(page, route, rows);
      const providers = [...new Set(rows.map(row => row.ats_provider || ''))].slice(0, 2);
      await choose(page, 'ats', providers);
      await assertRows(page, route, rows.filter(row => providers.includes(row.ats_provider || '')));
      await page.click('#reset');
      await assertRows(page, route, rows);
      await assertDefault(page, ['company', 'ats', ...(route === 'Job-Listings' ? ['experience-levels'] : [])]);
      // Blank is an actual unspecified value, never an all-values sentinel.
      await choose(page, 'ats', ['']);
      await assertRows(page, route, rows.filter(row => !row.ats_provider));
      await page.click('#reset');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  }
});
test('experience vocabulary, blank-only, union, none and Company/ATS/remote/search intersection', async () => {
  const page = await openPage('Job-Listings');
  try {
    await choose(page, 'experience-levels', ['']);
    await assertRows(page, 'Job-Listings', jobs.filter(row => !row.job_experience_level));
    await choose(page, 'experience-levels', ['entry-level / junior', 'senior']);
    await assertRows(page, 'Job-Listings', jobs.filter(row => split(row.job_experience_level).some(level => ['entry-level / junior', 'senior'].includes(level))));
    await choose(page, 'experience-levels', []);
    await assertRows(page, 'Job-Listings', []);
    const details = await toggle(page, 'experience-levels', true);
    await details.getByRole('button', { name: 'Select all', exact: true }).click();
    await toggle(page, 'experience-levels', false);
    await assertRows(page, 'Job-Listings', jobs);
    await page.click('#reset');
    const row = jobs.find(row => row.job_experience_level && row.remote_policy);
    assert(row, 'real-record fixture includes a job with level and remote policy');
    const level = split(row.job_experience_level)[0], policy = split(row.remote_policy)[0];
    await choose(page, 'company', [row.company_name]);
    await choose(page, 'ats', [row.ats_provider || '']);
    await choose(page, 'experience-levels', [level]);
    await page.selectOption('#remote', policy);
    await assertRows(page, 'Job-Listings', jobs.filter(candidate => candidate.company_name === row.company_name && candidate.ats_provider === row.ats_provider && split(candidate.job_experience_level).includes(level) && split(candidate.remote_policy).includes(policy)));
    await page.fill('#query', row.job_id);
    await assertRows(page, 'Job-Listings', [row]);
    await page.fill('#query', 'no-matching-ui-acceptance-fixture');
    await assertRows(page, 'Job-Listings', []);
    await page.click('#reset');
    assert.equal(await page.locator('#query').inputValue(), '');
    assert.equal(await page.locator('#remote').inputValue(), '');
    await assertDefault(page, ['company', 'ats', 'experience-levels']);
    await assertRows(page, 'Job-Listings', jobs);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
test('mobile dropdowns stay clamped, expose accessible labels, and close with Escape and outside clicks', async () => {
  for (const route of ['Business-Listings', 'Job-Listings']) {
    const page = await openPage(route, 390);
    try {
      for (const [id, label] of [['company', 'Company'], ['ats', 'ATS'], ...(route === 'Job-Listings' ? [['experience-levels', 'Experience level']] : [])]) {
        const details = page.locator(`#${id} details`), summary = details.locator('summary');
        assert.equal(await summary.getAttribute('aria-label'), label);
        await summary.focus();
        await page.keyboard.press('Enter');
        assert(await details.evaluate(element => element.open), `${label}: opens by keyboard`);
        const boxes = await details.evaluate(element => [...element.children].filter(child => child.tagName !== 'SUMMARY' && getComputedStyle(child).display !== 'none').map(child => { const r = child.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; }));
        assert(boxes.length > 0, `${label}: popup contents exist`);
        assert(boxes.every(box => box.left >= 0 && box.right <= 390 && box.width > 0), `${label}: mobile popup is clamped ${JSON.stringify(boxes)}`);
        await page.keyboard.press('Tab');
        assert(await details.evaluate(element => element.contains(document.activeElement)), `${label}: keyboard can reach popup controls`);
        await page.keyboard.press('Escape');
        assert.equal(await details.evaluate(element => element.open), false, `${label}: Escape closes`);
        assert(await summary.evaluate(element => element === document.activeElement), `${label}: Escape restores focus`);
        await summary.click();
        await page.locator('h1').click();
        assert.equal(await details.evaluate(element => element.open), false, `${label}: outside click closes`);
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  }
});
test('all real canonical and compatibility CSV/JSON assets retain their exact bytes', async () => {
  const context = await browser.newContext();
  try {
    for (const [asset, bytes] of originalBytes) {
      const response = await context.request.get(origin + prefix + '/' + asset);
      assert.equal(response.status(), 200, asset);
      assert.deepEqual(await response.body(), bytes, `${asset}: HTTP bytes unchanged (no fixture interception)`);
      assert.deepEqual(fs.readFileSync(path.join(root, asset)), bytes, `${asset}: source bytes unchanged`);
    }
    assert.deepEqual(originalBytes.get('Business-Listings/Business_Spreadsheet.csv'), originalBytes.get('Business-Listings/Business_Listings.csv'));
    assert.deepEqual(originalBytes.get('Job-Listings/Job_Filters.csv'), originalBytes.get('Job-Listings/Job_Listings.csv'));
    assert(businessColumns.includes('company_name') && businessColumns.includes('ats_provider'));
    assert(snapshot.jobs.every(row => 'company_name' in row && 'ats_provider' in row && 'job_category' in row));
  } finally { await context.close(); }
});
