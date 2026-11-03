"""Business-only append: exact requested identities and immutable historical rows."""
import csv
import hashlib
import json
import unittest
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
MANIFEST = json.loads((ROOT / 'tests/fixtures/business-append-20261103.json').read_text())


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


class BusinessAppend20261103(unittest.TestCase):
    def test_exact_twenty_businesses_appended_preserving_baseline(self):
        path = SITE / 'Business-Listings/Business_Listings.csv'
        with path.open(encoding='utf-8', newline='') as stream:
            businesses = list(csv.DictReader(stream))
        start = MANIFEST['baseline_count']
        self.assertEqual(digest(businesses[:start]), MANIFEST['baseline_rows_sha256'])
        self.assertEqual(hashlib.sha256(path.read_bytes()[:MANIFEST['baseline_csv_bytes']]).hexdigest(),
                         MANIFEST['baseline_csv_sha256'])
        added = businesses[start:start + len(MANIFEST['requested'])]
        self.assertEqual([{'company_name': row['company_name'], 'career_page_url': row['career_page_url']}
                          for row in added], MANIFEST['requested'])
        counts = Counter(row['career_page_url'] for row in businesses)
        for row in added:
            with self.subTest(company=row['company_name']):
                self.assertEqual(counts[row['career_page_url']], 1)
                self.assertTrue(row['business_id'].startswith('biz_'))
                self.assertEqual(row['date_added_to_dataset'], MANIFEST['insertion_date'])
                self.assertEqual(date.fromisoformat(row['date_added_to_dataset']).isoformat(),
                                 row['date_added_to_dataset'])
                self.assertTrue(row['company_description'])
                self.assertTrue(row['industries'])
                self.assertNotIn(row['ats_provider'], ('Unknown', 'WordPress', 'Custom', 'Employer website'))
        providers = {row['company_name']: row['ats_provider'] for row in added}
        self.assertEqual(providers['Dreww'], 'Rippling')
        self.assertEqual(providers['Boutique 1861'], 'SmartRecruiters')


if __name__ == '__main__':
    unittest.main()
