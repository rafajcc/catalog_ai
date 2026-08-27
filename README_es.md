# Catálogo IA

Importación y enriquecimiento de catálogos con IA para tiendas PrestaShop.

Catálogo IA te ayuda a importar productos de PrestaShop y enriquecerlos con contenido generado por IA: descripciones, meta campos SEO e imágenes. Diseñado para agencias y comerciantes que gestionan catálogos de productos a gran escala.

## Características

- **Integración con PrestaShop** — Importa productos por referencia, marca o filtros mediante la API Webservice
- **Enriquecimiento de contenido con IA** — Genera descripciones, meta títulos y meta descripciones con GPT-4, Claude u OpenRouter
- **Búsqueda de imágenes con IA** — Encuentra y añade imágenes de productos automáticamente
- **Multiinquilino** — Cada negocio tiene usuarios, configuraciones y datos aislados
- **Acceso por roles** — Roles de administrador y usuario de solo lectura
- **Interfaz bilingüe** — Interfaz en español e inglés
- **Guardado directo** — Envía el contenido enriquecido de vuelta a PrestaShop con un clic

## Inicio rápido

### Requisitos previos

- Node.js 18+

### Instalación y ejecución

```bash
git clone https://github.com/rafajcc/catalog_ai.git
cd catalog_ai
npm install --prefix backend && npm install --prefix frontend
npm run build
npm start
```

Abre http://localhost:3000

### Configuración inicial

1. Haz clic en "Registrar nuevo comercio" en la página de inicio de sesión
2. Ingresa el nombre de tu negocio y las credenciales de administrador
3. Ve a Configuración (⚙) y configura tu conexión con PrestaShop
4. Configura tu proveedor de IA (o usa Mock para pruebas)
5. Importa productos y comienza a enriquecerlos

## Documentación

| Documento | Descripción |
|---|---|
| [Instalación](docs/INSTALLATION_es.md) | Guía de instalación detallada, variables de entorno, resolución de problemas |
| [Configuración](docs/CONFIGURATION_es.md) | Configuración de PrestaShop, proveedor de IA y prompts |
| [Despliegue](docs/DEPLOYMENT_es.md) | Build de producción, Nginx, SSL, copias de seguridad |
| [Referencia API](docs/API_es.md) | Documentación completa de los endpoints de la API |
| [Arquitectura](docs/ARCHITECTURE_es.md) | Arquitectura técnica y decisiones de diseño |
| [Pruebas](docs/TESTING_es.md) | Suites de pruebas, comandos y cómo escribir tests |

## Stack tecnológico

- **Backend:** Node.js, Express, TypeScript, SQLite (sql.js)
- **Frontend:** React, TypeScript, Vite
- **IA:** OpenAI, Anthropic, OpenRouter, GPT4All, Mock (pruebas)

## Licencia

**Business Source License 1.1 (BSL 1.1)**

Copyright (c) 2026 Vera Technology; rafajcc

El uso comercial está restringido durante 4 años desde el primer lanzamiento. El 21/08/2030, esta licencia se convierte en [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

Consulta los [términos completos](LICENSE).

## Contribuir

Para sugerencias y contribuciones, contáctanos en info@vera-technology.com.

Consulta [TESTING_es.md](docs/TESTING_es.md) para la configuración de desarrollo y comandos de prueba.
