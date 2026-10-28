"""Preservation and cohort checks for the ten-employer October append."""
import csv
import hashlib
import json
import unittest
from pathlib import Path
SITE = Path(__file__).resolve().parents[1] / 'site'
def load(path):
    with (SITE / path).open(encoding='utf-8', newline='') as stream:
        return list(csv.DictReader(stream))
def digest(rows):
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
class TenBusinessAppend(unittest.TestCase):
    def test_business_baseline_and_cohort(self):
        rows=load('Business-Listings/Business_Listings.csv')
        self.assertGreaterEqual(len(rows),173)
        self.assertEqual(digest(rows[:163]),'9ef373a221abb9e1837320ee1821938824c760ed75679d9af9caf0b8acefea1b')
        expected=[('Clinia','https://clinia.com/careers/'),('MEDFAR Clinical Solutions','https://www.medfarsolutions.com/en/careers/'),('Plotly','https://plotly.com/careers/'),('Wrk','https://www.wrk.com/about/careers'),('SuccessFinder','https://www.successfinder.com/career-opportunities-successfinder/'),('WorkJam','https://www.workjam.com/company/careers/'),('Busbud','https://www.busbud.com/en/careers/'),('Bus.com','https://www.bus.com/careers/'),('OPAL-RT Technologies','https://www.opal-rt.com/careers/'),('Dakis','https://dakis.com/jobs')]
        self.assertEqual([(r['company_name'],r['career_page_url']) for r in rows[163:173]],expected)
        self.assertTrue(all(r['date_added_to_dataset']=='2026-10-27' for r in rows[163:173]))
    def test_job_baseline_and_cohort(self):
        rows=load('Job-Listings/Job_Listings.csv')
        self.assertGreaterEqual(len(rows),1356)
        self.assertEqual(digest(rows[:1325]),'39938ca7aa244f357ffdd005fabdd63b69042d1f0b2eb5e1a0516ada5f07e0ca')
        new=rows[1325:1356]
        self.assertEqual(sum(r['company_name']=='MEDFAR Clinical Solutions' for r in new),19)
        self.assertEqual(sum(r['company_name']=='OPAL-RT Technologies' for r in new),12)
        self.assertEqual(len({r['job_url'] for r in new}),31)
        self.assertEqual(hashlib.sha256(json.dumps([r['job_url'] for r in new],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'2f471d1ee2c9e612f4f07ea204d3ad2ae00a61737643bdcdaa0f013a19bb7f89')
        self.assertTrue(all(r['country']=='Canada' and r['full_job_post'] and r['date_added_to_dataset']=='2026-10-27' for r in new))
        self.assertEqual(json.loads((SITE/'Job-Listings/jobs.json').read_text())['jobs'],rows)
    def test_coverage(self):
        data=json.loads((SITE/'Job-Listings/coverage.json').read_text())['coverage']
        counts={r['company_name']:r['count'] for r in data}
        for name in ['Clinia','Plotly','Wrk','SuccessFinder','WorkJam','Busbud','Bus.com','Dakis']:
            self.assertEqual(counts[name],0)
        self.assertEqual(counts['MEDFAR Clinical Solutions'],19)
        self.assertEqual(counts['OPAL-RT Technologies'],12)
if __name__=='__main__': unittest.main()
