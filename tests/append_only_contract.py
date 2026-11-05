"""Offline, append-only publication contracts; no network or Git history required.

append-only-baseline.json is immutable. A future reviewed release appends an entry
in append-only-batches.json instead of changing this baseline or existing fixtures.
Each entry pins both resulting CSV prefixes/ordered rows and explicitly declares
collection scope, coverage updates, and appended source notes. Thus a directory-
only release cannot silently collect jobs, and latest_append is checked against
its actual batch rather than mistaken for the complete dataset's totals.
"""
from collections import Counter
from copy import deepcopy
import csv
from datetime import date
import hashlib
import html
import io
import json
from pathlib import Path
import re

from test_publication import Page

FIXTURES = Path(__file__).resolve().parent / 'fixtures'
BASELINE = json.loads((FIXTURES / 'append-only-baseline.json').read_text())
BUSINESS_CSV = 'Business-Listings/Business_Listings.csv'
BUSINESS_ALIAS = 'Business-Listings/Business_Spreadsheet.csv'
BUSINESS_HTML = 'Business-Listings/index.html'
JOB_CSV = 'Job-Listings/Job_Listings.csv'
JOB_ALIAS = 'Job-Listings/Job_Filters.csv'
JOB_JSON = 'Job-Listings/jobs.json'
COVERAGE_JSON = 'Job-Listings/coverage.json'
JOB_DATA = {JOB_CSV, JOB_ALIAS, JOB_JSON, COVERAGE_JSON}
MUTABLE = JOB_DATA | {BUSINESS_CSV, BUSINESS_ALIAS, BUSINESS_HTML}
LEVELS = ['internship', 'entry-level / junior', 'mid-level / intermediate', 'senior',
          'lead', 'staff', 'principal', 'manager', 'director', 'executive']


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def rows_digest(rows):
    return sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False,
                             separators=(',', ':')).encode())


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'Duplicate JSON key: {key}')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs)


def csv_rows(data, fields):
    records = list(csv.reader(io.StringIO(data.decode('utf-8'), newline=''), strict=True))
    require(bool(records) and records[0] == fields, 'CSV header/schema changed')
    require(all(len(row) == len(fields) for row in records[1:]), 'CSV row width changed')
    return [dict(zip(fields, row)) for row in records[1:]]


def check_prefix(data, rows, spec, fields, label):
    require(type(spec['count']) is int and spec['count'] >= 0, label + ': invalid count')
    require(type(spec['csv_bytes']) is int and spec['csv_bytes'] > 0, label + ': invalid byte boundary')
    prefix = data[:spec['csv_bytes']]
    require(len(prefix) == spec['csv_bytes'] and prefix.endswith(b'\r\n'), label + ': truncated prefix')
    require(sha256(prefix) == spec['csv_sha256'], label + ': historical CSV bytes changed')
    require(len(rows) >= spec['count'], label + ': historical records deleted')
    historical = rows[:spec['count']]
    require(rows_digest(historical) == spec['rows_sha256'], label + ': historical records changed')
    require(csv_rows(prefix, fields) == historical, label + ': byte/record boundary mismatch')


def check_coverage(metadata, businesses, jobs):
    coverage = metadata['coverage']
    count = metadata['company_count']
    require(type(count) is int and 0 <= count <= len(businesses), 'Invalid company_count')
    require(isinstance(coverage, list) and len(coverage) == count, 'Coverage size mismatch')
    names = [entry['company_name'] for entry in coverage]
    require(len(names) == len(set(names)), 'Duplicate coverage company')
    require(names == [row['company_name'] for row in businesses[:count]], 'Coverage is not the directory prefix')
    counts = Counter(row['company_name'] for row in jobs)
    require(set(counts) <= set(names), 'A job company is outside coverage')
    for entry in coverage:
        require(set(entry) == {'company_name', 'count', 'status', 'notes'}, 'Coverage entry schema changed')
        require(type(entry['count']) is int and entry['count'] >= 0, 'Invalid coverage count')
        require(entry['count'] == counts[entry['company_name']], 'Coverage count differs from all current jobs')
        require(isinstance(entry['status'], str) and bool(entry['status'].strip()), 'Missing coverage status')
        require(isinstance(entry['notes'], str), 'Invalid source notes')


def check_new_rows(businesses, jobs, baseline):
    for row in businesses[baseline['datasets']['business']['count']:]:
        require(re.fullmatch(r'biz_[a-f0-9]{32}', row['business_id']) is not None, 'Invalid new business ID')
        require(all(row[key] for key in ('company_name', 'company_description', 'industries')), 'Incomplete business')
        require(row['career_page_url'].startswith(('https://', 'http://')), 'Invalid career URL')
        require(row['ats_provider'] not in ('Unknown', 'WordPress', 'Shopify', 'Custom', 'Employer website'), 'Unverified ATS must be blank')
    for row in jobs[baseline['datasets']['job']['count']:]:
        require(row['country'] == 'Canada', 'New jobs must be Canada-only')
        require(row['company_name'] not in baseline['job_metadata']['selection_rules']['excluded_companies'], 'Excluded employer')
        require(row['job_title'] and row['job_summary'] and len(row['full_job_post']) > 200, 'Incomplete job advertisement')
        require(row['job_url'].startswith(('https://', 'http://')), 'Invalid job URL')
        require(row['is_fulltime'] in ('', 'yes', 'no'), 'Invalid full-time value')
        require(not row['remote_policy'] or set(row['remote_policy'].split('; ')) <= {'remote', 'hybrid', 'in-office'}, 'Invalid remote policy')
        parts = row['job_experience_level'].split('; ') if row['job_experience_level'] else []
        require(set(parts) <= set(LEVELS), 'Invalid experience level')
        require(parts == sorted(set(parts), key=LEVELS.index), 'Experience levels are not ordered/unique')
        if row['date_posted']:
            age = (date.fromisoformat(row['date_added_to_dataset']) - date.fromisoformat(row['date_posted'])).days
            require(0 <= age <= baseline['job_metadata']['selection_rules']['max_known_age_days'], 'Known posting age is ineligible')


def expected_metadata(businesses, jobs, batches, baseline, assets):
    """Replay reviewed batch declarations, never silently overlay live metadata."""
    metadata = deepcopy(baseline['job_metadata'])
    previous = baseline['datasets']
    ids = set()
    for batch in batches:
        require(set(batch) == {'batch_id', 'date_added_to_dataset', 'collect_jobs', 'business', 'job',
                               'coverage_updates', 'coverage_note_append'}, 'Append batch schema changed')
        batch_id = batch['batch_id']
        require(isinstance(batch_id, str) and batch_id.strip() and batch_id not in ids, 'Invalid/duplicate batch ID')
        ids.add(batch_id)
        inserted = batch['date_added_to_dataset']
        require(date.fromisoformat(inserted).isoformat() == inserted, 'Invalid insertion date')
        require(type(batch['collect_jobs']) is bool, 'Collection scope must be explicit')
        deltas = {}
        for kind, rows, path in [('business', businesses, BUSINESS_CSV), ('job', jobs, JOB_CSV)]:
            spec = batch[kind]
            require(set(spec) == {'count', 'csv_bytes', 'csv_sha256', 'rows_sha256'}, 'Batch prefix schema changed')
            check_prefix(assets[path], rows, spec, baseline['datasets'][kind]['fields'], kind)
            start, end = previous[kind]['count'], spec['count']
            require(end >= start, 'A batch deletes historical records')
            require(all(row['date_added_to_dataset'] == inserted for row in rows[start:end]), 'Batch insertion dates differ')
            deltas[kind] = end - start
        require(any(deltas.values()) or batch['collect_jobs'], 'Empty append batch')
        updates = batch['coverage_updates']
        note = batch['coverage_note_append']
        require(isinstance(updates, list) and isinstance(note, str), 'Invalid coverage update declaration')
        if not batch['collect_jobs']:
            require(deltas['job'] == 0 and not updates and not note, 'Business-only batch changes job collection')
        else:
            coverage = metadata['coverage']
            seen = set()
            for entry in updates:
                require(set(entry) == {'company_name', 'count', 'status', 'notes'}, 'Coverage update schema changed')
                name = entry['company_name']
                require(name not in seen, 'Duplicate coverage update')
                seen.add(name)
                require(isinstance(entry['notes'], str) and entry['notes'].strip(), 'New source evidence is required')
                existing = next((index for index, old in enumerate(coverage) if old['company_name'] == name), None)
                if existing is None:
                    coverage.append(deepcopy(entry))
                else:
                    old_notes = coverage[existing]['notes']
                    require(entry['notes'].startswith(old_notes), 'Historical source notes were erased')
                    require(entry['notes'][len(old_notes):].strip(), 'New source evidence is required')
                    coverage[existing] = deepcopy(entry)
            metadata['company_count'] = len(coverage)
            metadata['coverage_note'] += note
            metadata['latest_append'] = {
                'batch_id': batch_id, 'businesses_added': deltas['business'], 'jobs_added': deltas['job'],
                'date_added_to_dataset': inserted, 'timezone': 'America/Toronto',
            }
        check_coverage(metadata, businesses[:batch['business']['count']], jobs[:batch['job']['count']])
        previous = {'business': batch['business'], 'job': batch['job']}
    require(len(businesses) == previous['business']['count'] and len(jobs) == previous['job']['count'],
            'Unrecorded append: add a reviewed append-only-batches.json declaration')
    # Byte boundaries cover the whole current CSV, not just parsable rows.
    require(len(assets[BUSINESS_CSV]) == previous['business']['csv_bytes'], 'Business CSV has undeclared trailing bytes')
    require(len(assets[JOB_CSV]) == previous['job']['csv_bytes'], 'Job CSV has undeclared trailing bytes')
    return metadata


def validate_assets(assets, batches=(), baseline=BASELINE):
    """Validate live bytes and declared append history; return parsed records."""
    require(set(assets) == set(baseline['site_sha256']), 'Public asset allowlist changed')
    for name, expected in baseline['site_sha256'].items():
        if name not in MUTABLE:
            require(sha256(assets[name]) == expected, f'Static frontend changed: {name}')
    require(assets[BUSINESS_CSV] == assets[BUSINESS_ALIAS], 'Business CSV alias differs')
    require(assets[JOB_CSV] == assets[JOB_ALIAS], 'Job CSV alias differs')
    businesses = csv_rows(assets[BUSINESS_CSV], baseline['datasets']['business']['fields'])
    jobs = csv_rows(assets[JOB_CSV], baseline['datasets']['job']['fields'])
    for kind, path, rows in [('business', BUSINESS_CSV, businesses), ('job', JOB_CSV, jobs)]:
        check_prefix(assets[path], rows, baseline['datasets'][kind], baseline['datasets'][kind]['fields'], kind)
    for key in ('business_id', 'company_name', 'career_page_url'):
        require(all(row[key] for row in businesses) and len({row[key] for row in businesses}) == len(businesses), 'Duplicate/empty business ' + key)
    require(len({row['job_id'] for row in jobs}) == len(jobs), 'Duplicate job ID')
    require(all(row['job_id'].startswith('job_') and len(row['job_id']) > 4 for row in jobs), 'Invalid job ID prefix')
    require(len({(row['company_name'], row['job_url'], row['job_title']) for row in jobs}) == len(jobs), 'Duplicate exact job advertisement')
    require({row['company_name'] for row in jobs} <= {row['company_name'] for row in businesses}, 'Unknown job company')
    payload = strict_json(assets[JOB_JSON])
    metadata = strict_json(assets[COVERAGE_JSON])
    require(list(payload) == baseline['job_payload_keys'], 'Job payload schema/order changed')
    require(payload['jobs'] == jobs, 'Job CSV/JSON values or ordering differ')
    require(metadata == {key: value for key, value in payload.items() if key != 'jobs'}, 'Coverage/JSON metadata differ')
    require(rows_digest(payload['jobs'][:baseline['datasets']['job']['count']]) == baseline['datasets']['job']['rows_sha256'], 'Historical JSON records changed')
    check_new_rows(businesses, jobs, baseline)
    check_coverage(metadata, businesses, jobs)
    expected = expected_metadata(businesses, jobs, batches, baseline, assets)
    # Canonical JSON preserves baseline bytes for every directory-only batch.
    require(assets[COVERAGE_JSON] == json_bytes(expected), 'Live metadata differs from reviewed append history')
    expected_payload = {key: jobs if key == 'jobs' else expected[key] for key in baseline['job_payload_keys']}
    require(assets[JOB_JSON] == json_bytes(expected_payload), 'Live job JSON differs from reviewed append history')
    text = assets[BUSINESS_HTML].decode()
    before, body_end = text.split('<tbody>', 1)
    body, after = body_end.split('</tbody>', 1)
    html_rows = re.findall(r'<tr id="biz_[^"]+">.*?</tr>\n*', body, re.S)
    require(''.join(html_rows) == body and len(html_rows) == len(businesses), 'Business HTML row structure differs')
    html_ids = [re.findall(r'^<tr id="([^"]+)">', row)[0] for row in html_rows]
    require(html_ids == [row['business_id'] for row in businesses], 'Business HTML row IDs differ from CSV order')
    counters = re.findall(r'<strong id="count" role="status" aria-live="polite">(.*?)</strong>', before, re.S)
    require(counters == [f'{len(businesses)} of {len(businesses)} businesses'], 'Business HTML total is stale')
    count = baseline['datasets']['business']['count']
    historical_header = re.sub(r'\d+ of \d+ businesses', f'{count} of {count} businesses', before)
    projected = (historical_header + '<tbody>' + ''.join(html_rows[:count]) + '</tbody>' + after).encode()
    require(sha256(projected) == baseline['site_sha256'][BUSINESS_HTML], 'Historical business HTML changed')
    expected_cells = [[('Not verified' if key == 'ats_provider' and not value else value) for key, value in row.items()] for row in businesses]
    # Historical markup is byte-pinned above. New cells are escaped text only,
    # with the existing exact safe career-link rendering optionally retained.
    for markup, business, cells in zip(html_rows[count:], businesses[count:], expected_cells[count:]):
        escaped = [html.escape(value) for value in cells]
        plain = ''.join('<td>' + value + '</td>' for value in escaped)
        url = html.escape(business['career_page_url'])
        link = f'<a href="{url}" target="_blank" rel="noopener noreferrer">{url}</a>'
        linked = ''.join('<td>' + (link if key == 'career_page_url' else value) + '</td>'
                         for key, value in zip(business, escaped))
        require(markup.split('>', 1)[1].rstrip('\n') in (plain + '</tr>', linked + '</tr>'),
                'Unsafe appended business HTML')
    require(Page(text).rows == expected_cells, 'Business HTML/CSV cells differ')
    return businesses, jobs, payload


def read_site(site):
    paths = list(site.rglob('*'))
    require(not any(path.is_symlink() for path in paths), 'Public assets must not be symlinks')
    return {path.relative_to(site).as_posix(): path.read_bytes() for path in paths if path.is_file()}


def read_batches(site):
    registry = strict_json((site.parent / 'tests/fixtures/append-only-batches.json').read_bytes())
    require(set(registry) == {'schema_version', 'batches'} and type(registry['schema_version']) is int
            and registry['schema_version'] == 1 and isinstance(registry['batches'], list), 'Invalid append registry')
    return registry['batches']


def validate_site(site):
    return validate_assets(read_site(site), read_batches(site))


def historical_job_assets(site):
    """Original four asset hashes remain checked; live validation is independent."""
    assets = read_site(site)
    _, jobs, _ = validate_assets(assets, read_batches(site))
    count = BASELINE['datasets']['job']['count']
    archived = {key: jobs[:count] if key == 'jobs' else BASELINE['job_metadata'][key]
                for key in BASELINE['job_payload_keys']}
    size = BASELINE['datasets']['job']['csv_bytes']
    return {JOB_CSV: assets[JOB_CSV][:size], JOB_ALIAS: assets[JOB_ALIAS][:size],
            JOB_JSON: json_bytes(archived), COVERAGE_JSON: json_bytes(BASELINE['job_metadata'])}
