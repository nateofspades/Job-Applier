"""Regression contract for the five-employer append (2026-10-27)."""
import csv
import hashlib
import json
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / 'site'

def rows(relative):
    with (SITE / relative).open(encoding='utf-8', newline='') as stream:
        return list(csv.DictReader(stream))

def digest(records):
    return hashlib.sha256(json.dumps(records, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

class FiveBusinessAppend(unittest.TestCase):
    def test_baseline_preserved_and_new_businesses_are_the_reviewed_cohort(self):
        data = rows('Business-Listings/Business_Listings.csv')
        self.assertGreaterEqual(len(data), 158)
        self.assertEqual(digest(data[:153]), '4ed27e5fd885744d3d48a86b9671a1085efd82d88d7c3c8208289279cfdd587d')
        self.assertEqual(digest(data[153:158]), 'd4d22317a2c55e127321bcf896528ef7c7d4ae1b5aba35169a3516d9e2622e2d')
        self.assertEqual([r['company_name'] for r in data[153:158]], ['Velixo', 'Finance Montréal', 'Code Marketing', 'AssistIQ', 'Precision Analytics'])
        self.assertTrue(all(r['date_added_to_dataset'] == '2026-10-27' for r in data[153:158]))

    def test_baseline_jobs_and_new_postings_are_preserved(self):
        data = rows('Job-Listings/Job_Listings.csv')
        self.assertGreaterEqual(len(data), 1322)
        self.assertEqual(digest(data[:1318]), 'cc87fb33297597c68b1355b8c9c829c5f6355bd95071f498daa9cd65d9cab9ef')
        self.assertEqual(digest(data[1318:1322]), 'dab81236ec7bf479a2f73f273bef0f3ff418008ea3d5d3e890b77a503c41602f')
        self.assertEqual([r['company_name'] for r in data[1318:1322]], ['Velixo', 'Velixo', 'Finance Montréal', 'AssistIQ'])
        self.assertTrue(all(r['date_added_to_dataset'] == '2026-10-27' for r in data[1318:1322]))

    def test_coverage_reports_zero_jobs_without_inventing_vacancies(self):
        data = json.loads((SITE / 'Job-Listings/coverage.json').read_text())
        counts = {r['company_name']: r['count'] for r in data['coverage']}
        self.assertEqual({n: counts[n] for n in ['Velixo', 'Finance Montréal', 'Code Marketing', 'AssistIQ', 'Precision Analytics']}, {'Velixo': 2, 'Finance Montréal': 1, 'Code Marketing': 0, 'AssistIQ': 1, 'Precision Analytics': 0})

if __name__ == '__main__':
    unittest.main()
