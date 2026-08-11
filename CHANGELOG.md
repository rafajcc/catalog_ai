# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- The configuration panel shows a readonly field with the base URL of the selected AI provider (OpenAI `https://api.openai.com/v1`, Anthropic `https://api.anthropic.com`, OpenRouter `https://openrouter.ai/api/v1`, empty for Mock). `GET /api/config` reports the effective AI endpoint, falling back to the provider default when no explicit `base_url` is configured.
- The backend logs every AI provider request through the shared logger (`AI provider request`): provider, model, base URL, mode (generate/improve), field, language, status and duration. AI connection tests from the configuration panel are also logged (`AI connection test` / `AI connection test succeeded` / `AI connection test failed`).
- "Ver" button next to "Clear imported data" that opens a grid of the imported products: each card shows the reference, name, brand, short and long descriptions, SEO meta title/description and up to 5 image thumbnails (click a thumbnail to open it in a lightbox). Product images are served through a backend proxy (`GET /api/fetch/prestashop/images/:productId/:imageId`) that detects the content type from the image bytes.
- "Save to PrestaShop" button in the products grid toolbar that pushes the pending product edits back to the store through the Webservice (`POST /api/fetch/prestashop/save`): only the fields the user changed (short/long description, meta title, meta description) are sent, keyed by the raw PrestaShop product id. The backend reads the full product, overwrites only those localized fields and PUTs the complete resource, so nothing else is touched. After a successful save the new values stay visible in the grid without the edited marker.
- "Undo" action on each edited product card that discards its pending edits and restores the originally imported values.
- The header title acts as a home button that returns to the dashboard from any view (click or Enter/Space).

### Changed
- The PrestaShop import filters (references, brand, description, images and the AND/OR combiner) now persist after fetching and when navigating to the settings screen: they are owned by the dashboard instead of the import panel and are no longer cleared after "Fetch from PrestaShop". They reset only when the imported data is cleared.
- Import status messages now store the translation key and its parameters, so they re-render in the current UI language instead of keeping the language that was active when the message was created.
- The imported products grid always shows every field label (reference, name, brand, short description, description, meta title, meta description) even when the value is empty, rendered as a muted placeholder.
- The PrestaShop fetch no longer treats every combination as a separate product: the reference filter matches product references, each imported row is now a single product with product-level data (name, reference, ean, descriptions, images, brand, category, price and tax), and combinations are never expanded. Stock is the sum of the quantities of the product's combinations when it has any.
- The imported products grid renders the reference and the product name in bold.
- Only the products grid scrolls inside the products view: the toolbar, messages and the rest of the screen stay fixed while the grid has its own scroll area.
- The product editor dialog title shows the reference and the product name.
- Re-fetching from PrestaShop warns with a confirmation when there are unsaved product edits, since the fetched dataset and its edits are discarded.

### Fixed
- The brand (manufacturer) of every imported product showed as empty: PrestaShop serializes manufacturer names as a plain field (`<name><![CDATA[Apple]]></name>`), while the client only read the multilingual form (`<name><language id="1">...</language></name>`). Localized-field extraction now falls back to the raw text when a resource is not multilingual (manufacturer names), so the grid shows the brand.
- Product thumbnails showed "no images" on real PrestaShop stores: the Webservice serializes ids inside `<associations>` as XML elements (`<image><id>30</id></image>`), while the client only read the attribute form (`<image id="30"/>`). The client now accepts both forms across PrestaShop 1.7, 8 and 9, which also makes the category, combination, stock and manufacturer id extraction robust.
- Saving edits to PrestaShop always failed with "None of the products could be updated": the PUT body is rebuilt from the fetched product, but the root `xmlns:xlink` namespace declaration was dropped, so the shop could not parse the `xlink:href` attributes that every association carries and rejected the update. The namespace declaration is now re-emitted on the PUT body (with an `application/xml` content type), and the reason PrestaShop returns in the error body is included in the failure message and logged instead of being swallowed.

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
