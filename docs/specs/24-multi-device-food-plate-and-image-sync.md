# 24 — Sincronizar foods, plates, saved items e imágenes

## Objetivo

Sincronizar entre teléfonos food entries, favorites, plates, reusable plates e imágenes privadas, manteniendo ordering, ownership, idempotencia y snapshots.

## Contexto y dependencias

- Fuente de verdad: PRD.md, secciones 3 y 13, historia OCT-016.
- Requiere specs 01–23: sesiones simultáneas, CRUD, scans y protocolo del ADR 20.
- Una cuenta puede permanecer conectada en varios teléfonos.
- Conflictos irreconciliables se preservan en spec 26; esta spec detecta y transporta evidencia.

## Alcance

### Dentro

- Change log/cursor servidor y pull/push para food, favorite, plate, reusable e image metadata.
- Tombstones, versions, ordering y private image fetch/cache.
- Cold second device y cambios alternados en dos devices.

### Fuera

- Water/goals; spec 25.
- Resolver perdiendo uno de dos cambios; spec 26.
- Remote sign-out.

## Tareas en orden

1. Añadir server change sequence/tables o mecanismo decidido y emitir cambio en misma transacción de cada mutación.
2. Implementar /sync/push y /sync/pull paginados, autorizados y cursor monotónico.
3. Hacer handlers idempotentes por user+operationId y validar baseVersion.
4. Ordenar dependencias: plate después de components, tombstone con precedencia y reusable independiente.
5. Sincronizar metadata de imagen y descargar bytes privados bajo demanda/ventana reciente.
6. Mantener storage key fuera de payload público y revalidar owner.
7. Actualizar local store en transacción por página y avanzar cursor solo al commit.
8. Detectar conflictos de version y guardar ambas representaciones para spec 26.
9. Probar bootstrap segundo teléfono, pagination, retry, cambios alternados, deletes, imágenes y sesión revocada.

## Criterios de aceptación verificables

- Un segundo teléfono obtiene food, plates, saved items e imágenes privadas del usuario.
- Crear/editar/borrar en uno converge en el otro tras sync.
- Retry de push/pull no duplica occurrences ni components.
- Ordering por local date/time permanece determinista.
- Imágenes solo se recuperan autenticadas y delete propaga tombstone/cleanup.
- Un cursor no avanza si la página local falla.
- Conflictos no se pierden y quedan marcados para spec 26.

## Notas técnicas

- El change sequence del servidor, no el reloj cliente, ordena transporte.
- Mantener payloads versionados para migración compatible.
- Signed URLs expiran y no sustituyen authorization metadata.
