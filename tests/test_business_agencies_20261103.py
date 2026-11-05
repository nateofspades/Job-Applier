"""Requested business-only append; historical directory and job snapshot stay intact."""
import csv
import hashlib
import io
import json
import re
import unittest
from datetime import date
from pathlib import Path
from append_only_contract import historical_job_assets

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
MANIFEST = json.loads((ROOT / 'tests/fixtures/business-agencies-20261103.json').read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


class BusinessAgenciesAppend(unittest.TestCase):
    def test_requested_twenty_appended_exactly_once(self):
        data = (SITE / 'Business-Listings/Business_Listings.csv').read_bytes()
        rows = list(csv.DictReader(io.StringIO(data.decode(), newline='')))
        start = MANIFEST['baseline_count']
        requested = MANIFEST['requested']
        added = rows[start:start + len(requested)]
        self.assertEqual([{'company_name': r['company_name'], 'career_page_url': r['career_page_url']}
                          for r in added], requested)
        self.assertEqual(digest(data[:MANIFEST['baseline_csv_bytes']]), MANIFEST['baseline_csv_sha256'])
        self.assertEqual(digest(json.dumps(rows[:start], sort_keys=True, ensure_ascii=False,
                                          separators=(',', ':')).encode()), MANIFEST['baseline_rows_sha256'])
        for row in added:
            with self.subTest(company=row['company_name']):
                self.assertEqual(sum(r['company_name'] == row['company_name'] for r in rows), 1)
                self.assertEqual(sum(r['career_page_url'] == row['career_page_url'] for r in rows), 1)
                self.assertRegex(row['business_id'], r'^biz_[a-f0-9]{32}$')
                self.assertTrue(row['company_description'])
                self.assertTrue(row['industries'])
                self.assertEqual(row['date_added_to_dataset'], MANIFEST['insertion_date'])
                self.assertEqual(date.fromisoformat(row['date_added_to_dataset']).isoformat(), row['date_added_to_dataset'])
                self.assertNotIn(row['ats_provider'], ('Unknown', 'WordPress', 'Shopify', 'Custom', 'Employer website'))

    def test_all_job_assets_and_other_frontend_files_unchanged(self):
        # Check the original snapshot hashes after independently validating live
        # prefixes/metadata; later reviewed appends must not freeze job assets.
        historical = historical_job_assets(SITE)
        changed = {'Business-Listings/Business_Listings.csv', 'Business-Listings/Business_Spreadsheet.csv',
                   'Business-Listings/index.html'}
        for name, expected in MANIFEST['baseline_site_sha256'].items():
            if name not in changed:
                with self.subTest(asset=name):
                    data = historical[name] if name in historical else (SITE / name).read_bytes()
                    self.assertEqual(digest(data), expected)

    def test_preexisting_business_html_preserved_byte_for_byte(self):
        data = (SITE / 'Business-Listings/index.html').read_text()
        before, rest = data.split('<tbody>', 1)
        body, after = rest.split('</tbody>', 1)
        records = re.findall(r'<tr id="biz_[^"]+">.*?</tr>\n*', body, re.S)
        self.assertEqual(''.join(records), body)
        start = MANIFEST['baseline_count']
        before = re.sub(r'\d+ of \d+ businesses', f'{start} of {start} businesses', before)
        projected = before + '<tbody>' + ''.join(records[:start]) + '</tbody>' + after
        self.assertEqual(digest(projected.encode()), MANIFEST['baseline_site_sha256']['Business-Listings/index.html'])


if __name__ == '__main__':
    unittest.main()
