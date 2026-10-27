"""Stable presentation requirements, independent of dataset size or release date."""
import unittest
from pathlib import Path
from html.parser import HTMLParser

SITE = Path(__file__).resolve().parents[1] / 'site'


class Elements(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.items = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.items.append((tag, dict(attrs)))


class InterfaceContract(unittest.TestCase):
    def test_job_page_contains_no_release_announcements_or_removed_controls(self):
        text = (SITE / 'Job-Listings/index.html').read_text()
        elements = Elements(text)
        ids = {attrs.get('id') for _, attrs in elements.items}
        for removed in ['coverage-note', 'url-audit-note', 'remote-filter-help', 'category', 'experience-unspecified']:
            self.assertNotIn(removed, ids)
        for phrase in ['Career research / public postings', 'A dash means', 'Blank date_added_to_dataset', 'Long lists scroll', 'Full job post opens', 'URL review:']:
            self.assertNotIn(phrase, text)
        self.assertIn('job_category', (SITE / 'Job-Listings/app.js').read_text())

    def test_both_pages_use_shared_ui_and_multiselect_hosts(self):
        for name in ['Business-Listings', 'Job-Listings']:
            with self.subTest(page=name):
                text = (SITE / name / 'index.html').read_text()
                elements = Elements(text)
                self.assertTrue(any(tag == 'link' and attrs.get('href', '').startswith('../shared/listings.css?v=') for tag, attrs in elements.items))
                self.assertTrue(any(tag == 'script' and attrs.get('src', '').startswith('../shared/checkbox-filter.js?v=') for tag, attrs in elements.items))
                for key in ['company', 'ats']:
                    self.assertTrue(any(tag == 'div' and attrs.get('id') == key for tag, attrs in elements.items))
                count = 'count' if name == 'Business-Listings' else 'status'
                self.assertTrue(any(tag == 'strong' and attrs.get('id') == count for tag, attrs in elements.items))
                self.assertNotIn('ATS system', text)
                self.assertNotIn('<style>', text, 'Shared stylesheet is the source of comparable UI sizing')

    def test_business_header_aliases_preserve_internal_keys(self):
        text = (SITE / 'Business-Listings/index.html').read_text()
        self.assertIn('data-column="company_name">company</th>', text)
        self.assertIn('data-column="ats_provider">ats</th>', text)


if __name__ == '__main__':
    unittest.main()
