# Catalog AI

AI-powered catalog import and enrichment for PrestaShop stores.

Catalog AI helps you load products from PrestaShop and enrich them with AI-generated content — descriptions, SEO meta fields, and images. Built for agencies and merchants who manage product catalogs at scale.

## Features

- **PrestaShop Integration** — Load products by reference, brand, or filters via Webservice API
- **AI Content Enrichment** — Generate descriptions, meta titles, and meta descriptions with GPT-4, Claude, or OpenRouter
- **Image Provider Engine** — Find product images from provider feeds plus third-party image services (Apify, SerpAPI, Serper, Brave, DataForSEO, …) with feeds-first lookup (the `feeds` service runs first when enabled and is excluded from the round robin), round-robin load balancing and monthly billing caps
- **Multi-Tenant** — Each business has isolated users, configurations, and data
- **Role-Based Access** — Admin, read-only user, and platform super admin roles
- **Super Admin** — Activate/deactivate businesses, inspect their users, enable/disable user accounts and reset passwords (with forced first-login change), and manage the image provider services
- **Bilingual UI** — Spanish and English interface
- **Direct Save** — Push enriched content back to PrestaShop with one click

## Quick Start

### Prerequisites

- Node.js 22+

### Install & Run

```bash
git clone https://github.com/rafajcc/catalog_ai.git
cd catalog_ai
npm install --prefix backend && npm install --prefix frontend
npm run build
npm start
```

Open http://localhost:3000

### First-Time Setup

1. Click "Registrar nuevo comercio" on the login page
2. Enter your business name and admin credentials
3. Go to Settings (⚙) and configure your PrestaShop connection
4. Configure your AI provider (or use Mock for testing)
5. Load products and start enriching!

## Super Admin

The optional platform super admin watches over every registered business. It is not a database user: the account exists only when both environment variables **`ADMIN_USER`** and **`ADMIN_PASSWORD`** are set in the `.env` file.

- `ADMIN_USER` — the plaintext super admin username.
- `ADMIN_PASSWORD` — a **bcrypt hash** of the password (rounds 12), not the plaintext. Generate it from the `backend/` folder:

  ```bash
  node -e "const b=require('bcryptjs'); b.hash('tu-password',12).then(h=>console.log(h))"
  ```

If either variable is missing, **nobody** can sign in as the super admin. Because the credentials are read from the environment at every request, removing them also invalidates any super admin session already open.

With the super admin you can:

- **Activate / deactivate businesses.** A deactivated business blocks both new logins and already-open sessions.
- **List the users of any business.** User rows show their role, `must_change_password` state and whether the account is active.
- **Enable / disable any user of any business** (admins included). A disabled user cannot log in and its open sessions are killed.
- **Reset any user's password** — including those of other admins. Reset and admin-created passwords force the user to change them on the next login.
- **Configure the image provider services.** Store the API keys / credentials for every image service (stored in the database, never exposed), enable and reorder the round-robin order (the `feeds` service always runs first when enabled and is not part of the round-robin), and manage the provider feed images table.

Business admins manage the users of *their own* business only: they can create and delete users, change roles, enable/disable accounts and reset passwords of any user of the business — other admins included. The only protected accounts are their own: an admin cannot change the role, disable, reset or delete the user they are logged in as (a dedicated "change password" screen exists for that). Users of other businesses are never reachable.

Once a business is registered it cannot be re-registered; the only way to add another admin is from the Users panel of a business admin.

## Documentation

| Document | Description |
|---|---|
| [Installation](docs/INSTALLATION.md) | Detailed setup guide, environment variables, troubleshooting |
| [Configuration](docs/CONFIGURATION.md) | PrestaShop, AI provider, and prompt configuration |
| [Database](docs/DATABASE.md) | Database layer design: embedded SQLite or external PostgreSQL/MySQL |
| [Deployment](docs/DEPLOYMENT.md) | Production build, Nginx, SSL, backups |
| [API Reference](docs/API.md) | Complete API endpoint documentation |
| [Architecture](docs/ARCHITECTURE.md) | Technical architecture and design decisions |
| [Testing](docs/TESTING.md) | Test suites, commands, and writing tests |

## Tech Stack

- **Backend:** Node.js, Express, TypeScript, SQLite (sql.js)
- **Frontend:** React, TypeScript, Vite
- **AI:** OpenAI, Anthropic, OpenRouter, Mock (testing)
- **Image providers:** Feeds, Mock, DuckDuckGo, Apify, Serper, SerpAPI, Brave, DataForSEO, and more

## License

**Business Source License 1.1 (BSL 1.1)**

Copyright (c) 2026 Vera Technology; rafajcc

Commercial use is restricted for 4 years from the first release. On 2030-08-21, this license converts to [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

See [LICENSE](LICENSE) for full terms.

## Contributing

For suggestions and contributions, contact us at info@vera-technology.com.

See [TESTING.md](docs/TESTING.md) for development setup and test commands.
