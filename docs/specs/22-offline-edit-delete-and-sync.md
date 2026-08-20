# 22 — Editar y borrar offline

## Objetivo

Permitir editar o borrar food y water disponibles localmente mientras no hay conexión, conservar la intención tras restart y sincronizarla idempotentemente.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), sección 13, historia OCT-014.
- Requiere specs 01–21: local store, queue y CRUD online.
- Esta spec implementa operaciones sobre entidades ya disponibles; conflictos multi-device se resuelven/preservan en specs 24–26.

## Alcance

### Dentro

- Offline PATCH/DELETE de food successful y water.
- Optimistic UI local transaccional, queue ordenada y tombstones.
- Replay, acknowledgement, retry y error visible.

### Fuera

- Plate component edits offline.
- Offline scans; spec 23.
- Descartar automáticamente competing changes.

## Tareas en orden

1. Definir operations update/delete con operationId, entityId, baseVersion, payload y client sequence.
2. Aplicar mutación y enqueue en una sola transacción local.
3. Mantener tombstone visible solo donde se necesite para undo técnico/retry; no resucitar en refresh.
4. Compactar operaciones seguras del mismo entity sin perder intención (create+update, create+delete) y conservar audit local.
5. Enviar en orden causal por entidad y permitir paralelismo entre entidades.
6. Procesar ack/version nueva; en rechazo retryable conservar queue y estado.
7. Ante version conflict no sobrescribir servidor: marcar para motor de specs 24–26.
8. Recalcular summaries localmente con las mismas funciones de dominio.
9. Probar restart, retry, update→delete, delete ya aplicado, conflictos y dos entidades.

## Criterios de aceptación verificables

- Edit/delete offline cambia UI y totals inmediatamente y sobrevive restart.
- Replay lógico ocurre una vez aunque haya timeouts/respuestas perdidas.
- Delete no resucita tras delta pull.
- Error retryable conserva intención y ofrece estado comprensible.
- Version conflict preserva datos hasta resolución posterior.
- Food y water ajenos/no cached no pueden mutarse.
- Tests comparan resultado offline+sync con equivalente online.

## Notas técnicas

- Reusar validators/domain math de online.
- Tombstones requieren retención suficiente para que todos los dispositivos observen el delete.
- No usar last-write-wins basado solo en wall clock.
