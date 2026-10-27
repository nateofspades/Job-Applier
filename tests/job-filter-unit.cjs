const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectRows } = require('../site/Job-Listings/filter.js');

const rows = [
  { company_name: 'Alpha', ats_provider: 'Workday', job_category: 'Engineering', job_experience_level: 'Junior; Senior', remote_policy: 'Fully remote; Hybrid', job_title: 'English Engineer' },
  { company_name: 'Beta', ats_provider: 'Greenhouse', job_category: 'Sales', job_experience_level: '', remote_policy: 'Fully in office', job_title: 'Account Executive' },
  { company_name: 'Alpha', ats_provider: '', job_category: 'Engineering', job_experience_level: 'Senior', remote_policy: '', job_title: 'Platform Engineer' },
  { company_name: 'unknown', ats_provider: 'unknown', job_category: '', job_experience_level: 'Junior', remote_policy: 'In office', job_title: 'Literal unknown' },
  { company_name: '', job_category: '', job_experience_level: '', remote_policy: '', job_title: 'Unspecified' }
].map(Object.freeze);

function indexes(filters) { return selectRows(rows, filters).map(row => rows.indexOf(row)); }

test('query, scalar compatibility and remote aliases remain unchanged', () => {
  assert.deepEqual(indexes({ query: '  ENGLISH  ', remote: 'remote', company: 'Alpha', category: 'Engineering', ats: 'Workday' }), [0]);
  assert.deepEqual(indexes({ remote: 'in-office' }), [1, 3]);
  assert.deepEqual(indexes({ remote: 'Hybrid' }), [0]);
  assert.deepEqual(indexes({ remote: 'unknown', ats: 'unknown' }), [2, 4]);
  assert.deepEqual(indexes({ company: 'unknown', category: 'unknown' }), [4]);
  assert.deepEqual(indexes({ query: 'no such job' }), []);
  assert.deepEqual(indexes({ companies: ['Alpha', 'Beta'], company: 'Alpha', atsProviders: ['', 'Workday'], category: 'Engineering', levels: ['Senior'], remote: 'remote' }), [0]);
});

test('filtering full English source records preserves references, fields and source bytes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const filename = path.resolve(__dirname, '../site/Job-Listings/jobs.json');
  const bytes = fs.readFileSync(filename);
  const sourceRows = JSON.parse(bytes).jobs;
  const original = JSON.stringify(sourceRows);
  sourceRows.forEach(Object.freeze);
  const filtered = selectRows(sourceRows, { companies: [...new Set(sourceRows.map(row => row.company_name))] });
  assert.deepEqual(filtered, sourceRows);
  filtered.forEach((row, index) => assert.strictEqual(row, sourceRows[index]));
  assert.equal(JSON.stringify(sourceRows), original);
  assert.deepEqual(fs.readFileSync(filename), bytes);
});

test('company and ATS arrays use OR within each dimension, AND across dimensions', () => {
  assert.deepEqual(indexes({ companies: ['Alpha', 'Beta'], atsProviders: ['Workday', 'Greenhouse'] }), [0, 1]);
  assert.deepEqual(indexes({ companies: ['Alpha'], atsProviders: ['Greenhouse', ''] }), [2]);
  assert.deepEqual(indexes({ companies: [] }), []);
  assert.deepEqual(indexes({ atsProviders: [] }), []);
  assert.deepEqual(indexes({ companies: ['unknown'], atsProviders: ['unknown'] }), [3]);
  assert.deepEqual(indexes({ companies: [''], atsProviders: [''] }), [4]);
  assert.deepEqual(indexes(), [0, 1, 2, 3, 4]);
});

test('active experience selection distinguishes none from unrestricted legacy defaults', () => {
  assert.deepEqual(indexes({ levelsActive: true, levels: [], includeUnspecified: false }), []);
  assert.deepEqual(indexes({ levels: [], includeUnspecified: false }), [0, 1, 2, 3, 4]);
  assert.deepEqual(indexes({ levelsActive: true, levels: ['Senior'], includeUnspecified: false }), [0, 2]);
  assert.deepEqual(indexes({ levelsActive: true, levels: [], includeUnspecified: true }), [1, 4]);
  assert.deepEqual(indexes({ levels: ['Junior'], includeUnspecified: true }), [0, 1, 3, 4]);
});
