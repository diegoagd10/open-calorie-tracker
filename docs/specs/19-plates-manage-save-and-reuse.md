# 19 — Gestionar, guardar y reutilizar plates

## Objetivo

Completar el ciclo de vida de plates: añadir foods directamente, editar hora/nombre, remover componentes, borrar ocurrencias y guardar/reutilizar templates sin modificar historia.

## Contexto y dependencias

- Fuente de verdad: PRD.md, secciones 9.1, 9.2 y 10, historia OCT-012.
- Requiere specs 01–18: plate creado/inspeccionable y flujos normales Add Food.
- Una entry standalone existente no puede moverse a un plate existente; un food nuevo sí puede registrarse directamente dentro.
- Un plate de una food permanece; al quitar la última se elimina automáticamente.

## Alcance

### Dentro

- Add Food dentro de plate, remove component, name/time edit y delete cascade.
- Reglas one/zero component, no ungroup y no move-in.
- Saved reusable plates: save/list/log/remove con snapshots.
- Recalculo de plate/día tras cada cambio.

### Fuera

- Meal categories.
- Convertir plate a standalone entries.
- Offline/sync; specs 21 y 24.

## Tareas en orden

1. Añadir reusable_plates y reusable_plate_foods como snapshots privados versionados.
2. Implementar PATCH /plates/:id para name y time_minutes; cambios de componentes nunca cambian hora automáticamente.
3. Permitir abrir Add Food desde plate y crear una nueva entry directamente asociada usando catálogo/favorite/barcode/label.
4. Implementar DELETE /plates/:id/components/:entryId en transacción.
5. Si queda una food, conservar plate; si queda cero, borrar plate automáticamente.
6. No exponer endpoint para mover una standalone existente ni ungroup.
7. Implementar DELETE plate que elimine ocurrencia, components e imágenes mediante outbox.
8. Implementar save como reusable snapshot completo, independiente de la ocurrencia.
9. Reutilizar crea nuevo plate + nuevas food entries con cantidades/nutrición guardadas y regla horaria del día.
10. Borrar reusable afecta solo uso futuro.
11. Integrar saved foods y reusable plates en la primera opción Add Food.
12. Probar cada transición, totals, hora fija, cascades, imágenes, aislamiento y snapshot independence.

## Criterios de aceptación verificables

- Food nueva puede registrarse dentro; standalone existente no puede moverse.
- Quitar hasta una food mantiene plate; quitar la última borra card automáticamente.
- Cambiar/remover componentes recalcula plate y día pero no su hora.
- Hora puede editarse directamente sin cambiar componentes.
- No existe ungroup.
- Delete de occurrence borra components e imágenes; reusable permanece.
- Delete de reusable no cambia occurrences ya loggeadas.
- Reuse crea snapshots nuevos y privados.
- Tests cubren transiciones y pnpm verify pasa.

## Notas técnicas

- Mantener invariantes en servicios/transactions, no solo UI.
- Un reusable plate guarda facts requeridos aunque catalog/favorites desaparezcan.
- El outbox de imágenes se comparte con specs 16–17.
- Usar locks/versiones para remove concurrente y empty auto-delete.
