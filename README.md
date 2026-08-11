# Catalog AI - PrestaShop catalog import and AI enrichment

Catalog AI helps you import and enrich product catalogs for PrestaShop stores through the PrestaShop Webservice API, with optional AI assistance for generating missing content.

## Overview

Catalog AI is a full-stack application (Express + React) that:

- Imports products directly from your PrestaShop store via the Webservice API, filtering by EAN, reference, description and image presence.
- Tests the PrestaShop connection and the AI provider from a configuration panel.
- Keeps the connection settings (PrestaShop + AI provider) persisted in a local file with the API keys encrypted at rest.
- Reports backend health in the header.

## Architecture Decisions

### Backend (Node.js + TypeScript)

The backend handles business logic and PrestaShop API communication:

1. **Server Architecture**: Express.js provides a lightweight, scalable web framework
2. **Module System**: Clear separation of concerns with each module having a single responsibility
3. **No Database**: State is managed in-memory per app instance
4. **Security**: All credentials are stored encrypted at rest, never exposed in the frontend

### Frontend (React + TypeScript)

The frontend provides the user interface and visual feedback:

1. **Component-Based**: Modular React components for each screen/purpose
2. **State Management**: React state and context API for application state
3. **Backend Status**: Polls the backend health endpoint so the connection chip recovers automatically
4. **Internationalization**: Spanish is the default UI language, English is selectable via a toggle in the header; the preference is persisted in `localStorage`

## Installation and Setup

### Prerequisites
- Node.js 18+ (for both backend and frontend)
- TypeScript compiler
- Git for version control

### Installation Steps

1. Clone the repository:
```bash
git clone <repository-url>
cd catalog_ai
```

2. Install backend dependencies:
```bash
cd backend
npm install
```

3. Install frontend dependencies:
```bash
cd ../frontend
npm install
```

4. Create environment file:
```bash
cp backend/.env.example backend/.env
```

5. Configure the environment variables in `backend/.env` if you need to change the defaults.

### Running the Application

The app has two parts that run together: the **backend** (API on `http://localhost:3000`) and the **frontend** (web UI on `http://localhost:5173`). The frontend dev server proxies all `/api` requests to the backend.

| Command (in `backend/`) | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload — http://localhost:3000 |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build (run `npm run build` first) |

| Command (in `frontend/`) | What it does |
|---|---|
| `npm run dev` | Vite dev server — http://localhost:5173 |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run preview` | Preview the production build |

#### Development (daily work)

Open **two terminals** and run one command in each:

```bash
# Terminal 1 — backend
cd backend
npm run dev

# Terminal 2 — frontend
cd frontend
npm run dev
```

Then open **http://localhost:5173** in your browser.

#### Production (deploy)

```bash
# Backend
cd backend
npm run build      # compile to dist/
npm start          # serve the compiled API

# Frontend
cd ../frontend
npm run build      # generate frontend/dist/ with the optimized static files
npm run preview    # serve that build locally to check it (optional)
```

The frontend `dist/` folder is static files you deploy to any web server (nginx, Netlify, Vercel, etc.).

## Project Structure

### Root
```
catalog_ai/
├── backend/               # Express API (see below)
├── frontend/              # React UI (see below)
├── test/                  # Backend Jest test suites
├── docs/                  # Reserved for documentation
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── README.md
└── tsconfig.json          # Base TypeScript config
```

### Backend
```
backend/
├── src/
│   ├── index.ts           # Main entry point
│   ├── app.ts             # Express application setup
│   ├── routes.ts          # API routes
│   ├── store.ts           # In-memory data store (per app instance)
│   ├── types.ts           # Shared type definitions
│   ├── utils/             # Shared utilities
│   │   ├── logger.ts      # Logging configuration
│   │   └── error-handler.ts # Central error handling
│   └── modules/
│       ├── ai-text-suggester/ # AI text generation (mock provider used for tests)
│       ├── prestashop-client/ # PrestaShop Webservice API client
│       ├── prestashop-fetcher/ # Product fetching by EAN/reference with filters
│       └── config-persistence/ # Encrypted config file persistence
├── package.json
├── .env.example
├── .eslintrc.json
├── jest.config.js
└── tsconfig.json
```

### API Endpoints

All endpoints live under `/api` and are defined in `backend/src/routes.ts`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status`, `/api/health` | Liveness / health checks |
| GET | `/api/logs` | Read recent logs |
| GET | `/api/config` | Read the current configuration |
| PUT | `/api/config` | Update (and merge) the configuration |
| POST | `/api/config/test/prestashop` | Test the PrestaShop Web Service connection |
| POST | `/api/config/test/ai` | Test the AI provider (mock provider needs no API key) |
| POST | `/api/fetch/prestashop` | Fetch products from PrestaShop by EAN/reference with filters |
| GET | `/api/fetch/prestashop` | Get the fetched PrestaShop dataset |
| DELETE | `/api/fetch/prestashop` | Discard the fetched PrestaShop dataset |

### Frontend
```
frontend/
├── index.html
├── src/
│   ├── main.tsx           # React entry point
│   ├── App.tsx            # Root component
│   ├── types.ts           # Shared type definitions
│   ├── services/          # API service layer (api-service.ts)
│   ├── hooks/             # Custom React hooks (useApi, useBackendStatus)
│   ├── utils/             # Utility functions (format, download)
│   ├── styles/            # Global CSS styles
│   ├── components/        # UI components
│   │   ├── layout/          # Header with status, language and settings
│   │   ├── configuration/   # Settings for PrestaShop and AI
│   │   └── data-upload/     # PrestaShop import panel
│   └── pages/
│       └── dashboard/       # Main dashboard
├── package.json
├── .eslintrc.json
├── jest.config.cjs
├── jest.setup.ts
├── jest.styleMock.cjs
├── tsconfig.json
└── vite.config.ts
```

## PrestaShop Compatibility

### Supported PrestaShop Versions
- PrestaShop 1.7.x
- PrestaShop 8.x
- PrestaShop 9.x

### Webservice API Features

1. **Connection**: HTTP Basic authentication with the Webservice API key; the base URL tolerates a trailing `/api`
2. **Product Operations**: fetch products by reference or EAN, retrieve stock information
3. **Language Support**: configurable default language

### API Implementation Details

- **XML**: All product and stock reads use XML
- **Authentication**: Webservice API key authentication (HTTP Basic)
- **Error Handling**: Clear errors for 401/404/5xx responses, chunked batch requests (100 per request)

## Configuration

The configuration form in the header settings stores:

### PrestaShop
- Base URL of the store
- Webservice API key
- PrestaShop version
- Language ID

### AI provider (for connection testing / content enrichment)
- Provider: OpenAI, Anthropic, OpenRouter or Mock (for testing without API costs)
- Model
- Language
- API key

The configuration is persisted to `config.json` (next to the backend package) with the API keys encrypted using AES-256-GCM. The encryption key comes from the `CONFIG_SECRET` environment variable, or a random key file (`config.json.key`) is generated next to the config file. Both files are gitignored.

## Running the Tests

Tests use **Jest + ts-jest**. The backend and frontend are independent projects: each has its own Jest configuration, its own scripts, and must be run from its own folder.

### Backend tests

Configuration: `backend/jest.config.js`. Test files are written in TypeScript and live in `test/`.

| Command | What it does |
|---|---|
| `npm test` | Runs the full backend test suite |
| `npm run test:watch` | Runs tests in watch mode (re-runs on changes) |
| `npm run test:coverage` | Runs tests with a coverage report |
| `npm run test:logger` | Runs only the logger tests |
| `npm run test:error-handler` | Runs only the error handler tests |
| `npm run test:ai-suggester` | Runs only the AI text suggester tests (mock provider, no API calls) |
| `npm run test:app` | Runs only the Express app integration tests (supertest) |
| `npm run test:api-routes` | Runs only the API route integration tests (supertest, in-memory store) |
| `npm run test:index` | Runs only the server entry point tests |
| `npm run test:prestashop` | Runs only the PrestaShop client tests (mocked axios, no network) |
| `npm run test:config-persistence` | Runs only the config persistence tests |

All commands above run from the `backend/` folder:

```bash
cd backend
npm test
```

#### Code quality checks (backend)

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | ESLint over `src/` |
| `npm run lint:fix` | Auto-fix lint issues |

### Frontend tests

Configuration: `frontend/jest.config.cjs`. Tests run in jsdom with React Testing Library and are colocated next to their sources.

| Command | What it does |
|---|---|
| `npm test` | Runs the full frontend test suite |
| `npm run test:app` | Runs only the root app tests (`App.test.tsx`) |
| `npm run test:dashboard` | Runs only the dashboard page tests |
| `npm run test:layout` | Runs only the header tests |
| `npm run test:upload` | Runs only the PrestaShop import panel tests |
| `npm run test:configuration` | Runs only the configuration form tests |
| `npm run test:hooks` | Runs only the hook tests (`useApi`, `useBackendStatus`) |
| `npm run test:services` | Runs only the API service tests (mocked axios) |
| `npm run test:utils` | Runs only the utility tests (formatting, download) |

All commands above run from the `frontend/` folder:

```bash
cd frontend
npm test
```

#### Code quality checks (frontend)

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | ESLint over `src/` (TS + React) |
| `npm run lint:fix` | Auto-fix lint issues |

### Suggested workflow before committing

```bash
# Backend
cd backend
npm run typecheck
npm test
npm run lint

# Frontend
cd ../frontend
npm run typecheck
npm test
npm run lint
```

## Troubleshooting

### Common Issues

1. **Port Conflicts**
   - Change the port in `.env` files
   - Use `PORT=3001` or similar

2. **CORS Errors**
   - Configure `FRONTEND_URL` correctly
   - Check if frontend is running on expected port

3. **API Authentication**
   - Verify the PrestaShop API key is correct (it must have read access to the products resource)
   - Check if the key has the necessary permissions

## Contributing

### Code Standards
- TypeScript with strict type checking
- ESLint for code quality
- Prettier for code formatting
- Jest for testing

### Pull Request Process
1. Fork the repository
2. Create a feature branch
3. Commit changes with descriptive messages
4. Push to your branch
5. Create a pull request

## License

MIT License - See LICENSE file for details

## Changelog

See CHANGELOG.md for recent updates and new features
