# Testing

Complete testing guide for Catalog AI.

## Overview

Tests use **Jest + ts-jest**. The backend and frontend are independent projects with separate configurations.

## Backend Tests

**Location:** `backend/test/`
**Config:** `backend/jest.config.js`

### Run All Tests

```bash
cd backend
npm test
```

### Run Specific Test Suites

| Command | Description |
|---|---|
| `npm run test:logger` | Logger tests |
| `npm run test:error-handler` | Error handler tests |
| `npm run test:ai-suggester` | AI text suggester tests (mock provider, no API calls) |
| `npm run test:app` | Express app integration tests (supertest) |
| `npm run test:api-routes` | API route integration tests (supertest, in-memory store) |
| `npm run test:auth` | Auth module tests (JWT, bcrypt, user/comercio DB operations) |
| `npm run test:index` | Server entry point tests |
| `npm run test:prestashop` | PrestaShop client tests (mocked axios, no network) |
| `npm run test:config-persistence` | Config persistence tests |

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
**Config:** `frontend/jest.config.cjs`

### Run All Tests

```bash
cd frontend
npm test
```

### Run Specific Test Suites

| Command | Description |
|---|---|
| `npm run test:app` | Root app tests (`App.test.tsx`) |
| `npm run test:dashboard` | Dashboard page tests |
| `npm run test:layout` | Header tests |
| `npm run test:upload` | PrestaShop import panel tests |
| `npm run test:configuration` | Configuration form tests |
| `npm run test:hooks` | Hook tests (`useApi`, `useBackendStatus`) |
| `npm run test:services` | API service tests (mocked axios) |
| `npm run test:utils` | Utility tests (formatting, download) |

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

## Test Architecture

### Backend Test Structure

```
backend/test/
├── logger.test.ts
├── error-handler.test.ts
├── ai-suggester.test.ts
├── app.test.ts              # Express app integration
├── api-routes.test.ts       # API endpoint tests
├── auth.test.ts             # Auth module tests
├── index.test.ts            # Server entry point
├── prestashop.test.ts       # PrestaShop client (mocked)
└── config-persistence.test.ts
```

### Frontend Test Structure

Frontend tests are colocated with their sources:

```
frontend/src/
├── App.test.tsx
├── pages/
│   ├── dashboard/
│   │   └── DashboardPage.test.tsx
│   └── auth/
│       └── LoginPage.test.tsx
├── components/
│   ├── layout/
│   │   └── AppHeader.test.tsx
│   ├── configuration/
│   │   └── ConfigurationForm.test.tsx
│   └── data-upload/
│       └── UploadSection.test.tsx
├── hooks/
│   ├── useApi.test.ts
│   └── useBackendStatus.test.ts
├── services/
│   └── api-service.test.ts
└── utils/
    └── format.test.ts
```

### Mocking

**Backend:**
- AI provider: Uses mock provider (no real API calls)
- PrestaShop: Uses mocked axios (no network requests)
- Database: Uses in-memory store for route tests

**Frontend:**
- API calls: Mocked via `jest.mock('../../services/api-service')`
- Axios: Mocked via `jest.mock('axios')`
- React Testing Library for DOM queries

### Known Issues

**Pre-existing test failures:**
- 88 DashboardPage tests fail due to `toBeInTheDocument` not being a function
- Root cause: Testing library version mismatch
- Impact: None (unrelated to application logic)
- Fix: Update `@testing-library/jest-dom` to latest version

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
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected text')).toBeInTheDocument();
  });

  it('should handle click', () => {
    const onClick = jest.fn();
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
      - run: cd backend && npm ci && npm test
      - run: cd frontend && npm ci && npm test
```
