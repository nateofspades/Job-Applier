// Isolated browser component tests: no production pages, servers or datasets.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = path.resolve(__dirname, '../site/shared/checkbox-filter.js');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });
const options = [
  { value: 'Alpha', label: 'Alpha company' },
  { value: 'unknown', label: 'unknown' },
  { value: '', label: 'Unspecified' },
  { value: '<img src=x onerror=alert(1)>', label: '<img src=x onerror=alert(1)>' }
];
async function mount(t, config = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.setContent('<!doctype html><html lang="en"><title>Checkbox filter test</title><body><div id="host"></div><button id="outside">Outside</button></body></html>');
  if (fs.existsSync(source)) await page.addScriptTag({ path: source });
  assert.equal(await page.evaluate(() => typeof window.CheckboxFilter?.create), 'function', 'browser exports CheckboxFilter.create');
  await page.evaluate(config => {
    window.changes = [];
    window.filter = CheckboxFilter.create(document.querySelector('#host'), {
      ...config, onChange: values => window.changes.push(values)
    });
  }, { label: 'Company', options, ...config });
  return page;
}

test('native accessible dropdown defaults to all and treats labels only as text', async t => {
  const page = await mount(t);
  assert.deepEqual(await page.evaluate(() => filter.values()), options.map(option => option.value));
  assert.equal(await page.locator('details.checkbox-filter > summary.filter-summary[aria-label="Company"]').count(), 1);
  assert.equal(await page.locator('.filter-panel .filter-options label.filter-option input[type="checkbox"]:checked').count(), options.length);
  assert.equal(await page.locator('.filter-selection').textContent(), '4 of 4 selected');
  assert.equal(await page.locator('.filter-actions button[type="button"]').count(), 2);
  assert.equal(await page.locator('img').count(), 0);
  assert.deepEqual(await page.locator('.filter-option').allTextContents(), options.map(option => option.label));
  assert.deepEqual(await page.evaluate(() => changes), []);
});

test('search matches labels without changing selection and stays local to each panel', async t => {
  const page = await mount(t, { selected: ['unknown'] });
  await page.locator('summary').click();
  const search = page.getByRole('searchbox', { name: 'Search Company options', exact: true });
  assert.equal(await search.locator('xpath=self::input[contains(@class,"filter-option-search")]').count(), 1);
  await search.fill(' COMPANY ');
  assert.deepEqual(await page.locator('.filter-option:visible').allTextContents(), ['Alpha company']);
  assert.deepEqual(await page.evaluate(() => filter.values()), ['unknown']);
  assert.equal(await page.locator('.filter-selection').textContent(), '1 of 4 selected');
  assert.deepEqual(await page.evaluate(() => changes), []);
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => filter.values()), options.map(option => option.value), 'bulk selection includes search-hidden options');
  await search.fill('no match');
  assert.equal(await page.locator('.filter-option:visible').count(), 0);
  await page.evaluate(() => {
    const other = document.createElement('div');
    other.id = 'other';
    document.body.append(other);
    window.second = CheckboxFilter.create(other, { label: 'ATS system', options: [{ value: 'x', label: 'Workday' }] });
  });
  await page.locator('#other summary').click();
  assert.equal(await page.locator('#other .filter-option:visible').count(), 1);
  await page.getByRole('searchbox', { name: 'Search ATS system options', exact: true }).fill('missing');
  assert.equal(await page.locator('#host .filter-option-search').inputValue(), 'no match');
  assert.deepEqual(await page.evaluate(() => second.values()), ['x']);
});

test('native keyboard controls work; Escape closes and focuses summary; outside click closes', async t => {
  const page = await mount(t);
  const summary = page.locator('summary');
  const details = page.locator('details');
  await summary.focus();
  await page.keyboard.press('Space');
  assert.equal(await details.evaluate(node => node.open), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('searchbox').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await details.evaluate(node => node.open), false);
  assert.equal(await summary.evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await details.evaluate(node => node.open), true);
  const checkbox = page.getByLabel('Alpha company', { exact: true });
  await checkbox.focus();
  await page.keyboard.press('Space');
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await page.evaluate(() => changes.length), 1);
  assert.equal(await details.evaluate(node => node.open), true, 'inside interactions do not dismiss');
  await page.locator('#outside').click();
  assert.equal(await details.evaluate(node => node.open), false);
  assert.equal(await page.locator('#outside').evaluate(node => node === document.activeElement), true, 'outside clicks retain their own focus');
  assert.equal(await page.evaluate(() => changes.length), 1, 'opening and closing never notify selection changes');
});

test('reset restores original all, partial and empty defaults plus option search', async t => {
  for (const selected of ['all', [''], []]) {
    const page = await mount(t, { selected });
    assert.equal(await page.evaluate(() => typeof filter.reset), 'function');
    await page.locator('summary').click();
    await page.getByRole('searchbox').fill('no match');
    await page.evaluate(() => filter.setValues(['Alpha']));
    await page.evaluate(() => filter.reset());
    const expected = selected === 'all' ? options.map(option => option.value) : selected;
    assert.deepEqual(await page.evaluate(() => filter.values()), expected);
    assert.equal(await page.getByRole('searchbox').inputValue(), '');
    assert.equal(await page.locator('.filter-option:visible').count(), options.length);
    assert.deepEqual(await page.evaluate(() => changes), [['Alpha'], expected]);
    await page.close();
  }
});

test('explicit empty selection stays empty; checkbox, bulk and setValues actions notify exactly once', async t => {
  const page = await mount(t, { selected: [] });
  assert.deepEqual(await page.evaluate(() => filter.values()), []);
  assert.equal(await page.locator('.filter-selection').textContent(), '0 of 4 selected');
  await page.locator('summary').click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByLabel('Alpha company', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.evaluate(() => filter.setValues(['', 'unknown', 'not an option', 'unknown']));
  assert.deepEqual(await page.evaluate(() => filter.values()), ['unknown', '']);
  assert.equal(await page.locator('.filter-selection').textContent(), '2 of 4 selected');
  assert.deepEqual(await page.evaluate(() => changes), [
    options.map(option => option.value), options.slice(1).map(option => option.value), [], ['unknown', '']
  ]);
  await page.evaluate(() => { filter.values().push('mutated'); filter.setValues([]); });
  assert.deepEqual(await page.evaluate(() => filter.values()), []);
  assert.equal(await page.evaluate(() => changes.length), 5);
  await page.evaluate(() => filter.setValues([]));
  assert.equal(await page.evaluate(() => changes.length), 6, 'even an idempotent setter notifies once');
});
