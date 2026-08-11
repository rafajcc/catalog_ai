# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- "Ver" button next to "Clear imported data" that opens a grid of the imported products: each card shows the reference, name, brand, short and long descriptions, SEO meta title/description and up to 5 image thumbnails (click a thumbnail to open it in a lightbox). Product images are served through a backend proxy (`GET /api/fetch/prestashop/images/:productId/:imageId`) that detects the content type from the image bytes.

### Changed
- The PrestaShop import filters (references, brand, description, images and the AND/OR combiner) now persist after fetching and when navigating to the settings screen: they are owned by the dashboard instead of the import panel and are no longer cleared after "Fetch from PrestaShop". They reset only when the imported data is cleared.
- Import status messages now store the translation key and its parameters, so they re-render in the current UI language instead of keeping the language that was active when the message was created.
- The imported products grid always shows every field label (reference, name, brand, short description, description, meta title, meta description) even when the value is empty, rendered as a muted placeholder.
- The PrestaShop fetch no longer treats every combination as a separate product: the reference filter matches product references, each imported row is now a single product with product-level data (name, reference, ean, descriptions, images, brand, category, price and tax), and combinations are never expanded. Stock is the sum of the quantities of the product's combinations when it has any.
- The imported products grid renders the reference and the product name in bold.

### Fixed
- Product thumbnails showed "no images" on real PrestaShop stores: the Webservice serializes ids inside `<associations>` as XML elements (`<image><id>30</id></image>`), while the client only read the attribute form (`<image id="30"/>`). The client now accepts both forms across PrestaShop 1.7, 8 and 9, which also makes the category, combination, stock and manufacturer id extraction robust.

## [0.1.0] - 2026-08-11

### Added
- Initial Catalog AI release: a full-stack application (Express + React) that imports PrestaShop product catalogs through the Webservice API.
- PrestaShop import in the dashboard: `POST /api/fetch/prestashop` downloads products straight from the store via the Webservice, filtered by reference, brand, description presence and image presence (combined with AND or OR logic), importing the first 50 matching products. Products with combinations are imported as one row per combination (combination-level price, wholesale price and stock; product-level name, descriptions, brand, category and tax), and products without combinations as a single product-level row.
- Brand filter in the PrestaShop import: a free-text "brand" field is resolved to PrestaShop manufacturer ids (case-insensitive partial match) and narrows the pool at source; an empty brand imports every brand. `DELETE /api/fetch/prestashop` discards the fetched dataset.
- Configuration panel: PrestaShop settings (base URL, API key, version `1.7`/`8`/`9`, language id) and AI provider settings (provider, model, language, API key), with connection tests for both (PrestaShop webservice root check; AI via a mock provider that needs no API key).
- Configuration persistence to a local JSON file with the API keys encrypted at rest (AES-256-GCM): the encryption key comes from the `CONFIG_SECRET` environment variable or a generated `config.json.key` file, and the location is overridable with `CONFIG_FILE`.
- Backend health indicator in the header: the dashboard polls `GET /api/status` (with automatic recovery) and reports online/offline/degraded states.
- Full internationalization (Spanish by default, English selectable) via an `I18nProvider`/`useI18n` hook with a language toggle in the header and `localStorage` persistence.
- Backend test suite: Express app, API routes, PrestaShop client and fetcher, config persistence, error handling and logging (supertest, mocked axios).
- Frontend test suite: API service, hooks, layout, configuration form, PrestaShop import panel and dashboard flow (jest + RTL).
- MIT `LICENSE` and this changelog referenced from the README.

[Unreleased]: https://github.com/rafajcc/catalog_ai
[0.1.0]: https://github.com/rafajcc/catalog_ai/releases/tag/v0.1.0
