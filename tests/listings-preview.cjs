// Real-data preview checks. No synthetic jobs and no intercepted data/download requests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const origin = (process.env.PREVIEW_ORIGIN || 'http://127.0.0.1:18766').replace(/\/$/, '');
const prefix = process.env.PREVIEW_PREFIX || '';
const businessCSV = fs.readFileSync(path.join(root, 'site/Business-Listings/Business_Listings.csv'));
const businessRows = JSON.parse(execFileSync('python3', ['-c', 'import csv,json,sys; print(json.dumps(list(csv.DictReader(sys.stdin))))'], { input: businessCSV }));
const jobs = JSON.parse(fs.readFileSync(path.join(root, 'site/Job-Listings/jobs.json'))).jobs;
const report = { origin, prefix, businesses: businessRows.length, jobs: jobs.length, checks: [] };
const displayColumn = key => ({ company_name: 'company', ats_provider: 'ats' })[key] || key;
async function choose(page, id, values) {
  const details = page.locator(`#${id} details`);
  assert.equal(await details.count(), 1, `${id} is a native checkbox dropdown`);
  if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
  await details.getByRole('button', { name: 'Clear all', exact: true }).click();
  for (const value of values) await details.locator(`input[type="checkbox"][value=${JSON.stringify(value)}]`).check();
  await details.locator('summary').click();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    // Shared 1-vCPU collection host can be CPU/I/O saturated; assertions remain exact.
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const response = await page.goto(origin + prefix + '/Business-Listings/');
    assert.equal(response.status(), 200);
    assert.equal(await page.locator('tbody tr').count(), businessRows.length);
    const businessColumns = ['company_name', 'career_page_url', 'ats_provider', 'company_description', 'industries', 'city', 'country', 'date_added_to_dataset', 'business_id'];
    assert.deepEqual(await page.locator('thead th').allTextContents(), businessColumns.map(displayColumn));
    assert.deepEqual(await page.locator('thead th').evaluateAll(headers => headers.map(header => header.dataset.column)), businessColumns);
    assert.deepEqual(await page.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent))), businessRows.map(row => businessColumns.map(key => key === 'ats_provider' && !row[key] ? 'Not verified' : row[key])));
    // Exercise the real input handler for every ID without a cross-process
    // actionability/layout round trip per row on the shared small host.
    const searchResults = await page.evaluate(ids => {
      const input = document.querySelector('#search');
      return ids.map(id => {
        input.value = id;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const visible = [...document.querySelectorAll('tbody tr')].filter(row => !row.hidden);
        return { id, matches: visible.length, company: visible[0]?.querySelector('[data-column="company_name"]').textContent };
      });
    }, businessRows.map(row => row.business_id));
    assert.deepEqual(searchResults, businessRows.map(row => ({ id: row.business_id, matches: 1, company: row.company_name })));
    await page.fill('#search', 'zzzz_NO_SUCH_COMPANY_zzzz');
    assert(await page.locator('#empty').isVisible());
    await page.fill('#search', '');
    const businessDownloadPromise = page.waitForEvent('download');
    await page.locator('a.download').click();
    const businessDownload = await businessDownloadPromise;
    assert.equal(businessDownload.suggestedFilename(), 'Business_Listings.csv');
    assert.deepEqual(fs.readFileSync(await businessDownload.path()), businessCSV);
    const legacyBusinessDownload = await context.request.get(origin + prefix + '/Business-Listings/Business_Spreadsheet.csv');
    assert.equal(legacyBusinessDownload.status(), 200);
    assert.deepEqual(await legacyBusinessDownload.body(), businessCSV, 'Legacy business download matches canonical CSV');
    report.checks.push('Business page: every cell matches CSV, every business ID searchable, empty/reset states and actual canonical/legacy CSV downloads');
    console.log(report.checks.at(-1));

    const jobResponse = await page.goto(origin + prefix + '/Job-Listings/');
    assert.equal(jobResponse.status(), 200);
    await page.waitForFunction(count => document.querySelectorAll('#results tr').length === count, jobs.length);
    const jobColumns = ['job_url', 'job_title', 'company_name', 'ats_provider', 'job_category', 'remote_policy', 'job_experience_level', 'is_fulltime', 'salary', 'job_summary', 'job_responsibilities', 'experience_required', 'full_job_post', 'city', 'country', 'date_posted', 'date_added_to_dataset', 'job_id'];
    assert.deepEqual(await page.locator('#sticky-head th').allTextContents(), jobColumns.map(displayColumn));
    assert.deepEqual(await page.locator('#sticky-head th').evaluateAll(headers => headers.map(header => header.dataset.column)), jobColumns);
    assert.equal(await page.locator('#sticky-head th[draggable="true"]').count(), 18);
    assert.deepEqual(await page.locator('#results tr td:first-child a').evaluateAll(links => links.map(a => a.href)), jobs.map(job => job.job_url));
    const companyValues = await page.locator('#company input[type="checkbox"]').evaluateAll(options => options.map(option => option.value).filter(Boolean).sort());
    assert.deepEqual(companyValues, [...new Set(jobs.map(job => job.company_name))].sort());
    const rendered = await page.locator('#results tr').evaluateAll(rows => rows.map(row => ({
      title: row.querySelector('.title').textContent,
      company: row.querySelector('.company').textContent,
      dateAdded: row.querySelector('.date-added-to-dataset').textContent,
      lists: [...row.querySelectorAll('.details-list ul')].map(list => [...list.children].map(li => li.textContent))
    })));
    assert.deepEqual(rendered.map(row => row.title), jobs.map(row => row.job_title));
    assert.deepEqual(rendered.map(row => row.company), jobs.map(row => row.company_name));
    assert.deepEqual(rendered.map(row => row.dateAdded), jobs.map(row => row.date_added_to_dataset || ''));
    assert.deepEqual(rendered.map(row => row.lists), jobs.map(row => ['job_responsibilities', 'experience_required'].filter(key => row[key]).map(key => row[key].split('\n').filter(Boolean).map(line => line.replace(/^• /, '')))));
    report.checks.push('Job page: every posting link, title, business, responsibility and qualification list matches JSON');
    console.log(report.checks.at(-1));
    for (const company of [companyValues[0], companyValues.at(-1)]) {
      await choose(page, 'company', [company]);
      assert.equal(await page.locator('#results tr').count(), jobs.filter(row => row.company_name === company).length);
    }
    await page.click('#reset');
    assert.equal(await page.locator('#category').count(), 0, 'job_category is retained as a column, not a filter');
    for (const policy of ['remote', 'hybrid', 'in-office', '']) {
      await choose(page, 'remote', [policy]);
      const expected = jobs.filter(row => !policy ? !row.remote_policy : row.remote_policy.split(';').map(value => value.trim()).includes(policy)).length;
      assert.equal(await page.locator('#results tr').count(), expected);
    }
    await page.click('#reset');
    await choose(page, 'experience-levels', ['entry-level / junior']);
    assert.equal(await page.locator('#results tr').count(), jobs.filter(row => row.job_experience_level.split('; ').includes('entry-level / junior')).length);
    await choose(page, 'experience-levels', ['entry-level / junior', '']);
    assert.equal(await page.locator('#results tr').count(), jobs.filter(row => !row.job_experience_level || row.job_experience_level.split('; ').includes('entry-level / junior')).length);
    await page.click('#reset');
    await page.fill('#query', jobs.at(-1).job_id);
    assert.equal(await page.locator('#results tr').count(), 1);
    await page.locator('.advertisement-open').click();
    assert(await page.locator('dialog').isVisible());
    assert.equal(await page.locator('.advertisement-body').textContent(), jobs.at(-1).full_job_post);
    await page.keyboard.press('Escape');
    await page.fill('#query', 'zzzz_NO_SUCH_JOB_zzzz');
    assert(await page.locator('#empty').isVisible());
    await page.click('#reset');
    assert.equal(await page.locator('#results tr').count(), jobs.length);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('a.download').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'Job_Listings.csv');
    assert.deepEqual(fs.readFileSync(await download.path()), fs.readFileSync(path.join(root, 'site/Job-Listings/Job_Listings.csv')));
    report.checks.push('Job filters: company checkbox dropdown/all remote policies/junior+unspecified/ID/empty/reset, saved advertisement panel, actual CSV download');
    console.log(report.checks.at(-1));
    await page.evaluate(() => window.scrollTo(0, 1400));
    await page.waitForFunction(() => document.querySelector('#dataset-sticky').getBoundingClientRect().top < 2);
    await page.evaluate(() => document.querySelector('#table-top-scroll').scrollLeft = 260);
    await page.waitForFunction(() => document.querySelector('#table-wrap').scrollLeft === 260);
    await page.evaluate(() => document.querySelector('#table-wrap').scrollLeft = 500);
    await page.waitForFunction(() => document.querySelector('#table-top-scroll').scrollLeft === 500);
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.goto(origin + prefix + '/Business-Listings/');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.deepEqual(errors, []);
    report.checks.push('Sticky controls, bidirectional scrollbar, mobile containment on both pages, no page/console errors');
    console.log(report.checks.at(-1));
    report.passed = true;
    if (process.env.REPORT_PATH) fs.writeFileSync(process.env.REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
