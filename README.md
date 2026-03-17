# FCC Lookup

FCC Lookup is a lightweight address-enrichment app for reviewing broadband availability against FCC National Broadband Map data.

## What it does

- Upload `.csv`, `.xlsx`, or `.xls`
- Paste raw rows directly into the app
- Standardize incomplete or inconsistent addresses with the Census geocoder
- Check FCC fixed and mobile broadband availability
- Show carrier-level mobile detail
- Flag records for manual review instead of blocking the batch
- Export summary and detail CSV files
- Compare the app's local FCC snapshot to the latest FCC published filing

## Local development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173` and proxies API requests to the local server at `http://localhost:8787`.

## Refresh the local FCC snapshot

```bash
npm run cache:refresh
```

That command currently stores:

- the latest FCC download manifest
- the latest FCC provider-list ZIP
- refreshed snapshot metadata in `data/fcc-cache-metadata.json`

## Verification

```bash
npm run lint
npm run build
```

## Current limitation

The FCC fixed provider-detail endpoint still returns `403` for normal server-side requests, so fixed results currently fall back to manual-review notes when that endpoint is blocked. Mobile coverage detail continues to work.
