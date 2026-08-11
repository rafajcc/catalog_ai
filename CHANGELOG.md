# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Data validation moved out of CSV upload/parsing into the validation screen. `POST /api/process/csv` now only checks the file format (extension, column count, headers) and returns every row as a product (invalid price/quantity/EAN values are kept raw so they can be flagged), while `POST /api/validate/products/:dataId` validates the merged products of every uploaded CSV with required-field checks, format rules and `ean`/`reference` duplicate checks. Duplicates are now detected across CSV files (both rows sharing the same EAN or reference are flagged with `DUPLICATE_VALUE`), which the old per-file parse-time check missed; the validation table shows the error messages for each flagged product. The upload tab no longer reports rejected rows (the `invalid_rows`/`row_errors` fields were removed from the parse response and the `upload.invalidRowsWarning` i18n keys).
- The `manufacturer` CSV column has been removed (in PrestaShop, "brand" is the user-facing name for the manufacturer entity, so both columns referred to the same thing): the template, format guide, parser, normalizer, validation rules and types now keep only `brand`. The header is now 12 columns (`ean,reference,name,price,wholesale_price,quantity,brand,category,tax,description_short,description,image_hints`).
- The `sku` CSV column has been removed (it was equivalent to `reference`): the template, format guide, parser, normalizer, types, PrestaShop sync payloads and the image matcher no longer reference it.
- `ean` and `reference` are now required CSV columns: rows without a valid EAN (8 or 13 digits), without a reference, or with a reference longer than 64 characters (PrestaShop limit) are flagged during validation on the validation screen instead of being rejected by the parser.
- The PrestaShop connection test now calls the Webservice root (`GET /api`) instead of `GET /api/products?limit=1`, which is the canonical check for connectivity and credentials: it returns the resource list with a valid key and fails with a 401 when the key is invalid, without depending on access to the `products` resource.
- Prices and stock quantities are no longer silently adjusted: `price` and `wholesale_price` cells are rejected when they have more than 2 decimal places (nothing is rounded) and `quantity` cells are rejected when they are not non-negative integers (nothing is truncated). The validation screen flags these rows instead of the upload tab.
- Text field limits matching PrestaShop are now enforced by the product validation rules: `name` max 128, `reference` max 64, `brand` max 64 (from `ps_product_lang.name`, `ps_product.reference` and `ps_manufacturer.name`); `price`/`wholesale_price` max 2 decimals, `quantity` integer, all non-negative. The review panel field metadata (`getFieldValidation`) also exposes the same limits plus `meta_title` 128, `meta_description` 512 and `link_rewrite` 128.
- The CSV format guide in the upload tab now documents the PrestaShop text limits and the strict price/quantity rules (max 2 decimals, integers only, no rounding or truncation).
- `ValidationRule` supports a `decimals` constraint and `number`/`integer` rule types are enforced distinctly (`Number.isInteger` for integers, decimal-place count for numbers).
- CSV parser tests, normalizer tests, validator tests, API route tests and upload tab tests updated/added for the new strict rules.
- The "Synchronization" tab has been replaced by a PrestaShop consistency-validation + upload flow on the validation screen. "Validate products" now also batch-resolves each CSV row's EAN to its PrestaShop combination/product (batched Webservice OR filters, batches of 100), flags rows whose EAN does not exist (`EAN_NOT_FOUND`) and detects product-level fields (`name`, `description`, `description_short`, `brand`, `category`, `tax`) that differ between combinations of the same `id_product` (`PRODUCT_LEVEL_INCONSISTENCY`). The validation table is now editable inline and the inconsistency flags are recomputed in memory as the user edits, so they can fix the values before publishing. "Upload changes" writes every filled-and-changed field back to PrestaShop (product-level fields once per product, combination fields per row, stock via the combination's `stock_available`; empty cells never overwrite and brands/categories are created when missing) and reports how many products, combinations and stock rows were updated plus how many operations failed. It requires PrestaShop to be configured and the consistency check to have run. The old sync panel, sync service, sync endpoints and their tests were removed, and the review completion message no longer references unlocking a sync tab.
- The PrestaShop version field in the configuration form is now a dropdown (`1.7`, `8`, `9`) instead of a free text input.
- The configuration is now persisted to a JSON file instead of only living in memory. `PUT /api/config` writes the file and the backend loads it on startup, so saved settings survive restarts. Sensitive values (the PrestaShop and AI API keys) are encrypted at rest with AES-256-GCM: the encryption key comes from the `CONFIG_SECRET` environment variable, or a random key file (`config.json.key`) is generated next to the config file with `0600` permissions. The file location defaults to `config.json` in the working directory and can be overridden with `CONFIG_FILE`. Both `config.json` and `config.json.key` are gitignored.

### Added
- The PrestaShop fetch filters (`description` and `images`) can now be combined with OR logic: a new "Combine filters" selector in the upload tab lets the user choose between AND (product must satisfy all active criteria) and OR (product satisfies at least one), so for example "sin descripción" OR "sin imágenes" fetches every product missing either.
- New PrestaShop Webservice fetch in the upload tab as an alternative data source to uploading a CSV: `POST /api/fetch/prestashop` downloads products straight from the store by EAN and/or reference (batch `OR` filters), or the first products of the store when no EAN or reference is given, with optional `description`/`images` presence filters, importing the first 50 matching products (one row per combination, with combination-level price/wholesale price/stock and product-level name/descriptions/brand/category/tax; products without combinations are imported as a single product-level row with the product's own price/stock). Fetched data becomes the working dataset, replacing any uploaded CSVs (a confirmation dialog warns about the replacement, and uploading a CSV afterwards discards the fetched data); `DELETE /api/fetch/prestashop` removes it and re-locks the downstream tabs. The dashboard treats the fetched dataset like a CSV upload, so validation, image matching, AI suggestions and review run against it.
- The CSV columns `stock` (a synonym for `quantity`) and `weight` removed from the CSV template, parser, normalizer, validator, AI suggestion context, PrestaShop sync payloads and the format guide: the header is now 14 columns (`ean,reference,name,sku,price,wholesale_price,quantity,brand,manufacturer,category,tax,description_short,description,image_hints`).
- The `tax` CSV column is now the PrestaShop tax rules group ID (`tax_rules_group_id`, as configured in each store) instead of a percentage rate; the parser no longer converts it and the sync payload uses the value directly as the tax group ID.
- Empty `price`, `wholesale_price` and `quantity` cells no longer overwrite existing store values: `syncSingleProduct` only includes those fields in the update payload when they are provided.
- The CSV format guide intro now states that any field containing a comma must be wrapped in double quotes (applies to all columns), and the column descriptions mention that empty price/wholesale price/stock keep the existing store values.
- The internal "data id" is no longer shown in the UI: the validation panel now displays the names of the CSV files being validated instead of the id.
- The AI and review tabs no longer unlock as soon as a CSV is processed; they stay disabled until the uploaded data has been validated (after "Validate products" runs successfully) and re-lock when a new CSV is processed.
- The "Load results" button was removed from the validation panel; the panel now loads the last stored validation automatically when it is opened, unless the uploaded files changed since that validation (uploading or deleting a CSV invalidates the stored results so stale data is never shown). Errors while loading the stored results are shown in the panel instead of being silent.
- All uploaded CSVs are merged into a single working dataset: validation, image matching, AI suggestions and review now run against the combined products of every processed CSV (in upload order) instead of only the last one. Re-uploading or deleting a CSV rebuilds the merged dataset and invalidates any stored results, and the dashboard falls back to the first remaining CSV as the dataset handle when the current one is deleted.
- The parsed CSV datasets are now keyed by their file id (the `data_id` returned by `POST /api/process/csv` is the file id), so merged results are consistent with the upload list.
- The validation panel no longer shows the loaded files as a comma-separated line at the top; it now shows a collapsible file list at the bottom of the panel (same look as the upload tab, without delete buttons), so long file lists stay hidden until expanded.

### Fixed
- The default configuration file (`config.json` + `config.json.key`) and the uploads directory are now anchored to the backend package folder instead of the process working directory. Previously the server read/wrote a different `config.json` depending on the directory it was started from, so restarting it from another folder looked like the saved configuration (PrestaShop/AI credentials) had been lost.
- The PrestaShop connection now authenticates with HTTP Basic auth (API key as username, empty password) instead of a `Bearer` token: PrestaShop's webservice only accepts Basic auth or the `ws_key` query parameter, so the connection test and every sync request returned 401 before. The base URL also tolerates a trailing `/api` (e.g. `http://localhost:8081/api`), which is stripped internally since all endpoints are built relative to the store root.

### Added
- `LICENSE` (MIT) and `CHANGELOG.md` files referenced from the README.
- Unit tests for `logger`, `error-handler`, and `ai-text-suggester` (mock provider, no API calls).
- Integration tests for the Express app via supertest (routing, security headers, CORS, rate limiting, error handling).
- Tests for the server entry point (startup, PORT handling, graceful shutdown, error handler setup) using module mocks.
- New npm scripts `test:logger`, `test:error-handler`, `test:ai-suggester`, `test:app`, and `test:index`.
- PrestaShop client tests with a mocked axios instance (interceptors, XML parsing, product/stock/image sync flows).
- Sync service tests using faked collaborators (planning, execution, dry-run, summaries).
- New npm scripts `test:prestashop` and `test:sync-service`.
- Complete React frontend UI built on the scaffolding: typed API layer (`api-service.ts`), shared types, formatting/download utilities, `useApi` hook, and tabbed dashboard with upload, configuration, validation, image matching, AI suggestions, sync and review panels.
- Frontend testing infrastructure (jest + ts-jest + jsdom, RTL, user-event) and tests for services, utilities, hooks, every panel component, and the dashboard flow (96 tests, ~94% coverage).
- New frontend scripts `test:coverage`, plus `tsconfig.json`, `vite.config.ts`, `.eslintrc.json`, and `jest.setup.ts` for the frontend.
- Frontend partial test scripts (`test:app`, `test:dashboard`, `test:layout`, `test:upload`, `test:configuration`, `test:validation`, `test:images`, `test:ai`, `test:sync`, `test:review`, `test:hooks`, `test:services`, `test:utils`) mirroring the backend's per-module test commands.
- Full UI internationalization (Spanish by default, English selectable) via an `I18nProvider`/`useI18n` hook with a language toggle in the header and `localStorage` persistence (`frontend/src/i18n.tsx`).
- README reorganized with separate backend and frontend sections for running the application, running the tests, and code quality checks.
- `GET /api/status` endpoint so the frontend status indicator reports the backend as online.
- Full backend API routes (`backend/src/routes.ts`) wiring the frontend contract to the processing modules: configuration get/update + PrestaShop/AI connection tests, CSV/image/folder uploads, CSV parsing, product validation, image matching, AI text suggestions, dry-run sync sessions, review state/batch/export, downloads (path-traversal guarded), health and logs. State is held in a per-app-instance in-memory store (`backend/src/store.ts`); uploaded files are persisted under `backend/uploads/` (now gitignored).
- `ReviewStateManager.getState()` so routes can serialize the current review state.
- API route integration tests (`test/api-routes.test.ts`, supertest) covering the full upload → parse → validate → match → suggest → sync → review flow plus error cases (18 tests), and a `test:api-routes` npm script.
- Clarified the image-folder input label in both languages ("…already on the server") in the upload panel.
- Backend status recovery via a new `useBackendStatus` hook: the dashboard now polls `GET /api/status` periodically (every 5s while offline, every 30s while online, a 60s heartbeat while the tab is hidden, and never overlapping in-flight requests), so the connection chip recovers to "Online"/"En línea" automatically when the backend comes back.
- Upload validation for product images: only `.jpg` and `.jpeg` files are accepted (backend `assertImageFile` + folder scan, and frontend guards with an `accept=".jpg,.jpeg"` input); the image label now reads "Product images (JPG/JPEG only)" / "Imágenes de producto (solo JPG/JPEG)".
- The "Configuration" view moved out of the tab navigation into a gear button in the top header (next to status and language selector); the tab bar stays visible while configuration is open so any tab can be selected to return to it.
- The validation, images, AI, sync and review tabs are disabled (non-clickable) until a CSV has been uploaded and processed, so downstream steps cannot be reached without data.
- Multiple CSV and image uploads no longer replace each other: the upload panel keeps a running counter next to the "Product catalog (CSV)" and "Product images" labels plus an "Uploaded files" list at the bottom with every file name, persisted while navigating between tabs.
- Duplicate uploads are rejected: uploading the same CSV or image file again shows a clear error in the panel and is also refused by the backend (by filename), and re-selecting an image folder skips files already present.
- Uploaded-file management in the upload panel: the "Uploaded files" list is now backed by `GET /api/uploads` and supports per-file and delete-all removal (`DELETE /api/uploads/csv/:id`, `DELETE /api/uploads/images/:id`, `DELETE /api/uploads/csv/all`, `DELETE /api/uploads/images/all`) with success messages, and the CSV/data tabs re-lock when every CSV has been deleted.
- CSV template download: a "Download template" button in the upload panel fetches `GET /api/template/csv` and saves `catalog_template.csv` (14 ordered columns: `ean,reference,name,sku,price,wholesale_price,quantity,brand,manufacturer,category,tax,description_short,description,image_hints`).
- CSV upload format validation: uploads are rejected when the column count differs from the 14 expected columns or the required headers are missing (`assertCsvFormat` in `backend/src/routes.ts`, with a "Download the template" hint); cell content is deliberately not validated here since data validation happens in the next tab.
- CSV upload success message now shows the uploaded file name (`upload.successUploaded`), and new i18n keys cover template download and deleted CSV/image/all messages in Spanish and English.
- CSV format guide in the upload panel: a "?" button next to the "Product catalog (CSV)" label expands an inline, localized guide describing the 14 expected columns (with required flag, value formats and examples) plus a ready-to-fill example row and a hint pointing to the template download.

### Fixed
- The Images tab was enabled as soon as a CSV was processed even without any uploaded image; it now stays disabled until at least one product image is uploaded (and re-locks if all images are deleted).
- Backend error messages (in English) appeared verbatim in the UI regardless of the selected language: `AppError` now carries a machine-readable `code` that is included in API error responses, and the CSV column-count and missing-columns format errors are translated to the active language (`upload.errorCsvColumnCount`, `upload.errorCsvMissingColumns`).
- A lint error from an empty `CSVParserConfig` interface left in the CSV parser; it is removed and `CSV_TEMPLATE_HEADERS` is exported instead.
- The frontend `api-service.ts` had an invalid Python-style docstring at the top and imported a non-existent `types` module; both are resolved, methods are typed against the shared API contract, and the service is exposed through a lazy singleton.
- Uploading a non-CSV file was accepted silently: `POST /api/upload/csv` now rejects files without a `.csv` extension, empty files, and binary content (NUL-byte sniff), and the frontend upload panel refuses non-`.csv` selections before any request is made.
- A garbage file that passed upload produced a misleading "0 productos": `POST /api/process/csv` now fails with a clear 400 when the file has no recognized product columns, contains no data rows, or yields zero extractable products.
- Server error messages were never shown in the UI: `getErrorMessage` only read the generic axios message. It now surfaces `error.response.data.message` / `error.response.data.error.message` from the API.
- PrestaShop client XML responses were never parsed to objects (`xml2json` returns a JSON string), so `resolveProduct`/`resolveStockAvailable` always returned `null` and `createProduct` read undefined ids. The parsed response is now unwrapped and normalized (single/multiple results, `_attributes`/`_cdata`/`_text` extraction).
- Product image uploads always failed because `formdata-node` rejects raw Buffers; the file buffer is now wrapped in a `Blob`.
- Image uploads used a hardcoded `/tmp/product_<id>_image_<n>.jpg` placeholder path; they now upload the actual file path from the selected image.

## [0.1.0] - 2026-08-05

### Added
- Initial Catalog AI project: Express backend and React frontend scaffolding.
- CSV parsing with encoding detection and field normalization.
- Product validation, normalization, image matching/ranking modules.
- Review state management, audit logging, and sync services.
- Jest test suite for the CSV parser.
- ESLint and TypeScript configuration with zero lint issues.

### Fixed
- CSV parser tests and module imports for a clean backend typecheck.
- `initializeReview` not storing products, leaving edit/filter methods operating on an empty list.
- Audit log in-memory cap (1000 entries) not being applied because `cleanOldLogs` replaced the array reference.
- Flaky CSV parser tests on Windows caused by antivirus locking freshly written temp files.

[Unreleased]: https://github.com/rafajcc/catalog_ai
[0.1.0]: https://github.com/rafajcc/catalog_ai/releases/tag/v0.1.0
