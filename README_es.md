# Catálogo IA

Importación y enriquecimiento de catálogos con IA para tiendas PrestaShop.

Catálogo IA te ayuda a importar productos de PrestaShop y enriquecerlos con contenido generado por IA: descripciones, meta campos SEO e imágenes. Diseñado para agencias y comerciantes que gestionan catálogos de productos a gran escala.

## Características

- **Integración con PrestaShop** — Importa productos por referencia, marca o filtros mediante la API Webservice
- **Enriquecimiento de contenido con IA** — Genera descripciones, meta títulos y meta descripciones con GPT-4, Claude u OpenRouter
- **Motor de servicios de imágenes** — Encuentra imágenes de producto desde feeds de proveedor y servicios de imágenes externos (Apify, SerpAPI, Serper, Brave, DataForSEO, …) con consulta de feeds primero, balanceo round-robin y topes mensuales de facturación
- **Multiinquilino** — Cada negocio tiene usuarios, configuraciones y datos aislados
- **Acceso por roles** — Roles de administrador, usuario de solo lectura y super administrador de la plataforma
- **Super administrador** — Activa/desactiva negocios, inspecciona sus usuarios, activa/desactiva cuentas de usuario y restablece contraseñas (con cambio forzado en el primer acceso) y gestiona los servicios de imágenes
- **Interfaz bilingüe** — Interfaz en español e inglés
- **Guardado directo** — Envía el contenido enriquecido de vuelta a PrestaShop con un clic

## Inicio rápido

### Requisitos previos

- Node.js 22+

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

## Super administrador

El super administrador opcional de la plataforma supervisa todos los negocios registrados. No es un usuario de la base de datos: la cuenta solo existe cuando ambas variables de entorno **`ADMIN_USER`** y **`ADMIN_PASSWORD`** están definidas en el archivo `.env`.

- `ADMIN_USER` — el nombre de usuario del super administrador, en texto plano.
- `ADMIN_PASSWORD` — un **hash bcrypt** de la contraseña (12 rondas), no la contraseña en texto plano. Genera el hash desde la carpeta `backend/`:

  ```bash
  node -e "const b=require('bcryptjs'); b.hash('tu-password',12).then(h=>console.log(h))"
  ```

Si falta cualquiera de las dos variables, **nadie** puede iniciar sesión como super administrador. Como las credenciales se leen del entorno en cada petición, retirarlas también invalida cualquier sesión de super administrador ya abierta.

Con el super administrador puedes:

- **Activar / desactivar negocios.** Un negocio desactivado bloquea tanto los nuevos inicios de sesión como las sesiones ya abiertas.
- **Listar los usuarios de cualquier negocio.** Las filas muestran el rol, el estado `must_change_password` y si la cuenta está activa.
- **Activar / desactivar cualquier usuario de cualquier negocio** (administradores incluidos). Un usuario desactivado no puede iniciar sesión y sus sesiones abiertas se cierran.
- **Restablecer la contraseña de cualquier usuario** — incluidos otros administradores. Las contraseñas restablecidas (o creadas) por un administrador fuerzan al usuario a cambiarlas en su próximo inicio de sesión.
- **Configurar los servicios de imágenes.** Guarda las claves API / credenciales de cada servicio de imágenes (almacenadas en la base de datos, nunca expuestas), habilítalos y reordénalos para el round-robin (el servicio `feeds` siempre se usa primero cuando está habilitado y no forma parte del round-robin), y gestiona la tabla de imágenes de feeds.

Los administradores de un negocio gestionan únicamente los usuarios de *su propio* negocio: pueden crear y eliminar usuarios, cambiar roles, activar/desactivar cuentas y restablecer contraseñas de cualquier usuario del negocio —otros administradores incluidos—. Las únicas cuentas protegidas son las propias: un administrador no puede cambiar el rol, desactivar, restablecer ni eliminar al usuario con el que ha iniciado sesión (para eso existe una pantalla dedicada de «cambiar contraseña»). Los usuarios de otros negocios nunca son accesibles.

Una vez registrado, un negocio no se puede volver a registrar; la única forma de añadir otro administrador es desde el panel de usuarios de un administrador del propio negocio.

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
- **IA:** OpenAI, Anthropic, OpenRouter, Mock (pruebas)
- **Servicios de imágenes:** Feeds, Mock, DuckDuckGo, Apify, Serper, SerpAPI, Brave, DataForSEO y más

## Licencia

**Business Source License 1.1 (BSL 1.1)**

Copyright (c) 2026 Vera Technology; rafajcc

El uso comercial está restringido durante 4 años desde el primer lanzamiento. El 21/08/2030, esta licencia se convierte en [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

Consulta los [términos completos](LICENSE).

## Contribuir

Para sugerencias y contribuciones, contáctanos en info@vera-technology.com.

Consulta [TESTING_es.md](docs/TESTING_es.md) para la configuración de desarrollo y comandos de prueba.
