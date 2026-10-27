"""Preservation and scope checks for the October 27 technology employer append."""
import csv
import hashlib
import json
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / 'site'

def rows(path):
    with (SITE / path).open(encoding='utf-8', newline='') as stream:
        return list(csv.DictReader(stream))

def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

class TechnologyAppend(unittest.TestCase):
    def test_baseline_and_five_businesses(self):
        data = rows('Business-Listings/Business_Listings.csv')
        self.assertEqual(digest(data[:158]), 'daac2918bbb6d4d2a5a0b73aae3d251720a5b1872c44c73f50ff5121895def34')
        expected = [('Heylist', 'https://www.heylist.com/careers'), ('Inmind Technologies', 'https://inmindtechnologies.com/en/carreer/'), ('Nixa', 'https://nixa.ca/careers'), ('Walter Interactive', 'https://www.walterinteractive.com/carriere'), ('IVADO Labs', 'https://ivadolabs.com/en/work-with-us')]
        self.assertEqual([(r['company_name'], r['career_page_url']) for r in data[158:163]], expected)
        self.assertTrue(all(r['date_added_to_dataset'] == '2026-10-27' for r in data[158:163]))

    def test_baseline_jobs_and_cohort(self):
        data = rows('Job-Listings/Job_Listings.csv')
        self.assertEqual(digest(data[:1322]), '00d0f244368653060464b76c6a8b93d4a67b72601238fda87d63f8969cac1206')
        self.assertEqual({(r['company_name'], r['job_title']) for r in data[1322:1325]}, {('Heylist','Marketing Director'), ('Heylist','Account Executive'), ('Heylist','Creator Success Manager')})
        self.assertTrue(all(r['date_added_to_dataset'] == '2026-10-27' and r['country'] == 'Canada' and r['full_job_post'] for r in data[1322:1325]))
        batch = {'Heylist', 'Inmind Technologies', 'Nixa', 'Walter Interactive', 'IVADO Labs'}
        self.assertEqual([r for r in data if r['company_name'] in batch], data[1322:1325])
        self.assertEqual(json.loads((SITE / 'Job-Listings/jobs.json').read_text())['jobs'], data)

    def test_coverage_matches_batch(self):
        coverage = json.loads((SITE / 'Job-Listings/coverage.json').read_text())['coverage']
        actual = {r['company_name']: r['count'] for r in coverage}
        self.assertEqual({n: actual[n] for n in ('Heylist','Inmind Technologies','Nixa','Walter Interactive','IVADO Labs')}, {'Heylist': 3, 'Inmind Technologies': 0, 'Nixa': 0, 'Walter Interactive': 0, 'IVADO Labs': 0})

if __name__ == '__main__':
    unittest.main()
