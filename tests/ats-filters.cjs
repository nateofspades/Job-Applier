// Browser regression against the real local datasets, served only on loopback.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const businesses = JSON.parse(execFileSync('python3', ['-c', 'import csv,json,sys; print(json.dumps(list(csv.DictReader(sys.stdin))))'], { input: fs.readFileSync(path.join(root, 'site/Business-Listings/Business_Listings.csv')) }));
const jobs = JSON.parse(fs.readFileSync(path.join(root, 'site/Job-Listings/jobs.json'))).jobs;
let server, browser, origin;
before(async () => {
  if (process.env.PREVIEW_ORIGIN) {
    origin = process.env.PREVIEW_ORIGIN.replace(/\/$/, '');
    browser = await chromium.launch({ headless: true });
    return;
  }
  server = http.createServer((req, res) => {
    const urlPath = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, 'site', '.' + urlPath, urlPath.endsWith('/') ? 'index.html' : '');
    if (!file.startsWith(path.join(root, 'site') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.csv': 'text/csv' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });

test('Job ATS dropdown: exact providers, all existing filters, empty/reset and mobile', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin + '/Job-Listings/');
    await page.waitForFunction(count => document.querySelectorAll('#results tr').length === count, jobs.length);
    const select = page.getByLabel('ATS system', { exact: true });
    assert.equal(await select.count(), 1, 'Job Listings has an ATS system dropdown');
    const providers = [...new Set(jobs.map(row => row.ats_provider).filter(Boolean))].sort();
    assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(o => o.value)), ['', ...providers, 'unknown']);
    async function assertJobs(expected) {
      assert.deepEqual(await page.locator('#results tr td:first-child a').evaluateAll(links => links.map(link => link.href)), expected.map(row => row.job_url));
      assert.equal(await page.locator('#status').textContent(), `${expected.length.toLocaleString()} of ${jobs.length.toLocaleString()} jobs`);
    }
    for (const provider of [...providers, 'unknown']) {
      await select.selectOption(provider);
      await assertJobs(jobs.filter(row => provider === 'unknown' ? !row.ats_provider : row.ats_provider === provider));
    }
    const row = jobs.find(row => row.ats_provider && row.job_category && row.remote_policy && row.job_experience_level);
    await select.selectOption(row.ats_provider);
    await page.selectOption('#company', row.company_name);
    await assertJobs(jobs.filter(r => r.ats_provider === row.ats_provider && r.company_name === row.company_name));
    await page.selectOption('#category', row.job_category);
    const policy = row.remote_policy.split('; ')[0];
    await page.selectOption('#remote', policy);
    const level = row.job_experience_level.split('; ')[0];
    await page.getByLabel(level, { exact: true }).check();
    await assertJobs(jobs.filter(r => r.ats_provider === row.ats_provider && r.company_name === row.company_name && r.job_category === row.job_category && r.remote_policy.split('; ').includes(policy) && r.job_experience_level.split('; ').includes(level)));
    await page.fill('#query', row.job_id);
    await assertJobs([row]);
    await page.fill('#query', 'no-such-job-xyz');
    await assertJobs([]);
    assert(await page.locator('#empty').isVisible());
    await page.click('#reset');
    assert.equal(await select.inputValue(), '');
    await assertJobs(jobs);
    assert(!(await page.locator('#empty').isVisible()));
    await page.setViewportSize({ width: 390, height: 844 });
    await select.selectOption('Workday');
    await assertJobs(jobs.filter(row => row.ats_provider === 'Workday'));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Business ATS dropdown: exact providers, unknowns, combined search, empty/reset and mobile', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin + '/Business-Listings/');
    const select = page.getByLabel('ATS system', { exact: true });
    assert.equal(await select.count(), 1, 'Business Listings has an ATS system dropdown');
    const providers = [...new Set(businesses.map(row => row.ats_provider).filter(Boolean))].sort();
    assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(o => o.value)), ['', ...providers, 'unknown']);
    for (const provider of [...providers, 'unknown']) {
      await select.selectOption(provider);
      const expected = businesses.filter(row => provider === 'unknown' ? !row.ats_provider : row.ats_provider === provider);
      assert.deepEqual(await page.locator('tbody tr:visible').evaluateAll(rows => rows.map(row => row.id)), expected.map(row => row.business_id));
      assert.equal(await page.locator('#count').textContent(), `${expected.length} of ${businesses.length} businesses`);
    }
    const row = businesses.find(row => row.ats_provider);
    await select.selectOption(row.ats_provider);
    await page.fill('#search', row.business_id);
    assert.deepEqual(await page.locator('tbody tr:visible').evaluateAll(rows => rows.map(row => row.id)), [row.business_id]);
    await page.fill('#search', 'no-such-business-xyz');
    assert(await page.locator('#empty').isVisible());
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    assert.equal(await select.inputValue(), '');
    assert.equal(await page.locator('#search').inputValue(), '');
    assert.equal(await page.locator('tbody tr:visible').count(), businesses.length);
    assert(!(await page.locator('#empty').isVisible()));
    await page.setViewportSize({ width: 390, height: 844 });
    await select.selectOption(row.ats_provider);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
