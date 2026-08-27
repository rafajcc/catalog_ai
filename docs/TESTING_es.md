# Pruebas

Guía completa de pruebas de Catálogo IA.

## Visión general

- **Backend** usa **Jest + ts-jest**.
- **Frontend** usa **Vitest + React Testing Library** (configuración en `vite.config.ts`).

El backend y el frontend son proyectos independientes con configuraciones separadas. También puedes ejecutar ambos desde la raíz del proyecto con `npm test`.

## Pruebas del backend

**Ubicación:** `backend/test/`
**Configuración:** `backend/jest.config.js`

### Ejecutar todas las pruebas

```bash
cd backend
npm test
```

O desde la raíz del proyecto: `npm run test:backend`

### Ejecutar suites de pruebas específicas

| Comando | Descripción |
|---|---|
| `npm run test:logger` | Pruebas del logger |
| `npm run test:error-handler` | Pruebas del manejador de errores |
| `npm run test:ai-suggester` | Pruebas del sugeridor de texto IA (proveedor mock, sin llamadas API) |
| `npm run test:app` | Pruebas de integración de la app Express (supertest) |
| `npm run test:api-routes` | Pruebas de integración de rutas API (supertest, almacén en memoria) |
| `npm run test:index` | Pruebas del punto de entrada del servidor |
| `npm run test:prestashop` | Pruebas del cliente PrestaShop (axios mockeado, sin red) |

### Modos de prueba

```bash
# Modo watch (se re-ejecuta al haber cambios)
npm run test:watch

# Reporte de cobertura
npm run test:coverage
```

### Calidad de código

```bash
# Verificación de tipos TypeScript
npm run typecheck

# ESLint
npm run lint

# Auto-corrección de problemas de lint
npm run lint:fix
```

## Pruebas del frontend

**Ubicación:** `frontend/src/` (colocadas junto a las fuentes)
**Configuración:** `frontend/vite.config.ts` (bloque `test`) + `frontend/src/vitest-setup.ts`

### Ejecutar todas las pruebas

```bash
cd frontend
npm test
```

O desde la raíz del proyecto: `npm run test:frontend`

### Ejecutar suites de pruebas específicas

| Comando | Descripción |
|---|---|
| `npm run test:app` | Pruebas de la app raíz (`App.test.tsx`) |
| `npm run test:dashboard` | Pruebas de la página del dashboard |
| `npm run test:layout` | Pruebas del encabezado |
| `npm run test:upload` | Pruebas del panel de importación de PrestaShop |
| `npm run test:configuration` | Pruebas del formulario de configuración |
| `npm run test:products` | Pruebas de la vista de productos |

### Calidad de código

```bash
# Verificación de tipos TypeScript
npm run typecheck

# ESLint
npm run lint

# Auto-corrección de problemas de lint
npm run lint:fix
```

## Lista de verificación previa al commit

Ejecuta estos antes de hacer commit:

```bash
# Ambos proyectos desde la raíz
npm run lint
npm test

# O individualmente
npm run test:backend
npm run test:frontend
npm run typecheck --prefix backend
npm run typecheck --prefix frontend
npm run lint --prefix backend
npm run lint --prefix frontend
```

## Arquitectura de pruebas

### Estructura de pruebas del backend

```
test/
├── logger.test.ts
├── error-handler.test.ts
├── ai-suggester.test.ts
├── app.test.ts              # Integración de la app Express
├── api-routes.test.ts       # Pruebas de endpoints API
├── index.test.ts            # Punto de entrada del servidor
├── prestashop.test.ts       # Cliente PrestaShop (mockeado)
```

### Estructura de pruebas del frontend

```
frontend/src/
├── App.test.tsx
├── vitest-setup.ts          # Configuración de matchers jest-dom
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
- Proveedor de IA: Usa proveedor mock (sin llamadas API reales)
- PrestaShop: Usa axios mockeado (sin peticiones de red)
- Base de datos: Usa almacén en memoria para pruebas de rutas

**Frontend:**
- Llamadas API: Mockeadas vía `vi.mock('...')`
- Axios: Mockeado vía `vi.mock('axios')`
- React Testing Library para consultas DOM

## Escritura de pruebas

### Ejemplo de prueba del backend

```typescript
import { Request, Response } from 'express';
import { myHandler } from '../../src/routes';

describe('myHandler', () => {
  it('debería devolver éxito', async () => {
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

### Ejemplo de prueba del frontend

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('debería renderizar correctamente', () => {
    render(<MyComponent />);
    expect(screen.getByText('Texto esperado')).toBeInTheDocument();
  });

  it('debería manejar clics', () => {
    const onClick = vi.fn();
    render(<MyComponent onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

## Integración continua

Para pipelines CI/CD:

```yaml
# Ejemplo de GitHub Actions
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
