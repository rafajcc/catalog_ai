# Catalog AI

AI-powered catalog import and enrichment for PrestaShop stores.

Catalog AI helps you import products from PrestaShop and enrich them with AI-generated content — descriptions, SEO meta fields, and images. Built for agencies and merchants who manage product catalogs at scale.

## Features

- **PrestaShop Integration** — Import products by reference, brand, or filters via Webservice API
- **AI Content Enrichment** — Generate descriptions, meta titles, and meta descriptions with GPT-4, Claude, or OpenRouter
- **AI Image Search** — Automatically find and add product images
- **Multi-Tenant** — Each business has isolated users, configurations, and data
- **Role-Based Access** — Admin and read-only user roles
- **Bilingual UI** — Spanish and English interface
- **Direct Save** — Push enriched content back to PrestaShop with one click

## Quick Start

### Prerequisites

- Node.js 18+

### Install

```bash
git clone https://github.com/rafajcc/catalog_ai.git
cd catalog_ai

# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### Run

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Open http://localhost:5173

### First-Time Setup

1. Click "Registrar nuevo comercio" on the login page
2. Enter your business name and admin credentials
3. Go to Settings (⚙) and configure your PrestaShop connection
4. Configure your AI provider (or use Mock for testing)
5. Import products and start enriching!

## Documentation

| Document | Description |
|---|---|
| [Installation](docs/INSTALLATION.md) | Detailed setup guide, environment variables, troubleshooting |
| [Configuration](docs/CONFIGURATION.md) | PrestaShop, AI provider, and prompt configuration |
| [Deployment](docs/DEPLOYMENT.md) | Production build, Nginx, SSL, backups |
| [API Reference](docs/API.md) | Complete API endpoint documentation |
| [Architecture](docs/ARCHITECTURE.md) | Technical architecture and design decisions |
| [Testing](docs/TESTING.md) | Test suites, commands, and writing tests |

## Tech Stack

- **Backend:** Node.js, Express, TypeScript, SQLite (sql.js)
- **Frontend:** React, TypeScript, Vite
- **AI:** OpenAI, Anthropic, OpenRouter, GPT4All, Mock (testing)

## License

**Business Source License 1.1 (BSL 1.1)**

Copyright (c) 2026 Vera Technology; rafajcc

Commercial use is restricted for 4 years from the first release. On 2030-08-21, this license converts to [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

See [LICENSE](LICENSE) for full terms.

## Contributing

See [TESTING.md](docs/TESTING.md) for development setup and test commands.
