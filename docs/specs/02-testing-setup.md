# 02 — Configuración de pruebas

## Objetivo

Establecer una estrategia de pruebas rápida, determinista y compartida basada en Vitest para que todas las specs posteriores puedan entregar comportamiento con evidencia automatizada. Al terminar, dominio, base de datos, API y frontend deben tener un ejemplo real de prueba y comandos consistentes desde la raíz.

## Contexto y dependencias

- Fuente de verdad de producto: [docs/PRD.md](../PRD.md).
- Requiere que la spec 01 haya creado el monorepo PNPM con `apps/web`, `apps/api`, `packages/db` y `packages/domain`.
- El frontend usa Ionic, React, TypeScript, Tailwind CSS y Vite; la API usa Hono; la persistencia usa Drizzle con SQLite.
- Las pruebas de esta spec cubren la infraestructura mínima existente. Las specs posteriores deben añadir sus casos de producto a esta misma arquitectura.
- “Testeable” significa que cada test controla reloj, zona horaria, red y base de datos; ningún test obligatorio depende de Internet ni de proveedores reales.

## Alcance

### Dentro

- Vitest como runner común y un workspace/proyectos separados por paquete.
- React Testing Library, `user-event` y matchers DOM para `apps/web`.
- Pruebas de requests contra Hono sin abrir un puerto real.
- SQLite temporal aislado para pruebas de `packages/db`.
- Factories/builders compartidos para datos de dominio, sin fixtures globales mutables.
- Cobertura, convenciones de nombres y comandos CI.
- Pruebas mínimas de humo para cada workspace.

### Fuera

- Pruebas end-to-end en navegador/dispositivo y servicios de terceros.
- Visual regression, performance/load testing y pruebas nativas de cámara.
- Implementar comportamientos de autenticación, onboarding o alimentos antes de sus specs.
- Exigir cobertura del código generado, migraciones SQL o archivos de configuración.

## Tareas en orden

1. Añadir Vitest en la raíz y configurar proyectos para:
   - `packages/domain`: entorno Node.
   - `packages/db`: entorno Node y SQLite temporal por archivo de test.
   - `apps/api`: entorno Node usando `app.request(...)` de Hono.
   - `apps/web`: entorno `jsdom` con setup de Ionic/DOM.
2. Definir convenciones:
   - Tests junto al código como `*.test.ts` o `*.test.tsx`.
   - Tests de integración que atraviesan más de una capa como `*.integration.test.ts`.
   - Estructura Arrange/Act/Assert, nombres orientados a comportamiento y cero dependencia del orden de ejecución.
3. Configurar `apps/web` con React Testing Library, `@testing-library/user-event`, matchers de `jest-dom`, limpieza automática entre tests y mocks mínimos para APIs del navegador que Ionic necesite.
4. Introducir un helper de render de frontend que incluya `IonApp`, router en memoria y proveedores globales. Debe aceptar ruta inicial y dependencias inyectables; no debe ocultar queries o interacciones del usuario.
5. Crear un helper de API que construya una instancia nueva de Hono por test con dependencias inyectadas. Prohibir que las pruebas importen un servidor que escuche en un puerto.
6. Crear una factoría de base de datos que genere un archivo SQLite bajo un directorio temporal único, ejecute las migraciones disponibles y cierre/elimine sus recursos al finalizar. Mientras no haya migraciones (hasta la spec 03), debe funcionar con una base vacía.
7. Añadir utilidades para fijar y restaurar:
   - Tiempo mediante fake timers.
   - Zona horaria mediante datos explícitos en los casos; no cambiar la zona global en medio de un test concurrente.
   - IDs mediante una factoría inyectable.
   - Clientes de email, catálogo, extracción y almacenamiento mediante interfaces/fakes en specs futuras.
8. Añadir tests de humo reales:
   - Dominio: el marcador tipado inicial se exporta correctamente.
   - DB: se abre una base temporal y responde a una consulta trivial.
   - API: `GET /health` devuelve 200 y `{ status: "ok" }`.
   - Web: la pantalla raíz muestra título y transición accesible entre carga y salud OK usando una respuesta HTTP simulada.
9. Configurar cobertura con reportes `text`, `json` y `lcov`. Establecer umbral inicial global de 80% para líneas, funciones, ramas y statements en código escrito a mano; permitir umbrales por paquete solo si son iguales o más estrictos.
10. Añadir scripts raíz:
    - `pnpm test`: una ejecución determinista, sin watch.
    - `pnpm test:watch`: modo local interactivo.
    - `pnpm test:coverage`: ejecución con umbrales.
    - `pnpm verify`: lint, typecheck, test y build en ese orden.
11. Documentar en `README.md` cómo ejecutar un test, un workspace, actualizar snapshots (si algún componente los usa) y depurar una prueba. Desaconsejar snapshots amplios de UI; priorizar roles, nombres accesibles y resultados de negocio.

## Criterios de aceptación verificables

- `pnpm test` descubre y ejecuta al menos un test en cada uno de los cuatro workspaces y termina con código 0.
- `pnpm test:coverage` cumple los cuatro umbrales del 80% y genera `coverage/lcov.info` sin versionarlo.
- `pnpm verify` termina con código 0 en un clon limpio después de `pnpm install --frozen-lockfile`.
- Los tests de API no abren puertos y pueden correr dos veces seguidas sin colisiones.
- Los tests de DB crean almacenamiento únicamente en un directorio temporal y no modifican la base de desarrollo.
- El test de frontend interactúa por roles/nombres accesibles, no por clases Tailwind ni selectores de implementación.
- Ejecutar la suite con red deshabilitada produce el mismo resultado.
- No hay `it.skip`, `test.skip`, `.only` ni tests que pasen sin aserciones.

## Notas técnicas

- Mantener los fakes en el workspace que posee el contrato. Un fake de catálogo pertenece al dominio/API, no a un componente de UI.
- No mockear funciones puras del dominio: probarlas directamente con tablas de casos.
- Para SQLite, una base en archivo temporal reproduce mejor transacciones y constraints que mocks de Drizzle.
- Las fechas de negocio se pasarán como `YYYY-MM-DD`, hora local y zona IANA; las utilidades de esta spec deben facilitar esa representación sin imponer todavía reglas de producto.
- Si un adapter externo necesita contract tests, mantenerlos opt-in y fuera de `pnpm test`; la suite obligatoria siempre debe ser local.
