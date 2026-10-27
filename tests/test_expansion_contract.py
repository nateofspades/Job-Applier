"""Append-only contract for the twenty user-supplied employers."""
import csv
import hashlib
import json
import unittest
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
MANIFEST = json.loads((ROOT / 'tests/fixtures/expansion-baseline.json').read_text())

def rows(path):
    with path.open(newline='', encoding='utf-8') as stream:
        return list(csv.DictReader(stream))

def digest(records):
    return hashlib.sha256(json.dumps(records, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

class ExpansionContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.businesses = rows(SITE / 'Business-Listings/Business_Listings.csv')
        cls.jobs = rows(SITE / 'Job-Listings/Job_Listings.csv')
        cls.payload = json.loads((SITE / 'Job-Listings/jobs.json').read_text())

    def test_original_rows_and_schema_unchanged(self):
        for name, records in [('business', self.businesses), ('job', self.jobs)]:
            self.assertEqual(list(records[0]), MANIFEST[name + '_fields'])
            baseline = [dict(row) for row in records[:MANIFEST[name + '_count']]]
            # The approved default replaced only formerly blank baseline dates.
            # Reverse that migration before checking the immutable original digest.
            for row in baseline:
                if row['date_added_to_dataset'] == '2026-09-04':
                    row['date_added_to_dataset'] = ''
            self.assertEqual(digest(baseline), MANIFEST[name + '_sha256'])

    def test_twenty_businesses_in_user_order_with_exact_urls(self):
        appended = self.businesses[MANIFEST['business_count']:MANIFEST['business_count'] + 20]
        self.assertEqual([{'company_name': x['company_name'], 'career_page_url': x['career_page_url']} for x in appended], MANIFEST['new_businesses'])
        self.assertEqual(digest(appended), 'f170ec2153f75e32dd7b44c278ec9dc87787aa6231066839a2a547454a3b5465')
        for row in appended:
            self.assertEqual(row['date_added_to_dataset'], MANIFEST['insertion_date'])
            self.assertTrue(row['company_description'])
            self.assertTrue(row['industries'])
            self.assertEqual(row['country'], 'Canada')

    def test_original_csv_prefix_bytes_unchanged(self):
        for name, relative in [('business', 'Business-Listings/Business_Listings.csv'), ('job', 'Job-Listings/Job_Listings.csv')]:
            data = (SITE / relative).read_bytes().replace(b',2026-09-04\r\n', b',\r\n')[:MANIFEST[name + '_csv_prefix_bytes']]
            self.assertEqual(hashlib.sha256(data).hexdigest(), MANIFEST[name + '_csv_prefix_sha256'])

    def test_new_jobs_are_complete_and_reference_new_businesses(self):
        new_jobs = self.jobs[MANIFEST['job_count']:MANIFEST['job_count'] + 41]
        self.assertEqual(len(new_jobs), 41)
        self.assertEqual(digest(new_jobs), 'c641996a7733eacc7dd1b524eab3fdfbe2a9a4f13f3ed2c2e0c9869644784f8a')
        names = {row['company_name'] for row in MANIFEST['new_businesses']}
        levels = {'internship', 'entry-level / junior', 'mid-level / intermediate', 'senior', 'lead', 'staff', 'principal', 'manager', 'director', 'executive'}
        for row in new_jobs:
            with self.subTest(job_id=row['job_id']):
                self.assertIn(row['company_name'], names)
                self.assertEqual(row['country'], 'Canada')
                self.assertEqual(row['date_added_to_dataset'], MANIFEST['insertion_date'])
                self.assertIn(row['is_fulltime'], {'', 'yes', 'no'})
                self.assertTrue(not row['remote_policy'] or set(row['remote_policy'].split('; ')) <= {'remote', 'hybrid', 'in-office'})
                self.assertTrue(not row['job_experience_level'] or set(row['job_experience_level'].split('; ')) <= levels)
                self.assertTrue(row['job_title'])
                self.assertTrue(row['job_summary'])
                self.assertGreater(len(row['full_job_post']), 200)
                self.assertTrue(row['job_url'].startswith('https://'))
                if row['date_posted']:
                    age = (date.fromisoformat(MANIFEST['collection_date']) - date.fromisoformat(row['date_posted'])).days
                    self.assertGreaterEqual(age, 0)
                    self.assertLessEqual(age, 180)

    def test_coverage_matches_both_datasets_and_each_employer(self):
        other = json.loads((SITE / 'Job-Listings/coverage.json').read_text())
        self.assertEqual(other, {k: v for k, v in self.payload.items() if k != 'jobs'})
        self.assertEqual(self.payload['company_count'], len(self.businesses))
        counts = Counter(row['company_name'] for row in self.jobs)
        coverage = self.payload['coverage']
        self.assertEqual(len({row['company_name'] for row in coverage}), len(coverage))
        for row in MANIFEST['new_businesses']:
            matched = [c for c in coverage if c['company_name'] == row['company_name']]
            self.assertEqual(len(matched), 1)
            self.assertEqual(matched[0]['count'], counts[row['company_name']])
            self.assertTrue(matched[0]['status'])
            self.assertTrue(matched[0]['notes'])

if __name__ == '__main__':
    unittest.main()
