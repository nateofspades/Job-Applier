"""Prove the publication gate fails closed on future bad IDs in any export."""
import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_publication as publication


class JobIdGateTests(unittest.TestCase):
    def test_prefix_gate_rejects_new_invalid_ids_in_each_representation(self):
        for invalid in ('custom-future', 'ats-123', '', 'job_', None):
            for target in ('Job_Listings.csv', 'Job_Filters.csv', 'jobs.json', 'all'):
                with self.subTest(job_id=invalid, target=target), tempfile.TemporaryDirectory() as directory:
                    site = Path(directory)
                    jobs = site / 'Job-Listings'
                    jobs.mkdir()
                    for filename in ('Job_Listings.csv', 'Job_Filters.csv', 'jobs.json'):
                        # Keep the existing valid row; append a bad future record.
                        rows = [{'job_id': 'job_existing'}, {'job_id': invalid
                                if target in (filename, 'all') else 'job_future'}]
                        path = jobs / filename
                        if filename.endswith('.json'):
                            path.write_text(json.dumps({'jobs': rows}))
                        else:
                            with path.open('w', newline='') as stream:
                                writer = csv.DictWriter(stream, fieldnames=['job_id'])
                                writer.writeheader()
                                writer.writerows(rows)
                    result = unittest.TestResult()
                    with patch.object(publication, 'SITE', site):
                        publication.PublicationTests('test_all_job_ids_use_job_prefix').run(result)
                    self.assertEqual(result.errors, [])
                    self.assertEqual(len(result.failures), 3 if target == 'all' else 1)
                    self.assertTrue(all('Every job_id must start with job_' in message
                                        for _, message in result.failures))


if __name__ == '__main__':
    unittest.main()
