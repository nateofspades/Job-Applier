"""Append-only contract for the 23 explicitly requested businesses."""
import csv
import hashlib
import json
import unittest
from collections import Counter
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / 'site'
EXPECTED = {
    'https://bytegurus.io/careers': 'ByteGurus',
    'https://www.higglo.io/careers': 'Higglo',
    'https://imagemotion.com/careers/': 'IMAGEMOTION',
    'https://careers-adastragrp.icims.com/jobs/search?ss=1': 'Adastra Corporation',
    'https://www.jadxagency.com/us/careers/': 'JADX',
    'https://www.pertinencemedia.com/en/career/': 'Pertinence Media',
    'https://agencerinaldi.com/carrieres/': 'Agence Rinaldi',
    'https://www.turnberryacai.com/careers': 'TurnBerry Acai',
    'https://www.aurasocial.ca/carriere': 'Aura Social',
    'https://redboxmedia.ca/en/career/': 'Redbox Media',
    'https://agencefdm.com/pages/carrieres': 'Agence FDM',
    'https://brandsmediagroup.com/careers': 'Brand’s Media Group',
    'https://marketika.co/careers': 'Markétika',
    'https://agencearchipel.com/carrieres/': 'Archipel',
    'https://www.terfuu.com/fr/careers': 'Terfuu',
    'https://agencilia.com/company/careers': 'Agencilia',
    'https://www.catalyslubricants.ca/en/careers': 'Catalys Lubricants',
    'https://unionlighting.com/en-us/pages/careers': 'Union Lighting & Décor',
    'https://emrn.ca/Careers/': 'EMRN',
    'https://www.thekershehgroup.com/careers': 'The Kersheh Group',
    'https://onclic.ca/en/about/careers/': 'OnClic',
    'https://couronsmtl.com/en/job-offers/': 'COURONS MTL',
    'https://hoski.ca/careers/': 'Hoski',
}

def rows(name):
    with (SITE / name).open(encoding='utf-8', newline='') as stream:
        return list(csv.DictReader(stream))

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()

class AgencyBusinesses(unittest.TestCase):
    def test_requested_businesses_are_appended_once_with_reviewed_metadata(self):
        businesses = rows('Business-Listings/Business_Listings.csv')
        self.assertEqual(digest(businesses[:173]), '6c45d3c667a1d776e67607505e4bf17691f4953b2cedbd6b9c099dcd9e3ee157')
        added = businesses[173:196]
        self.assertEqual(len(added), 23)
        self.assertEqual({r['career_page_url']: r['company_name'] for r in added}, EXPECTED)
        counts = Counter(r['career_page_url'] for r in businesses)
        for row in added:
            with self.subTest(company=row['company_name']):
                self.assertEqual(counts[row['career_page_url']], 1)
                self.assertEqual(row['date_added_to_dataset'], '2026-10-30')
                self.assertTrue(row['company_description'])
                self.assertNotEqual(row['company_description'], 'Business with a supplied careers page.')
                self.assertNotIn(row['industries'], ('', 'Not verified'))
        adastra = next(r for r in added if r['company_name'] == 'Adastra Corporation')
        self.assertEqual(adastra['ats_provider'], 'iCIMS')

    def test_original_jobs_are_preserved_and_directory_metadata_is_consistent(self):
        jobs = rows('Job-Listings/Job_Listings.csv')
        self.assertEqual(digest(jobs[:1356]), 'db58ab030a9de1eb9294939c2a25d24cae5f2dc59b498a2e16f9da05fd9e1e4d')
        payload = json.loads((SITE / 'Job-Listings/jobs.json').read_text())
        businesses = rows('Business-Listings/Business_Listings.csv')
        self.assertEqual(payload['company_count'], len(businesses))
        self.assertEqual([r['company_name'] for r in payload['coverage']], [r['company_name'] for r in businesses])
        counts = Counter(r['company_name'] for r in jobs)
        for entry in payload['coverage']:
            self.assertEqual(entry['count'], counts[entry['company_name']])
        self.assertEqual(payload['jobs'], jobs)

if __name__ == '__main__':
    unittest.main()
