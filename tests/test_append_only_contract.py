"""Synthetic append/corruption inputs stay in memory or temporary test sites."""
from collections import Counter
from contextlib import ExitStack
from copy import deepcopy
import csv
from datetime import date, timedelta
import html
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import append_only_contract as contract

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'


def encode_csv(rows, fields, quoting=csv.QUOTE_MINIMAL):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator='\r\n', quoting=quoting)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def spec(data, fields):
    records = contract.csv_rows(data, fields)
    return {'count': len(records), 'csv_bytes': len(data), 'csv_sha256': contract.sha256(data),
            'rows_sha256': contract.rows_digest(records)}


def rows(assets, kind):
    name = contract.BUSINESS_CSV if kind == 'business' else contract.JOB_CSV
    return contract.csv_rows(assets[name], contract.BASELINE['datasets'][kind]['fields'])


def set_csv(assets, kind, records, quoting=csv.QUOTE_MINIMAL):
    canonical, alias = ((contract.BUSINESS_CSV, contract.BUSINESS_ALIAS) if kind == 'business'
                        else (contract.JOB_CSV, contract.JOB_ALIAS))
    assets[canonical] = assets[alias] = encode_csv(records, contract.BASELINE['datasets'][kind]['fields'], quoting)


def set_payload(assets, payload):
    assets[contract.JOB_JSON] = contract.json_bytes(payload)
    assets[contract.COVERAGE_JSON] = contract.json_bytes({key: value for key, value in payload.items() if key != 'jobs'})


def append_fixture(original, mode, previous=(), shared_url=False):
    """Explicit test declarations, not a production manifest generator."""
    assets = dict(original)
    businesses, jobs = rows(assets, 'business'), rows(assets, 'job')
    payload = json.loads(assets[contract.JOB_JSON])
    index = len(previous)
    inserted = (date(2026, 11, 5) + timedelta(days=index)).isoformat()
    if mode in ('business', 'combined'):
        business = dict(businesses[-1], company_name=f'TEST ONLY BUSINESS {index}',
                        business_id='biz_' + format(index + 1, '032x'),
                        career_page_url=f'https://append-test.invalid/business/{index}',
                        date_added_to_dataset=inserted)
        businesses.append(business)
        set_csv(assets, 'business', businesses)
        markup = '<tr id="' + business['business_id'] + '">' + ''.join(
            '<td>' + html.escape('Not verified' if key == 'ats_provider' and not value else value) + '</td>'
            for key, value in business.items()) + '</tr>\n'
        page = assets[contract.BUSINESS_HTML].decode().replace('</tbody>', markup + '</tbody>', 1)
        import re
        page = re.sub(r'\d+ of \d+ businesses', f'{len(businesses)} of {len(businesses)} businesses', page)
        assets[contract.BUSINESS_HTML] = page.encode()
    added = []
    if mode != 'business':
        names = ['Velixo', 'Heylist', 'Plotly']
        if mode == 'combined':
            names.append(businesses[-1]['company_name'])
        for number, name in enumerate(names):
            added.append(dict(jobs[0], company_name=name, job_id=f'job_test_{index}_{number}',
                              job_title=f'TEST ONLY ROLE {index}/{number}', date_posted='',
                              job_url='https://append-test.invalid/shared' if shared_url else f'https://append-test.invalid/jobs/{index}/{number}',
                              date_added_to_dataset=inserted))
        jobs.extend(added)
        set_csv(assets, 'job', jobs)
        payload['jobs'] = jobs
    updates = []
    note = ''
    if added:
        counts = Counter(row['company_name'] for row in jobs)
        changed = {row['company_name'] for row in added}
        coverage = payload['coverage']
        end = max([len(coverage)] + [i + 1 for i, row in enumerate(businesses) if row['company_name'] in changed])
        for i, business in enumerate(businesses[:end]):
            name = business['company_name']
            if i >= len(coverage):
                entry = {'company_name': name, 'count': counts[name],
                         'status': 'Test collection' if name in changed else 'Not collected',
                         'notes': 'TEST ONLY source evidence.' if name in changed else 'Not researched in this test; zero saved jobs is not a no-vacancy claim.'}
                coverage.append(entry)
                updates.append(deepcopy(entry))
            elif name in changed:
                entry = dict(coverage[i], count=counts[name], notes=coverage[i]['notes'] + '\nTEST ONLY appended source evidence.')
                coverage[i] = entry
                updates.append(deepcopy(entry))
        note = '\nTEST ONLY append; historical postings were not refreshed.'
        payload['company_count'] = len(coverage)
        payload['coverage_note'] += note
        payload['latest_append'] = {'batch_id': f'test-batch-{index}',
                                    'businesses_added': len(businesses) - len(rows(original, 'business')),
                                    'jobs_added': len(added), 'date_added_to_dataset': inserted,
                                    'timezone': 'America/Toronto'}
        set_payload(assets, payload)
    batch = {'batch_id': f'test-batch-{index}', 'date_added_to_dataset': inserted,
             'collect_jobs': bool(added),
             'business': spec(assets[contract.BUSINESS_CSV], contract.BASELINE['datasets']['business']['fields']),
             'job': spec(assets[contract.JOB_CSV], contract.BASELINE['datasets']['job']['fields']),
             'coverage_updates': updates, 'coverage_note_append': note}
    return assets, list(previous) + [batch]


class AppendOnlyContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Build test inputs from the frozen approved prefix, not whatever later
        # release happens to be live when these regression tests run.
        cls.original = contract.read_site(SITE)
        business_count = contract.BASELINE['datasets']['business']['count']
        job_count = contract.BASELINE['datasets']['job']['count']
        for kind, canonical, alias in [('business', contract.BUSINESS_CSV, contract.BUSINESS_ALIAS),
                                        ('job', contract.JOB_CSV, contract.JOB_ALIAS)]:
            size = contract.BASELINE['datasets'][kind]['csv_bytes']
            cls.original[canonical] = cls.original[alias] = cls.original[canonical][:size]
        saved_jobs = rows(cls.original, 'job')[:job_count]
        archived = {key: saved_jobs if key == 'jobs' else contract.BASELINE['job_metadata'][key]
                    for key in contract.BASELINE['job_payload_keys']}
        set_payload(cls.original, archived)
        import re
        before, rest = cls.original[contract.BUSINESS_HTML].decode().split('<tbody>', 1)
        body, after = rest.split('</tbody>', 1)
        records = re.findall(r'<tr id="biz_[^\"]+">.*?</tr>\n*', body, re.S)
        before = re.sub(r'\d+ of \d+ businesses', f'{business_count} of {business_count} businesses', before)
        cls.original[contract.BUSINESS_HTML] = (before + '<tbody>' + ''.join(records[:business_count]) + '</tbody>' + after).encode()
        for name, expected in contract.BASELINE['site_sha256'].items():
            if contract.sha256(cls.original[name]) != expected:
                raise AssertionError('Archived test input differs from approved bytes: ' + name)

    def test_regression_inputs_stay_anchored_when_the_live_dataset_grows(self):
        future_assets, _ = append_fixture(self.original, 'combined')
        future_case = type('FutureFixture', (type(self),), {})
        with patch.object(contract, 'read_site', return_value=future_assets):
            future_case.setUpClass()
        self.assertEqual(len(rows(future_case.original, 'business')), 256)
        self.assertEqual(len(rows(future_case.original, 'job')), 1396)

    def test_published_snapshot_and_reviewed_history_are_valid(self):
        businesses, jobs, _ = contract.validate_site(SITE)
        self.assertGreaterEqual(len(businesses), 256)
        self.assertGreaterEqual(len(jobs), 1396)

    def test_business_only_append_keeps_every_job_asset_byte_identical(self):
        assets, batches = append_fixture(self.original, 'business')
        contract.validate_assets(assets, batches)
        for name in contract.JOB_DATA:
            self.assertEqual(assets[name], self.original[name])

    def test_appended_business_cells_reject_markup_even_when_text_is_unchanged(self):
        for injection in ('<img src=x onerror=alert(1)>', '<span></span>',
                          '<!-- unreviewed markup -->', '<svg onload=alert(1)></svg>'):
            with self.subTest(injection=injection):
                assets, batches = append_fixture(self.original, 'business')
                contract.validate_assets(assets, batches)
                original = assets[contract.BUSINESS_HTML].decode()
                position = original.rindex('<td>') + len('<td>')
                corrupted = original[:position] + injection + original[position:]
                self.assertEqual(contract.Page(corrupted).rows, contract.Page(original).rows)
                assets[contract.BUSINESS_HTML] = corrupted.encode()
                with self.assertRaisesRegex(AssertionError, 'Unsafe appended business HTML'):
                    contract.validate_assets(assets, batches)

    def test_appended_business_cells_reject_event_attributes(self):
        assets, batches = append_fixture(self.original, 'business')
        original = assets[contract.BUSINESS_HTML].decode()
        position = original.rindex('<td>')
        corrupted = original[:position] + original[position:].replace('<td>', '<td onclick="alert(1)">', 1)
        self.assertEqual(contract.Page(corrupted).rows, contract.Page(original).rows)
        assets[contract.BUSINESS_HTML] = corrupted.encode()
        with self.assertRaisesRegex(AssertionError, 'Unsafe appended business HTML'):
            contract.validate_assets(assets, batches)

    def test_appended_business_cells_allow_escaped_text_and_safe_career_links(self):
        assets, batches = append_fixture(self.original, 'business')
        businesses = rows(assets, 'business')
        business = businesses[-1]
        business['company_description'] = 'TEST ONLY literal <img src=x onerror=alert(1)> & "quoted" text'
        business['career_page_url'] = 'https://append-test.invalid/career?team=R&D'
        set_csv(assets, 'business', businesses)
        batches[-1]['business'] = spec(assets[contract.BUSINESS_CSV], contract.BASELINE['datasets']['business']['fields'])
        original = assets[contract.BUSINESS_HTML].decode()
        start = original.rindex('<tr id="')
        end = original.index('</tr>', start) + len('</tr>')
        for linked in (False, True):
            with self.subTest(linked=linked):
                cells = []
                for key, value in business.items():
                    escaped = html.escape('Not verified' if key == 'ats_provider' and not value else value)
                    if linked and key == 'career_page_url':
                        escaped = f'<a href="{escaped}" target="_blank" rel="noopener noreferrer">{escaped}</a>'
                    cells.append('<td>' + escaped + '</td>')
                markup = '<tr id="' + business['business_id'] + '">' + ''.join(cells) + '</tr>'
                assets[contract.BUSINESS_HTML] = (original[:start] + markup + original[end:]).encode()
                contract.validate_assets(assets, batches)

    def test_appended_business_row_ids_must_match_csv_order_and_be_unique(self):
        assets, batches = append_fixture(self.original, 'business')
        assets, batches = append_fixture(assets, 'business', batches)
        business_ids = [row['business_id'] for row in rows(assets, 'business')]
        original = assets[contract.BUSINESS_HTML].decode()
        for mutation in ('wrong', 'duplicate', 'swapped'):
            with self.subTest(mutation=mutation):
                replacements = {
                    'wrong': ['biz_' + 'f' * 32, business_ids[-1]],
                    'duplicate': [business_ids[0], business_ids[-1]],
                    'swapped': [business_ids[-1], business_ids[-2]],
                }[mutation]
                corrupted = original
                for old, new in zip(business_ids[-2:], replacements):
                    corrupted = corrupted.replace(f'<tr id="{old}">', f'<tr id="pending_{new}">', 1)
                corrupted = corrupted.replace('<tr id="pending_', '<tr id="')
                self.assertEqual(contract.Page(corrupted).rows, contract.Page(original).rows)
                assets[contract.BUSINESS_HTML] = corrupted.encode()
                with self.assertRaisesRegex(AssertionError, 'Business HTML row IDs differ from CSV order'):
                    contract.validate_assets(assets, batches)

    def test_business_html_counter_requires_exact_current_total(self):
        for mode in ('original', 'business'):
            assets, batches = ((dict(self.original), []) if mode == 'original'
                               else append_fixture(self.original, 'business'))
            contract.validate_assets(assets, batches)
            total = len(rows(assets, 'business'))
            expected = f'{total} of {total} businesses'
            tag = '<strong id="count" role="status" aria-live="polite">'
            counter = tag + expected + '</strong>'
            original = assets[contract.BUSINESS_HTML]
            self.assertEqual(original.count(counter.encode()), 1)
            wrong_counters = [
                tag + value + '</strong>' for value in (
                    f'1{total} of {total} businesses',
                    f'{total} of 1{total} businesses',
                    f'{total} of 0 businesses',
                    expected + ' extra', 'extra ' + expected, '',
                )
            ] + ['', counter + counter]
            for wrong in wrong_counters:
                with self.subTest(mode=mode, counter=wrong):
                    assets[contract.BUSINESS_HTML] = original.replace(counter.encode(), wrong.encode(), 1)
                    with self.assertRaisesRegex(AssertionError, '^Business HTML total is stale$'):
                        contract.validate_assets(assets, batches)

    def test_explicit_zero_result_collection_with_fresh_evidence_is_valid(self):
        assets = dict(self.original)
        payload = json.loads(assets[contract.JOB_JSON])
        entry = next(entry for entry in payload['coverage'] if entry['company_name'] == 'Plotly')
        self.assertEqual(entry['count'], 0)
        old_notes = entry['notes']
        evidence = '\nTEST ONLY fresh Plotly collection found zero eligible jobs.'
        entry['notes'] += evidence
        note = '\nTEST ONLY explicit zero-result collection; no rows appended.'
        batch = {
            'batch_id': 'test-zero-result-collection', 'date_added_to_dataset': '2026-11-05',
            'collect_jobs': True,
            'business': spec(assets[contract.BUSINESS_CSV], contract.BASELINE['datasets']['business']['fields']),
            'job': spec(assets[contract.JOB_CSV], contract.BASELINE['datasets']['job']['fields']),
            'coverage_updates': [deepcopy(entry)], 'coverage_note_append': note,
        }
        latest = {
            'batch_id': batch['batch_id'], 'businesses_added': 0, 'jobs_added': 0,
            'date_added_to_dataset': batch['date_added_to_dataset'], 'timezone': 'America/Toronto',
        }
        payload['latest_append'] = latest
        payload['coverage_note'] += note
        set_payload(assets, payload)
        businesses, jobs, validated = contract.validate_assets(assets, [batch])
        self.assertIs(batch['collect_jobs'], True)
        self.assertEqual(businesses, rows(self.original, 'business'))
        self.assertEqual(jobs, rows(self.original, 'job'))
        self.assertEqual(validated['latest_append'], latest)
        checked = next(entry for entry in validated['coverage'] if entry['company_name'] == 'Plotly')
        self.assertEqual(checked['count'], 0)
        self.assertEqual(checked['notes'], old_notes + evidence)
        metadata = {key: value for key, value in validated.items() if key != 'jobs'}
        self.assertEqual(assets[contract.JOB_JSON], contract.json_bytes(validated))
        self.assertEqual(assets[contract.COVERAGE_JSON], contract.json_bytes(metadata))
        for name in (contract.BUSINESS_CSV, contract.BUSINESS_ALIAS, contract.BUSINESS_HTML,
                     contract.JOB_CSV, contract.JOB_ALIAS):
            self.assertEqual(assets[name], self.original[name])

    def test_job_append_including_formerly_zero_result_company_is_valid(self):
        assets, batches = append_fixture(self.original, 'job')
        _, jobs, payload = contract.validate_assets(assets, batches)
        self.assertEqual(len(jobs), len(rows(self.original, 'job')) + 3)
        self.assertEqual(next(entry['count'] for entry in payload['coverage'] if entry['company_name'] == 'Plotly'), 1)

    def test_combined_append_has_ordered_coverage_and_explicit_uncollected_employers(self):
        assets, batches = append_fixture(self.original, 'combined')
        businesses, _, payload = contract.validate_assets(assets, batches)
        self.assertEqual(payload['company_count'], len(businesses))
        self.assertTrue(all(entry['status'] == 'Not collected' for entry in payload['coverage'][196:-1]))

    def test_multiple_later_batches_do_not_freeze_the_next_release(self):
        assets, batches = self.original, []
        for mode in ('job', 'business', 'combined', 'business'):
            assets, batches = append_fixture(assets, mode, batches)
            contract.validate_assets(assets, batches)

    def test_distinct_roles_may_share_a_job_url(self):
        assets, batches = append_fixture(self.original, 'job', shared_url=True)
        contract.validate_assets(assets, batches)

    def test_all_original_python_tests_accept_each_append_mode(self):
        # Exercise the real historical and publication gates, not replacement mocks.
        import importlib
        # Freeze the original suite's membership too: a later release-specific
        # test must run against its live cohort, not this synthetic old snapshot.
        original_modules = (
            'test_agency_business_append', 'test_agency_job_append',
            'test_business_agencies_20261103', 'test_business_append_20261103',
            'test_business_mixed_20261103', 'test_expansion_contract',
            'test_five_business_append', 'test_job_id_contract', 'test_publication',
            'test_tech_five_append', 'test_ten_business_append', 'test_ui_contract',
        )
        modules = [importlib.import_module(name) for name in original_modules]
        for mode in ('business', 'job', 'combined'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                site = Path(directory) / 'site'
                assets, batches = append_fixture(self.original, mode)
                for name, data in assets.items():
                    destination = site / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(data)
                registry = site.parent / 'tests/fixtures/append-only-batches.json'
                registry.parent.mkdir(parents=True)
                registry.write_bytes(contract.json_bytes({'schema_version': 1, 'batches': batches}))
                with ExitStack() as stack:
                    for module in modules:
                        if hasattr(module, 'SITE'):
                            stack.enter_context(patch.object(module, 'SITE', site))
                    result = unittest.TestResult()
                    unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromModule(module) for module in modules).run(result)
                self.assertEqual(result.errors, [], 'Original gates must not error')
                self.assertEqual([case.id() for case, _ in result.failures], [], 'A valid append must pass all original gates')

    def test_historical_csv_mutation_deletion_order_id_and_format_are_rejected(self):
        for kind in ('business', 'job'):
            for mutation in ('value', 'identifier', 'delete', 'order', 'newlines', 'quoting'):
                with self.subTest(kind=kind, mutation=mutation):
                    assets = dict(self.original)
                    records = rows(assets, kind)
                    if mutation == 'value':
                        records[-1]['company_description' if kind == 'business' else 'job_summary'] += ' changed'
                    elif mutation == 'identifier':
                        records[-1]['business_id' if kind == 'business' else 'job_id'] += '_changed'
                    elif mutation == 'delete':
                        records.pop()
                    elif mutation == 'order':
                        records[-2:] = reversed(records[-2:])
                    set_csv(assets, kind, records, csv.QUOTE_ALL if mutation == 'quoting' else csv.QUOTE_MINIMAL)
                    if mutation == 'newlines':
                        canonical, alias = ((contract.BUSINESS_CSV, contract.BUSINESS_ALIAS) if kind == 'business' else (contract.JOB_CSV, contract.JOB_ALIAS))
                        assets[canonical] = assets[alias] = assets[canonical].replace(b'\r\n', b'\n')
                    with self.assertRaises(AssertionError):
                        contract.validate_assets(assets)

    def test_alias_json_html_and_static_asset_drift_are_rejected(self):
        for name in (contract.BUSINESS_ALIAS, contract.JOB_ALIAS, contract.JOB_JSON,
                     contract.COVERAGE_JSON, contract.BUSINESS_HTML, 'Job-Listings/app.js'):
            with self.subTest(asset=name):
                assets = dict(self.original)
                assets[name] += b' '
                with self.assertRaises(AssertionError):
                    contract.validate_assets(assets)

    def test_live_historical_json_edit_is_rejected_with_archive_untouched(self):
        assets = dict(self.original)
        payload = json.loads(assets[contract.JOB_JSON])
        payload['jobs'][-1]['salary'] += ' changed'
        set_payload(assets, payload)
        with self.assertRaises(AssertionError):
            contract.validate_assets(assets)

    def test_csv_duplicate_headers_and_missing_extra_cells_are_rejected(self):
        for mutation in ('duplicate-header', 'missing-cell', 'extra-cell'):
            with self.subTest(mutation=mutation):
                assets = dict(self.original)
                data = assets[contract.BUSINESS_CSV].decode()
                if mutation == 'duplicate-header':
                    data = data.replace('business_id,company_name', 'business_id,business_id', 1)
                else:
                    records = list(csv.reader(io.StringIO(data, newline='')))
                    if mutation == 'missing-cell':
                        records[-1].pop()
                    else:
                        records[-1].append('extra')
                    stream = io.StringIO(newline='')
                    csv.writer(stream, lineterminator='\r\n').writerows(records)
                    data = stream.getvalue()
                assets[contract.BUSINESS_CSV] = assets[contract.BUSINESS_ALIAS] = data.encode()
                with self.assertRaises(AssertionError):
                    contract.validate_assets(assets)

    def test_duplicate_and_invalid_new_job_ids_are_rejected_even_if_declared(self):
        for invalid in ('duplicate', 'job_', 'custom-source-id'):
            with self.subTest(identifier=invalid):
                assets, batches = append_fixture(self.original, 'job')
                records = rows(assets, 'job')
                records[-1]['job_id'] = records[0]['job_id'] if invalid == 'duplicate' else invalid
                set_csv(assets, 'job', records)
                payload = json.loads(assets[contract.JOB_JSON])
                payload['jobs'] = records
                set_payload(assets, payload)
                batches[-1]['job'] = spec(assets[contract.JOB_CSV], contract.BASELINE['datasets']['job']['fields'])
                with self.assertRaises(AssertionError):
                    contract.validate_assets(assets, batches)

    def test_coverage_duplicates_order_counts_types_and_unknown_companies_are_rejected(self):
        for mutation in ('duplicate', 'order', 'count', 'bool-count', 'bool-company-count', 'missing', 'unknown'):
            with self.subTest(mutation=mutation):
                assets = dict(self.original)
                payload = json.loads(assets[contract.JOB_JSON])
                coverage = payload['coverage']
                if mutation == 'duplicate':
                    coverage[-1] = deepcopy(coverage[-2])
                elif mutation == 'order':
                    coverage[-2:] = reversed(coverage[-2:])
                elif mutation == 'count':
                    coverage[-1]['count'] += 1
                elif mutation == 'bool-count':
                    coverage[-1]['count'] = True  # True == 1 must not pass.
                elif mutation == 'bool-company-count':
                    payload['company_count'] = True
                elif mutation == 'missing':
                    coverage.pop()
                    payload['company_count'] -= 1
                else:
                    payload['jobs'][-1]['company_name'] = 'UNKNOWN TEST COMPANY'
                set_payload(assets, payload)
                with self.assertRaises(AssertionError):
                    contract.validate_assets(assets)

    def test_historical_notes_and_selection_rules_cannot_be_masked_by_archive_projection(self):
        for mutation in ('selection', 'notes', 'coverage-note', 'old-timestamp', 'latest-append'):
            with self.subTest(mutation=mutation):
                assets = dict(self.original)
                payload = json.loads(assets[contract.JOB_JSON])
                if mutation == 'selection':
                    payload['selection_rules']['max_known_age_days'] += 1
                elif mutation == 'notes':
                    payload['coverage'][0]['notes'] = ''
                elif mutation == 'coverage-note':
                    payload['coverage_note'] = ''
                elif mutation == 'old-timestamp':
                    payload['collected_at'] = 'changed'
                else:
                    payload['latest_append']['jobs_added'] += 1
                set_payload(assets, payload)
                with self.assertRaises(AssertionError):
                    contract.validate_assets(assets)

    def test_existing_employer_updates_require_a_nonblank_new_evidence_suffix(self):
        for suffix in ('', '\n \t'):
            with self.subTest(suffix=suffix):
                assets, batches = append_fixture(self.original, 'job')
                entry = batches[-1]['coverage_updates'][-1]
                old_notes = next(old['notes'] for old in contract.BASELINE['job_metadata']['coverage']
                                 if old['company_name'] == entry['company_name'])
                entry['notes'] = old_notes + suffix
                payload = json.loads(assets[contract.JOB_JSON])
                live = next(old for old in payload['coverage'] if old['company_name'] == entry['company_name'])
                live['notes'] = entry['notes']
                set_payload(assets, payload)
                with self.assertRaisesRegex(AssertionError, 'New source evidence is required'):
                    contract.validate_assets(assets, batches)

    def test_declared_metadata_updates_cannot_erase_historical_notes_or_lie_about_counts(self):
        for mutation in ('notes', 'count', 'scope', 'unrecorded'):
            with self.subTest(mutation=mutation):
                assets, batches = append_fixture(self.original, 'job')
                entry = batches[-1]['coverage_updates'][0]
                if mutation == 'notes':
                    entry['notes'] = 'TEST ONLY replaced old evidence'
                elif mutation == 'count':
                    entry['count'] += 1
                elif mutation == 'scope':
                    batches[-1]['collect_jobs'] = False
                else:
                    batches = []
                if mutation in ('notes', 'count'):
                    # Keep journal and both live JSON files synchronized: failure
                    # must prove the notes/count rule, not metadata disagreement.
                    payload = json.loads(assets[contract.JOB_JSON])
                    index = next(i for i, live in enumerate(payload['coverage'])
                                 if live['company_name'] == entry['company_name'])
                    payload['coverage'][index] = deepcopy(entry)
                    set_payload(assets, payload)
                reason = {'notes': 'Historical source notes were erased',
                          'count': 'Coverage count differs from all current jobs',
                          'scope': 'Business-only batch changes job collection',
                          'unrecorded': 'Unrecorded append'}[mutation]
                with self.assertRaisesRegex(AssertionError, reason):
                    contract.validate_assets(assets, batches)

    def test_later_batches_cannot_mutate_an_earlier_approved_append(self):
        assets, batches = append_fixture(self.original, 'job')
        assets, batches = append_fixture(assets, 'business', batches)
        records = rows(assets, 'job')
        records[-1]['salary'] += ' changed'
        set_csv(assets, 'job', records)
        payload = json.loads(assets[contract.JOB_JSON])
        payload['jobs'] = records
        set_payload(assets, payload)
        batches[-1]['job'] = spec(assets[contract.JOB_CSV], contract.BASELINE['datasets']['job']['fields'])
        with self.assertRaises(AssertionError):
            contract.validate_assets(assets, batches)

    def test_corrupt_archived_metadata_fails_the_original_whole_file_hashes(self):
        baseline = deepcopy(contract.BASELINE)
        baseline['job_metadata']['coverage'][0]['notes'] += ' altered archive'
        historical = contract.json_bytes(baseline['job_metadata'])
        self.assertNotEqual(contract.sha256(historical), baseline['site_sha256'][contract.COVERAGE_JSON])
        payload = json.loads(self.original[contract.JOB_JSON])
        payload['coverage'] = baseline['job_metadata']['coverage']
        self.assertNotEqual(contract.sha256(contract.json_bytes(payload)), baseline['site_sha256'][contract.JOB_JSON])
        with self.assertRaises(AssertionError):
            contract.validate_assets(self.original, baseline=baseline)


if __name__ == '__main__':
    unittest.main()
