# 13 — Inspección, edición y borrado de alimentos

## Objetivo

Permitir abrir cualquier food entry exitoso, corregir sus datos, recalcular proporcionalmente y borrarlo sin cambiar catálogo, favoritos, plates reutilizables u otras ocurrencias.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), sección 8, historia OCT-007.
- Requiere specs 01–12: snapshots, summaries y reglas temporales.
- Campos editables: name, measurement, quantity, calories, nutrientes primarios y otros facts disponibles.
- La fecha es inmutable; duplicate entries son válidos.

## Alcance

### Dentro

- GET detalle, PATCH y DELETE autorizados.
- Escalado proporcional estable al cambiar quantity/measurement.
- Edición directa de nutrición como nueva base de esa ocurrencia.
- Other nutrition facts sin ingredients.
- Recalculo inmediato del día.

### Fuera

- Mover fecha, undo y edición del catálogo.
- Borrar imagen independientemente de entry.
- Plates/favorites, que reutilizarán esta semántica en specs 14, 18 y 19.

## Tareas en orden

1. Definir EditFoodEntryInput sin local_date, source, owner ni storage_key.
2. Implementar cálculo total = basis nutrient × quantity/basis quantity con decimal exacto.
3. Al editar nutrición, fijar los valores ingresados como base para la cantidad actual para evitar deriva posterior.
4. Implementar GET /food-entries/:id con primary/other facts y propiedad obligatoria.
5. Implementar PATCH con validación, optimistic concurrency/version y transacción.
6. Implementar DELETE idempotente; las imágenes futuras se eliminarán en specs 16–17 mediante outbox.
7. Actualizar la UI detalle/editor con units permitidas por el snapshot y errores por campo.
8. Tras save/delete, invalidar/refetch día y conservar fecha/scroll/foco significativo.
9. Mostrar Other nutrition facts solo cuando existen; nunca ingredients.
10. Probar ida/vuelta de cantidades, valores null, dos duplicados, conflicto de versión, aislamiento y totals.

## Criterios de aceptación verificables

- Editar una ocurrencia no cambia catálogo ni otra ocurrencia idéntica.
- Cambiar quantity/measurement recalcula proporcionalmente dentro de tolerancia documentada.
- Editar nutrientes y volver a escalar usa la nueva base sin deriva acumulativa.
- No existe campo/API para mover fecha.
- Delete quita la entry y recalcula summary; repetir delete es seguro.
- Other facts pueden mostrarse/editarse sin almacenar ingredients.
- Un usuario ajeno recibe 404 y no aprende que la entry existe.
- Tests cubren concurrencia y pnpm verify pasa.

## Notas técnicas

- Usar version integer o updated_at precondition para no pisar ediciones.
- Measurement conversion solo se ofrece cuando el snapshot incluye factor confiable.
- Preservar null cuando el campo se deja desconocido; cero explícito sigue siendo cero.
- La edición de label photo hereda este endpoint en spec 17.
