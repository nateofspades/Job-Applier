# Append-only dataset test contracts

The approved snapshot is pinned in `fixtures/append-only-baseline.json`: 256
businesses, 1,396 jobs, original CSV bytes and ordered records, complete original
public job metadata, JSON key order, and all original public-asset hashes. Do not
regenerate this fixture, edit old fixtures, or replace hashes to silence a failure.
The tests do not require Git history, network access, or private source archives.

`append_only_contract.py` validates the live site independently of the archived
snapshot. The two historical business-only release tests still check their
original whole-file hashes against the archived job snapshot, while the live
checks enforce raw CSV prefixes, every historical record, current metadata, and
unchanged static frontend assets. Archived metadata is never accepted as a
substitute for checking live metadata.

## Declaring a future approved append

Dataset/source research, owner approval, and the README's branch/PR/publication
process still apply. These declarations do not authorize a release or prove that
a vacancy is genuine. Continue to use official employer/linked ATS evidence and
the saved eligibility rules. Raw/private evidence must remain outside this repo.

Append one entry to `fixtures/append-only-batches.json` for each reviewed batch;
leave earlier entries unchanged. Its exact fields are:

- `batch_id`: unique nonempty source/release identifier.
- `date_added_to_dataset`: first-insertion date, YYYY-MM-DD, America/Toronto.
- `collect_jobs`: explicit boolean; directory-only appends use false.
- `business` and `job`: each has `count`, `csv_bytes`, `csv_sha256`, and
  `rows_sha256`, describing the entire resulting prefix through that batch.
- `coverage_updates`: ordered list of complete changed/new coverage entries,
  each with `company_name`, `count`, `status`, and `notes`.
- `coverage_note_append`: additional public source/scope explanation, or an
  empty string. Existing coverage-note text is preserved.

The registry intentionally starts empty: no business, job, or collection has
been added by this test-only repair. A future append without a reviewed
registry entry fails closed instead of guessing batch boundaries or accepting
unspecified metadata edits.

Use the existing CSV column order and CRLF record separators. `csv_sha256` hashes
the raw canonical CSV bytes, including its header; `csv_bytes` is their byte
length, not a line count. `rows_sha256` is SHA256 of UTF-8 encoded
`json.dumps(rows, sort_keys=True, ensure_ascii=False, separators=(',', ':'))`.
Counts exclude the CSV header. Both compatibility CSVs must be byte-identical
to their canonical CSV. Job JSON uses the original key order, UTF-8, two-space
indentation, and its final newline. Do not normalize historical CSV quoting or
embedded advertisement newlines.

Business HTML preserves historical row bytes. Each row's `id` must match its
CSV `business_id` in order. Appended rows use bare `<td>` cells containing
`html.escape`-escaped CSV values (`Not verified` for blank ATS), optionally using
the existing exact `<a href="…" target="_blank" rel="noopener noreferrer">…</a>`
rendering for the career URL only. Other markup or attributes are rejected even
when they leave parsed cell text unchanged.

For each declared batch, the validator checks the recorded byte/row prefixes,
monotonic record boundaries, exact insertion dates for new rows, and coverage
against all jobs through that boundary. This also protects earlier approved
appends from mutation during later appends, not just the initial baseline.

## Coverage and metadata

A business-only batch must add no jobs, supply no coverage updates, and append
no coverage note. All Job Listings bytes therefore remain unchanged. It does
not assert that new employers have zero current vacancies.

For an explicitly authorized collection, provide source-reviewed coverage
updates. Original employer notes must remain an exact prefix of updated notes;
append a nonblank new evidence suffix for every existing-employer update rather
than overwriting or reusing old notes (a whitespace-only suffix is not evidence).
Existing statuses may change
only through a declared coverage update. New entries extend the business-order
coverage prefix; they cannot jump directory employers or duplicate names. If a
prefix includes an employer not researched in that collection, say so explicitly
in its status and notes: zero saved jobs is not a verified no-vacancy claim.

The expected `company_count` is the coverage length. Every coverage count must
be a nonnegative integer equal to the full current saved-job count for that
employer, and every job must have a covered business. Booleans are not integers
for these checks. The expected `latest_append` is derived from the particular
collection batch's ID, date, business/job deltas, and America/Toronto timezone;
it is not a cumulative count and is not changed by a later directory-only batch.
Explicit zero-result collection batches are permitted without placeholder jobs.

Live `coverage.json` must equal `jobs.json` without `jobs`. The validator replays
the reviewed updates and compares exact live JSON bytes; undeclared changes to
selection rules, historical capture timestamps, source policies, source notes,
or any other metadata fail. Correcting historical metadata or changing the
schema requires separate owner authorization and a deliberate contract change,
not a routine append declaration.

## Verification

From the repository root, activate `.git/jobapplier-env` and run `npm test`, then
the README's full browser procedure. Also run the browser checks under the
`/Job-Applier/` project prefix. Keep browser workloads sequential on the 2 GB
server and stop only your own preview server afterward.

`test_append_only_contract.py` keeps synthetic examples in memory or temporary
sites. It tests directory-only, job-only, combined and successive appends; original
historical tests run against each append mode. Negative checks cover historical
value/ID edits, deletion, reordering, quoting/newline changes, alias drift,
CSV/JSON/HTML mismatch, schema/row-width errors, duplicate IDs, invalid coverage,
source-note loss, and undeclared metadata changes. Fixture inputs are anchored
to the frozen snapshot so later real appends cannot create another test freeze.
