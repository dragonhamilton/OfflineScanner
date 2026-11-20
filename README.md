# OfflineScanner

Photograph a bookshelf, cut the photo into spines, read each spine with local
OCR, review the results and keep the library in PostgreSQL. Everything runs on
one machine with no internet.

## What is stored

Only what the photo shows. For each spine:

| Field | Source |
|---|---|
| title, author, publisher | guessed from OCR line sizes and positions, then corrected by hand |
| raw OCR text + confidence | the OCR engine |
| spine image | cropped from the photo |
| position, width, height, color | measured from the photo |
| status | `unreviewed` → `confirmed` or `skipped` |
| notes | typed by hand |


## Layout

```
apps/server     Fastify API, image processing (sharp), OCR, Postgres access
apps/web        React + Vite client
packages/shared types used by both
db/migrations   SQL, applied automatically when the server starts
tools/rapidocr  optional Python OCR worker (uv)
e2e             Playwright tests
scripts/doctor.sh  environment check
```

## Install on a Mac (with internet)

```bash
bash scripts/setup-mac.sh
```

Installs pnpm and PostgreSQL 16 with Homebrew (plus Node 22 if yours is older
than 22.21), starts Postgres, creates the `scanner` role and both databases,
writes `.env`, installs packages without writing a lockfile, and downloads
Playwright's Chromium. Add `--with-rapidocr` for uv + Python 3.12, or
`--skip-browser` to test with your installed Chrome
(`PLAYWRIGHT_CHANNEL=chrome pnpm e2e`). Safe to rerun.

## Install (offline machine)

Packages come only from the internal npm/PyPI mirrors, which lack most
releases younger than about two weeks. The repo is set up for that:

- `pnpm-workspace.yaml` sets `minimumReleaseAge` to 21 days, so pnpm never
  picks a release the mirror is unlikely to have.
- Every dependency installs entirely from npm. sharp's libvips and the
  Tesseract English model both arrive as npm packages; nothing compiles or
  downloads at install time.
- **No lockfile is committed yet.** Build it on the offline machine, against
  its mirror, and commit it:

```bash
pnpm install
```

```bash
git add pnpm-lock.yaml && git commit -m "Add lockfile resolved against the internal mirror"
```

After that, install with `pnpm install --frozen-lockfile`. If the mirror ever
lacks a locked version, delete that package's entries from the lockfile, run
`pnpm install` to resolve an older one, and commit the result.

Then check the machine:

```bash
pnpm doctor
```

## Database setup

PostgreSQL 16 is installed but not running.

```bash
sudo pg_ctlcluster 16 main start
```

```bash
sudo -u postgres psql -c "CREATE ROLE scanner LOGIN PASSWORD 'scanner'" -c "CREATE DATABASE offline_scanner OWNER scanner" -c "CREATE DATABASE offline_scanner_e2e OWNER scanner"
```

```bash
cp .env.example .env
```

Tables are created when the server starts (or with `pnpm db:migrate`).

## Run

```bash
pnpm dev
```

Opens the API on :3000 and Vite on http://127.0.0.1:5173.
For a single process serving the built client on :3000:

```bash
pnpm build && pnpm start
```

The camera button only works on `localhost`/`127.0.0.1` or over HTTPS
(a browser rule). Uploading a photo always works.

## Scanning flow

1. Upload or capture a shelf photo.
2. The app estimates the number of books from the dark gaps between spines.
   Correct the number if it's off.
3. It slices the photo and reads every spine (each spine is tried rotated
   both ways, plus upright, and the best reading is kept).
4. Review each spine: fix title/author/publisher, then **Confirm** or **Skip**.
   **Read again** re-runs OCR; clicking the spine image lets you recrop it.
5. **Library** lists every book and exports CSV, JSON or a ZIP with images.

## OCR engines

`OCR_ENGINE=tesseract` (default) uses tesseract.js with the model from
`@tesseract.js-data/eng`. Nothing else to install.

`OCR_ENGINE=rapidocr` starts `tools/rapidocr/ocr_server.py` with uv. It uses
`rapidocr-onnxruntime` 1.3/1.4, which bundles its models in the wheel (the
newer `rapidocr` package downloads models at runtime and won't work here).
It needs Python 3.10–3.12 and uv; the first start creates the venv from the
PyPI mirror.

Both sit behind the same interface (`apps/server/src/ocr`). Compare them on
real shelf photos before settling on one.

## Tests

```bash
pnpm typecheck
```

```bash
pnpm test
```

Unit tests (Vitest) cover spine estimation and slicing on a generated shelf
image, the title/author guessing, CSV export, and that Tesseract reads text
with no network.

```bash
pnpm e2e
```

Playwright runs the whole flow in Chromium against `offline_scanner_e2e`
(override with `E2E_DATABASE_URL`). It uses the Chromium already installed
for Playwright 1.56, so `@playwright/test` is pinned to `~1.56.0`. **Never run
`playwright install`**: browser downloads are blocked. If the browser isn't
found, set `PLAYWRIGHT_BROWSERS_PATH` or `PLAYWRIGHT_CHROMIUM_PATH`.

## Known limits

- The spine slicer ported from the Electron app smooths over about a quarter
  of a spine's width, so narrow gaps can fade and dark print inside a spine
  can be mistaken for a gap. A test marked `it.fails` in
  `apps/server/test/image-processing.test.ts` records this; flip it to `it`
  once the slicer is improved. Recropping in the review screen is the
  workaround.
- OCR on spines is much weaker than Claude was. The review screen is the
  main workflow, not an occasional fix-up.
- No login: run it on localhost, or put it behind authentication before
  exposing it on a network.
