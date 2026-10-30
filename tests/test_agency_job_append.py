"""Pin the reviewed 40-job append without publishing private source captures."""
import csv
import hashlib
import json
import unittest
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
MANIFEST = json.loads((ROOT / 'tests/fixtures/agency-job-append.json').read_text())

def digest(row):
    return hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()

class AgencyJobAppend(unittest.TestCase):
    def test_reviewed_jobs_appended_without_mutating_existing_jobs(self):
        with (SITE / 'Job-Listings/Job_Listings.csv').open(newline='', encoding='utf-8') as stream:
            jobs = list(csv.DictReader(stream))
        self.assertEqual(digest(jobs[:1356]), 'db58ab030a9de1eb9294939c2a25d24cae5f2dc59b498a2e16f9da05fd9e1e4d')
        added = jobs[1356:1396]
        self.assertEqual(len(added), MANIFEST['added_job_count'])
        self.assertEqual([r['job_id'] for r in added], [r['job_id'] for r in MANIFEST['new_jobs']])
        levels = ['internship', 'entry-level / junior', 'mid-level / intermediate', 'senior',
                  'lead', 'staff', 'principal', 'manager', 'director', 'executive']
        for row, expected in zip(added, MANIFEST['new_jobs']):
            with self.subTest(job=row['job_id']):
                self.assertEqual(digest(row), expected['row_sha256'])
                self.assertEqual(row['country'], 'Canada')
                self.assertEqual(row['date_added_to_dataset'], MANIFEST['insertion_date'])
                self.assertIn(row['ats_provider'], ('', 'iCIMS'))
                self.assertIn(row['is_fulltime'], ('', 'yes', 'no'))
                if row['remote_policy']:
                    self.assertLessEqual(set(row['remote_policy'].split('; ')), {'remote', 'hybrid', 'in-office'})
                if row['job_experience_level']:
                    parts = row['job_experience_level'].split('; ')
                    self.assertEqual(parts, sorted(set(parts), key=levels.index))
                if row['date_posted']:
                    age = (date.fromisoformat(MANIFEST['insertion_date']) - date.fromisoformat(row['date_posted'])).days
                    self.assertTrue(0 <= age <= 180)
                self.assertGreater(len(row['full_job_post']), 200)
                self.assertNotIn('/root/', json.dumps(row))
                self.assertNotIn('[truncated]', row['full_job_post'])
                self.assertNotIn('END #page-title', row['full_job_post'])
        self.assertEqual(len({r['job_id'] for r in jobs}), len(jobs))
        self.assertEqual(len({(r['job_url'], r['job_title']) for r in added}), 40)

    def test_new_qualification_lists_exclude_working_terms_and_terminal_semicolons(self):
        payload = json.loads((SITE / 'Job-Listings/jobs.json').read_text())
        excluded = (
            'Legal authorization to work in Canada', 'Legal right to work in Canada.',
            'Eligibility to work in Canada and willingness to travel',
            'Willingness to participate in a compensated after-hours',
            'The successful candidate will be expected to pursue relevant AWS certifications',
            'Full time, in person position', 'Must be available on weekends',
            'Ability to lift heavy weight items', 'Able to lift and move products safely',
            'Available for occasional travel', 'Mileage and parking are reimbursed.',
            'Must be able to provide an official internship agreement',
        )
        for row in payload['jobs'][1356:1396]:
            with self.subTest(job=row['job_id']):
                for text in excluded:
                    self.assertNotIn(text, row['experience_required'])
                for key in ('experience_required', 'job_responsibilities'):
                    self.assertFalse(any(line.rstrip().endswith(';') for line in row[key].splitlines()))
                if '/jobs/5804/' in row['job_url']:
                    self.assertEqual(row['job_experience_level'], 'senior; principal')

    def test_job_release_preserves_all_business_assets(self):
        for path, expected in MANIFEST['business_assets_sha256'].items():
            self.assertEqual(hashlib.sha256((SITE / path).read_bytes()).hexdigest(), expected)

    def test_all_23_employers_have_scoped_coverage_matching_job_counts(self):
        payload = json.loads((SITE / 'Job-Listings/jobs.json').read_text())
        with (SITE / 'Business-Listings/Business_Listings.csv').open(newline='', encoding='utf-8') as stream:
            businesses = list(csv.DictReader(stream))[173:196]
        counts = Counter(row['company_name'] for row in payload['jobs'])
        coverage = {row['company_name']: row for row in payload['coverage']}
        for business in businesses:
            entry = coverage[business['company_name']]
            self.assertEqual(entry['count'], counts[business['company_name']])
            self.assertNotEqual(entry['status'], 'Collection pending')
            self.assertTrue(entry['notes'])
            self.assertEqual(set(entry), {'company_name', 'count', 'status', 'notes'})
            self.assertNotIn('/root/', json.dumps(entry))

if __name__ == '__main__':
    unittest.main()
