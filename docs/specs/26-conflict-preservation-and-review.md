# 26 — Preservación y revisión de conflictos

## Objetivo

Cerrar el comportamiento offline garantizando que cambios irreconciliables se preserven como registros separados y eliminables, sin confundirlos con duplicados intencionales o retries.

## Contexto y dependencias

- Fuente de verdad: PRD.md, sección 13, historia OCT-018.
- Requiere specs 20–25 y sus operation IDs, base versions y change log.
- El producto no debe perder datos silenciosamente. Si no puede reconciliar, conserva ambos y el usuario puede borrar el no deseado.
- El tono sigue factual, sin blame ni scoring.

## Alcance

### Dentro

- Clasificación deterministic retry/intentional duplicate/competing edit.
- Materialización de copia preservada para food, plate, water y goal donde aplique.
- UI de review contextual y delete de la copia no deseada.
- Auditoría/telemetría sin contenido nutricional sensible.

### Fuera

- Colaboración en tiempo real, merge manual campo por campo o historial global de auditoría visible.
- Resolver automáticamente con last-write-wins.
- Analytics/reportes de progreso.

## Tareas en orden

1. Definir ConflictDecision con sameOperation, independentCreate, cleanUpdate, competingUpdate y deleteVsUpdate.
2. Deducir retries exclusivamente por operation ID/idempotency, no por igualdad de contenido.
3. Conservar independent creates siempre, aunque sean idénticos.
4. Para competing updates materializar una segunda occurrence con nuevo ID, provenance interno y snapshot completo; no sobrescribir la primera.
5. Para delete-vs-update conservar la versión editada como copia deletable y mantener semántica del delete original documentada.
6. Para goal conflict crear dos versiones resolubles sin cambiar días silenciosamente; requerir elección explícita antes de activar una, conservando la otra como review record.
7. Mostrar indicador neutral “Review duplicate changes” en el día/setting afectado con ambas cards/valores y Delete.
8. Después de la elección, sincronizar resolución idempotente a todos los teléfonos.
9. Añadir métricas de conflict type/count con IDs pseudónimos, sin email, foto ni nutrition payload.
10. Probar matriz completa, tres dispositivos, retry perdido, duplicates idénticos y resolución concurrente.

## Criterios de aceptación verificables

- El mismo operation ID nunca crea copia; dos creates independientes idénticos sí permanecen.
- Competing edits terminan como dos registros visibles/deletables, no pérdida silenciosa.
- Delete-vs-update conserva el cambio irreconciliable de forma revisable.
- La UI explica el origen como sincronización, sin culpar al usuario.
- Borrar la copia no deseada converge en todos los teléfonos.
- Totals reflejan ambos mientras existen y se recalculan tras resolución.
- Tests de la matriz son deterministas y pnpm verify pasa offline.

## Notas técnicas

- Mantener provenance interno fuera de la card normal salvo que ayude a review.
- Preservar ambos puede aumentar totals temporalmente; esto es preferible a pérdida silenciosa y debe marcarse como review pendiente.
- No usar similitud nutricional para deduplicar: duplicates son permitidos por producto.
- Esta spec completa todos los comportamientos in-scope de PRD v1; los elementos explícitamente out-of-scope permanecen excluidos.
