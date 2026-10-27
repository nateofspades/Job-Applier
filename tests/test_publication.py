"""Offline publication gates; no network access or private research inputs."""
import csv
import json
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.bases = []
        self.assets = []
        self.links = []
        self.rows = []
        self.cell = None
        self.row = None
        self.feed(text)

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if tag == 'base':
            self.bases.append(attrs.get('href'))
        if tag == 'script' and 'src' in attrs:
            self.assets.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.assets.append(attrs['href'])
        if tag == 'a' and 'href' in attrs:
            self.links.append(attrs['href'])
            if 'download' in attrs:
                self.assets.append(attrs['href'])
        if tag == 'tr':
            self.row = []
        if tag == 'td':
            self.cell = ''

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.row.append(self.cell)
            self.cell = None
        if tag == 'tr' and self.row:
            self.rows.append(self.row)
            self.row = None


def csv_rows(path):
    with path.open(newline='', encoding='utf-8') as stream:
        return list(csv.DictReader(stream))


class PublicationTests(unittest.TestCase):
    def test_pages_resolve_assets_under_repository_prefix(self):
        for name in ['Business-Listings', 'Job-Listings']:
            with self.subTest(page=name):
                page = Page((SITE / name / 'index.html').read_text())
                self.assertEqual(page.bases, ['./'], 'Use a portable directory-relative base')
                location = f'https://example.github.io/Job-Applier/{name}/'
                for reference in page.assets:
                    resolved = urlsplit(urljoin(location, reference))
                    self.assertEqual(resolved.netloc, 'example.github.io')
                    prefix = '/Job-Applier/'
                    self.assertTrue(resolved.path.startswith(prefix))
                    target = SITE / unquote(resolved.path[len(prefix):])
                    self.assertTrue(target.is_relative_to(SITE))
                    self.assertTrue(target.is_file(), f'Missing asset {reference}')

    def test_workflow_healthcheck_targets_retained_page(self):
        workflow = (ROOT / '.github/workflows/pages.yml').read_text()
        self.assertIn('/Job-Applier/Business-Listings/', workflow)
        self.assertNotIn('/Job-Applier/index.html', workflow)

    def test_no_root_landing_page_or_readme_link(self):
        self.assertFalse((SITE / 'index.html').exists())
        self.assertNotIn('https://nateofspades.github.io/Job-Applier/)', (ROOT / 'README.md').read_text())

    def test_dataset_dates_are_populated(self):
        for name, filename, count, migrated in [('business', 'Business-Listings/Business_Listings.csv', 153, 109), ('job', 'Job-Listings/Job_Listings.csv', 1318, 1093)]:
            with self.subTest(dataset=name):
                records = csv_rows(SITE / filename)
                self.assertGreaterEqual(len(records), count)
                self.assertTrue(all(row['date_added_to_dataset'] for row in records))
                self.assertFalse(any(row['date_added_to_dataset'] == '2026-09-04' for row in records[:count]))
                self.assertEqual(sum(row['date_added_to_dataset'] == '2026-09-30' for row in records[:count]), migrated)

    def test_download_aliases_match(self):
        for name, canonical, alias in [
            ('Business-Listings', 'Business_Listings.csv', 'Business_Spreadsheet.csv'),
            ('Job-Listings', 'Job_Listings.csv', 'Job_Filters.csv'),
        ]:
            self.assertEqual((SITE / name / canonical).read_bytes(), (SITE / name / alias).read_bytes())

    def test_job_json_matches_csv_and_references_real_businesses(self):
        jobs = csv_rows(SITE / 'Job-Listings/Job_Listings.csv')
        payload = json.loads((SITE / 'Job-Listings/jobs.json').read_text())
        self.assertEqual(jobs, payload['jobs'])
        businesses = csv_rows(SITE / 'Business-Listings/Business_Listings.csv')
        names = {row['company_name'] for row in businesses}
        self.assertEqual(len(names), len(businesses))
        self.assertEqual(len({row['business_id'] for row in businesses}), len(businesses))
        self.assertEqual(len({row['job_id'] for row in jobs}), len(jobs))
        self.assertTrue(all(row['business_id'] for row in businesses))
        self.assertTrue(all(row['job_id'] and row['company_name'] in names for row in jobs))
        self.assertTrue(all(row['job_url'].startswith(('https://', 'http://')) for row in jobs))

    def test_business_table_matches_csv(self):
        rows = csv_rows(SITE / 'Business-Listings/Business_Listings.csv')
        page = Page((SITE / 'Business-Listings/index.html').read_text())
        expected = [[('Not verified' if key == 'ats_provider' and not value else value) for key, value in row.items()] for row in rows]
        self.assertEqual(page.rows, expected)

    def test_public_site_has_only_expected_assets(self):
        expected = {
            '.nojekyll',
            'shared/listings.css', 'shared/checkbox-filter.js',
            'Business-Listings/business.js',
            'Business-Listings/Business_Listings.csv', 'Business-Listings/Business_Spreadsheet.csv',
            'Business-Listings/index.html', 'Business-Listings/table-controls.css', 'Business-Listings/table-controls.js',
            'Job-Listings/Job_Filters.csv', 'Job-Listings/Job_Listings.csv',
            'Job-Listings/advertisement-preview.css', 'Job-Listings/advertisement-preview.js',
            'Job-Listings/app.js', 'Job-Listings/coverage.json', 'Job-Listings/filter.js',
            'Job-Listings/index.html', 'Job-Listings/jobs.json', 'Job-Listings/top-scroll.js',
        }
        actual = {p.relative_to(SITE).as_posix() for p in SITE.rglob('*') if p.is_file()}
        self.assertEqual(actual, expected)
        self.assertFalse(any(p.is_symlink() for p in SITE.rglob('*')))


if __name__ == '__main__':
    unittest.main()
