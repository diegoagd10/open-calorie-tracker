# 01 — Configuración del monorepo

## Objetivo

Crear la base ejecutable del producto como un monorepo PNPM con cuatro unidades claramente separadas: la aplicación móvil/web Ionic (`apps/web`), la API Hono (`apps/api`), la persistencia Drizzle (`packages/db`) y el dominio compartido (`packages/domain`). Al terminar, un clon limpio debe poder instalar dependencias, compilar todos los paquetes y levantar web y API localmente.

## Contexto y dependencias

- Fuente de verdad de producto: `PRD.md` en la raíz.
- Esta es la primera entrega y no depende de ninguna spec anterior.
- Stack obligatorio: PNPM workspaces, Ionic, React, TypeScript, Tailwind CSS y Vitest en frontend; Hono para la API; Drizzle para acceso a datos.
- El PRD exige una experiencia centrada en teléfono y WCAG 2.2 AA. Esta spec solo prepara esa base; todavía no implementa flujos de producto.
- SQLite es la base aprobada indicada en las historias verticales del PRD. La conexión real y el esquema se implementan en la spec 03.

## Alcance

### Dentro

- Workspace PNPM y configuración TypeScript compartida.
- `apps/web`: Ionic React con Vite, React Router y Tailwind CSS.
- `apps/api`: Hono ejecutándose sobre Node y un endpoint público `GET /health`.
- `packages/domain`: paquete TypeScript sin dependencias de UI, HTTP ni base de datos.
- `packages/db`: paquete TypeScript con Drizzle y un punto de entrada vacío preparado para SQLite.
- Scripts raíz para desarrollo, build, typecheck y lint.
- Variables de entorno documentadas y configuración segura por defecto.
- Reglas de dependencia entre paquetes.

### Fuera

- Configuración completa de tests y cobertura; corresponde a la spec 02.
- Tablas, migraciones y datos semilla; corresponden a la spec 03.
- Autenticación, onboarding y cualquier funcionalidad de registro de alimentos.
- Despliegue cloud, CI/CD, proveedor de correo, proveedor de catálogo, almacenamiento de imágenes y extracción de etiquetas.
- Funciones de producto como agua, plates, favoritos, barcode, offline/sync y metas históricas; no se implementan en esta base y tienen specs posteriores en la secuencia.

## Tareas en orden

1. Crear `pnpm-workspace.yaml` con `apps/*` y `packages/*`, fijar el major de Node soportado en `engines` (Node 22 o superior) y declarar PNPM en `packageManager`. Generar y versionar `pnpm-lock.yaml`.
2. Crear el `package.json` raíz como `private: true` con scripts no interactivos:
   - `dev`: levanta web y API en paralelo mediante scripts recursivos de PNPM.
   - `build`: compila los cuatro workspaces respetando sus dependencias.
   - `typecheck`: ejecuta TypeScript con `noEmit` en todos los workspaces.
   - `lint`: ejecuta el linter en todos los workspaces.
   - Reservar `test` y `test:coverage` para la spec 02 sin simular éxito.
3. Añadir una configuración TypeScript base con `strict: true`, `noUncheckedIndexedAccess: true`, alias únicamente cuando puedan resolverse igual en editor, build y tests, y configuraciones derivadas por workspace.
4. Crear `packages/domain` como módulo ESM. Exportar solo un marcador tipado inicial (por ejemplo, `AppHealth = "ok"`) para demostrar consumo entre paquetes. El paquete no debe importar Ionic, Hono, Drizzle ni APIs de Node.
5. Crear `packages/db` como módulo ESM que dependa de Drizzle y del dominio. Exponer un módulo `client` que, hasta la spec 03, falle con un mensaje explícito si se intenta usar sin `DATABASE_URL`; no crear tablas implícitamente al importar.
6. Crear `apps/api` con Hono y el adaptador de Node. Implementar:
   - `GET /health` → estado 200 y JSON `{ "status": "ok" }`.
   - Middleware de request ID y manejo de errores que no exponga stack traces en producción.
   - `PORT` y `WEB_ORIGIN` configurables mediante entorno.
7. Crear `apps/web` con Ionic React, Vite y React Router. La ruta `/` debe renderizar una pantalla mínima “Calorie Tracker” y consultar `/health`, mostrando estados accesibles de conexión, error y carga.
8. Integrar Tailwind CSS en `apps/web` sin eliminar los estilos estructurales requeridos por Ionic. Definir tokens CSS iniciales para fondo, superficie, texto, borde, foco y acento; respetar `prefers-reduced-motion` y contraste AA.
9. Establecer límites de importación:
   - `apps/web` puede depender de `packages/domain`, nunca de `packages/db` ni de código servidor.
   - `apps/api` puede depender de `packages/domain` y `packages/db`.
   - `packages/db` puede depender de `packages/domain`.
   - `packages/domain` no puede depender de otro workspace.
10. Crear `.env.example` con al menos `DATABASE_URL`, `API_PORT`, `WEB_ORIGIN` y `VITE_API_BASE_URL`. Ningún secreto o `.env` real debe versionarse.
11. Documentar en el `README.md` raíz requisitos, instalación, comandos, puertos predeterminados, estructura y reglas de dependencias.

## Criterios de aceptación verificables

- En un clon limpio, `corepack enable && pnpm install --frozen-lockfile` termina sin cambios al lockfile.
- `pnpm build`, `pnpm typecheck` y `pnpm lint` terminan con código 0.
- `pnpm dev` levanta API y web; `curl http://localhost:<API_PORT>/health` devuelve 200 y exactamente un objeto con `status: "ok"`.
- La pantalla raíz funciona en un viewport de 320 px sin scroll horizontal, tiene un único `h1` y anuncia carga/error de la API mediante una región accesible.
- Tailwind se demuestra con al menos una clase utilitaria en un componente y los componentes Ionic conservan su estilo base.
- Una búsqueda estática confirma que `apps/web` no importa `packages/db` y que `packages/domain` no importa Hono, Drizzle, Ionic ni Node.
- No existen tablas de producto, pantallas de autenticación ni flujos de alimentos en esta entrega.
- `.env.example` está versionado y `git ls-files` no contiene `.env` ni credenciales.

## Notas técnicas

- Mantener ESM de extremo a extremo para evitar rutas duales CommonJS/ESM.
- Usar llamadas HTTP entre web y API; nunca compartir una instancia de base de datos con el navegador.
- El endpoint de salud no debe comprobar todavía tablas inexistentes. La spec 03 podrá ampliar la respuesta interna sin exponer datos sensibles.
- La UI se diseña mobile-first porque el PRD prioriza teléfono, pero debe seguir funcionando en escritorio.
- Evitar introducir un orquestador de monorepo adicional hasta que exista una necesidad medida; PNPM recursivo es suficiente para esta secuencia.
