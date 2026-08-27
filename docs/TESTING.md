# Testing

Complete testing guide for Catalog AI.

## Overview

- **Backend** uses **Jest + ts-jest**.
- **Frontend** uses **Vitest + React Testing Library** (config in `vite.config.ts`).

The backend and frontend are independent projects with separate configurations. You can also run both from the project root with `npm test`.

## Backend Tests

**Location:** `backend/test/`
**Config:** `backend/jest.config.js`

### Run All Tests

```bash
cd backend
npm test
```

Or from the project root: `npm run test:backend`

### Run Specific Test Suites

| Command | Description |
|---|---|
| `npm run test:logger` | Logger tests |
| `npm run test:error-handler` | Error handler tests |
| `npm run test:ai-suggester` | AI text suggester tests (mock provider, no API calls) |
| `npm run test:app` | Express app integration tests (supertest) |
| `npm run test:api-routes` | API route integration tests (supertest, in-memory store) |
| `npm run test:index` | Server entry point tests |
| `npm run test:prestashop` | PrestaShop client tests (mocked axios, no network) |

### Test Modes

```bash
# Watch mode (re-runs on changes)
npm run test:watch

# Coverage report
npm run test:coverage
```

### Code Quality

```bash
# TypeScript type checking
npm run typecheck

# ESLint
npm run lint

# Auto-fix lint issues
npm run lint:fix
```

## Frontend Tests

**Location:** `frontend/src/` (colocated with sources)
**Config:** `frontend/vite.config.ts` (`test` block) + `frontend/src/vitest-setup.ts`

### Run All Tests

```bash
cd frontend
npm test
```

Or from the project root: `npm run test:frontend`

### Run Specific Test Suites

| Command | Description |
|---|---|
| `npm run test:app` | Root app tests (`App.test.tsx`) |
| `npm run test:dashboard` | Dashboard page tests |
| `npm run test:layout` | Header tests |
| `npm run test:upload` | PrestaShop import panel tests |
| `npm run test:configuration` | Configuration form tests |
| `npm run test:products` | Products view tests |

### Code Quality

```bash
# TypeScript type checking
npm run typecheck

# ESLint
npm run lint

# Auto-fix lint issues
npm run lint:fix
```

## Pre-Commit Checklist

Run these before committing:

```bash
# Both projects from root
npm run lint
npm test

# Or individually
npm run test:backend
npm run test:frontend
npm run typecheck --prefix backend
npm run typecheck --prefix frontend
npm run lint --prefix backend
npm run lint --prefix frontend
```

## Test Architecture

### Backend Test Structure

```
test/
├── logger.test.ts
├── error-handler.test.ts
├── ai-suggester.test.ts
├── app.test.ts              # Express app integration
├── api-routes.test.ts       # API endpoint tests
├── index.test.ts            # Server entry point
└── prestashop.test.ts       # PrestaShop client (mocked)
```

### Frontend Test Structure

```
frontend/src/
├── App.test.tsx
├── vitest-setup.ts          # jest-dom matchers setup
├── pages/
│   ├── dashboard/DashboardPage.test.tsx
│   ├── products/ProductsViewPage.test.tsx
│   └── users/UserManagementPage.test.tsx
├── components/
│   ├── layout/layout.test.tsx
│   ├── configuration/ConfigurationForm.test.tsx
│   └── data-upload/UploadSection.test.tsx
├── hooks/
│   ├── useApi.test.tsx
│   └── useBackendStatus.test.tsx
├── services/
│   └── api-service.test.ts
└── utils/
    └── download.test.ts
```

### Mocking

**Backend:**
- AI provider: Uses mock provider (no real API calls)
- PrestaShop: Uses mocked axios (no network requests)
- Database: Uses in-memory store for route tests

**Frontend:**
- API calls: Mocked via `vi.mock('...')`
- Axios: Mocked via `vi.mock('axios')`
- React Testing Library for DOM queries

## Writing Tests

### Backend Test Example

```typescript
import { Request, Response } from 'express';
import { myHandler } from '../../src/routes';

describe('myHandler', () => {
  it('should return success', async () => {
    const req = {} as Request;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    } as unknown as Response;
    const next = jest.fn();

    await myHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });
});
```

### Frontend Test Example

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected text')).toBeInTheDocument();
  });

  it('should handle click', () => {
    const onClick = vi.fn();
    render(<MyComponent onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

## Continuous Integration

For CI/CD pipelines:

```yaml
# Example GitHub Actions
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install --prefix backend && npm install --prefix frontend
      - run: npm run test:backend
      - run: npm run test:frontend
      - run: npm run lint
```
