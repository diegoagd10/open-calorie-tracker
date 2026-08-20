# 18 — Crear e inspeccionar plates

## Objetivo

Permitir agrupar foods exitosos del mismo día en un plate con nombre obligatorio, card textual, totals derivados y detalle de componentes.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), sección 9, historia OCT-011.
- Requiere specs 01–17: food entries exitosas/editables, summaries y scans.
- Solo successful foods de un mismo local_date pueden agruparse; pending/failed quedan fuera.
- Un plate es opcional y no equivale a meal category.

## Alcance

### Dentro

- Migraciones plates y plate_components.
- Creación atómica desde foods standalone del día.
- Nombre custom, hora fija inicial y card textual.
- Detalle con componentes y totals calories/protein/carbs/fat.

### Fuera

- Añadir luego, remover, borrar, save/reuse y empty behavior; spec 19.
- Preset meal categories y ungroup.
- Offline/sync; specs 21 y 24.

## Tareas en orden

1. Añadir plates con owner, local_date, name, time_minutes, timezone, timestamps/version; plate_components referencia food entries con orden.
2. Establecer constraints: mismo owner/día, entry successful y cada food pertenece como máximo a una card/plate occurrence.
3. Definir mínimo de creación: al menos dos foods; documentarlo como resolución técnica/producto necesaria y cubrirlo en UI.
4. Implementar POST /days/:date/plates con name y foodEntryIds en una transacción.
5. Bloquear pending/failed, IDs ajenos, fechas mixtas y concurrencia donde una entry ya fue agrupada.
6. Asignar al plate la hora más reciente entre componentes y persistirla como propia.
7. Derivar totals y propagación incomplete desde componentes, sin duplicar la suma del día.
8. Sustituir cards componentes por una card plate text-only newest-first.
9. Implementar GET /plates/:id con componentes y valores individuales.
10. Probar atomicidad, concurrencia, mismo día, fallos, totals, missing data, orden y aislamiento.

## Criterios de aceptación verificables

- Dos o más successful foods del mismo día crean un plate con custom name.
- Pending/failed/ajenos/fechas mixtas rechazan la operación sin agrupación parcial.
- La card es text-only y muestra calories/protein/carbs/fat combinados.
- El día suma los componentes exactamente una vez.
- Abrir muestra todos los foods y valores.
- La hora inicial es la más reciente y queda persistida.
- No aparecen meal categories ni acción ungroup.
- Tests transaccionales y pnpm verify pasan.

## Notas técnicas

- La creación requiere transacción IMMEDIATE o control de versión para evitar doble agrupación.
- No copiar imágenes al plate; siguen privadas en componentes y solo se ven en detalle si corresponde.
- Totals se derivan on-read inicialmente.
- Plate con una sola food se permite después de removals, aunque creación empiece en dos.
