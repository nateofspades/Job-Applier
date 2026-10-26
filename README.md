# Business Listings and Job Listings

Public, read-only employer and job-posting research, hosted on GitHub Pages.

- [Business Listings](https://nateofspades.github.io/Job-Applier/Business-Listings/)
- [Job Listings](https://nateofspades.github.io/Job-Applier/Job-Listings/)
- [Homepage](https://nateofspades.github.io/Job-Applier/)

## Published content

Only `site/` is deployed. This repository starts with the public versions of the existing listings: 133 businesses and 1,277 saved job advertisements. The migration preserves all dataset bytes, IDs, row order, fields, and posting text. The HTML differs only in its directory-relative base URL; there is also a new homepage linking the two listings.

These are dated research snapshots, not a live feed or an assertion that every vacancy is still open. Verify details on the employer's official website. Employer advertisements remain third-party content; no blanket software or data license is granted over them.

This is a fresh public repository, not a fork or copy of the private project's Git history. CVs, applicant fact banks, credentials, private research, collection archives and server backups do not belong here.

## Future updates

1. Prepare a feature branch with the requested, source-verified changes.
2. Preserve existing IDs and unrelated records, and reconcile jobs with their businesses.
3. Update all affected published representations together:
   - Business CSV: `site/Business-Listings/Business_Listings.csv`.
   - Identical business compatibility download: `Business_Spreadsheet.csv`.
   - Business table rows, headers and counts in `site/Business-Listings/index.html`.
   - Job CSV: `site/Job-Listings/Job_Listings.csv`.
   - Identical job compatibility download: `Job_Filters.csv`.
   - Matching job rows in `site/Job-Listings/jobs.json`.
   - Relevant source coverage metadata and notes when coverage changes.
4. Run the data and browser checks. Open a pull request for review.
5. After the owner's publication approval, merge into `main`. GitHub Actions runs the checks again and publishes only if they pass.
6. Check the actual published pages, filters and CSV downloads.

No scheduled collection or automatic refresh of employer postings is enabled. The existing server pages are separate copies and are not updated by this repository's deployment.

## Local verification

Requires Python 3, Node.js 22, and npm.

```sh
npm ci
npm test
npx playwright install chromium
python3 -m http.server 18766 --bind 127.0.0.1 --directory site
```

In a separate terminal:

```sh
PREVIEW_ORIGIN=http://127.0.0.1:18766 npm run test:browser
```

The workflow also exercises the `/Job-Applier/` project prefix before publication. To verify the deployed site:

```sh
PREVIEW_ORIGIN=https://nateofspades.github.io/Job-Applier npm run test:browser
```

The offline checks verify CSV/JSON agreement, unique IDs, valid business links, matching business HTML, compatibility downloads, and the exact public asset allowlist. Browser checks exercise real rows, filters, CSV downloads, saved advertisements, draggable/sticky headers, horizontal scrolling, mobile layout and console errors.

Keep directory names and link capitalization exact: `Business-Listings` and `Job-Listings`. Keep `<base href="./">` in each page and use trailing-slash page URLs so assets resolve beneath the repository prefix. No domain or server access is required to deploy future approved updates.
