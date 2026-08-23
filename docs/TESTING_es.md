# Pruebas

Guía completa de pruebas de Catálogo IA.

## Visión general

Las pruebas usan **Jest + ts-jest**. El backend y el frontend son proyectos independientes con configuraciones separadas.

## Pruebas del backend

**Ubicación:** `backend/test/`
**Configuración:** `backend/jest.config.js`

### Ejecutar todas las pruebas

```bash
cd backend
npm test
```

### Ejecutar suites de pruebas específicas

| Comando | Descripción |
|---|---|
| `npm run test:logger` | Pruebas del logger |
| `npm run test:error-handler` | Pruebas del manejador de errores |
| `npm run test:ai-suggester` | Pruebas del sugeridor de texto IA (proveedor mock, sin llamadas API) |
| `npm run test:app` | Pruebas de integración de la app Express (supertest) |
| `npm run test:api-routes` | Pruebas de integración de rutas API (supertest, almacén en memoria) |
| `npm run test:auth` | Pruebas del módulo de autenticación (JWT, bcrypt, operaciones DB usuario/comercio) |
| `npm run test:index` | Pruebas del punto de entrada del servidor |
| `npm run test:prestashop` | Pruebas del cliente PrestaShop (axios mockeado, sin red) |
| `npm run test:config-persistence` | Pruebas de persistencia de configuración |

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
**Configuración:** `frontend/jest.config.cjs`

### Ejecutar todas las pruebas

```bash
cd frontend
npm test
```

### Ejecutar suites de pruebas específicas

| Comando | Descripción |
|---|---|
| `npm run test:app` | Pruebas de la app raíz (`App.test.tsx`) |
| `npm run test:dashboard` | Pruebas de la página del dashboard |
| `npm run test:layout` | Pruebas del encabezado |
| `npm run test:upload` | Pruebas del panel de importación de PrestaShop |
| `npm run test:configuration` | Pruebas del formulario de configuración |
| `npm run test:hooks` | Pruebas de hooks (`useApi`, `useBackendStatus`) |
| `npm run test:services` | Pruebas del servicio API (axios mockeado) |
| `npm run test:utils` | Pruebas de utilidades (formateo, descarga) |

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

## Arquitectura de pruebas

### Estructura de pruebas del backend

```
backend/test/
├── logger.test.ts
├── error-handler.test.ts
├── ai-suggester.test.ts
├── app.test.ts              # Integración de la app Express
├── api-routes.test.ts       # Pruebas de endpoints API
├── auth.test.ts             # Pruebas del módulo de autenticación
├── index.test.ts            # Punto de entrada del servidor
├── prestashop.test.ts       # Cliente PrestaShop (mockeado)
└── config-persistence.test.ts
```

### Estructura de pruebas del frontend

Las pruebas del frontend están colocadas junto a sus fuentes:

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
- Proveedor de IA: Usa proveedor mock (sin llamadas API reales)
- PrestaShop: Usa axios mockeado (sin peticiones de red)
- Base de datos: Usa almacén en memoria para pruebas de rutas

**Frontend:**
- Llamadas API: Mockeadas vía `jest.mock('../../services/api-service')`
- Axios: Mockeado vía `jest.mock('axios')`
- React Testing Library para consultas DOM

### Problemas conocidos

**Fallos de pruebas preexistentes:**
- 88 pruebas de DashboardPage fallan porque `toBeInTheDocument` no es función
- Causa raíz: Incompatibilidad de versiones de la librería de testing
- Impacto: Ninguno (no relacionado con la lógica de la aplicación)
- Solución: Actualizar `@testing-library/jest-dom` a la última versión

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
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('debería renderizar correctamente', () => {
    render(<MyComponent />);
    expect(screen.getByText('Texto esperado')).toBeInTheDocument();
  });

  it('debería manejar clics', () => {
    const onClick = jest.fn();
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
      - run: cd backend && npm ci && npm test
      - run: cd frontend && npm ci && npm test
```
