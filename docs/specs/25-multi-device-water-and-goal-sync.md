# 25 — Sincronizar water y cambios de metas

## Objetivo

Aplicar el protocolo multi-device a water events y goal versions, preservando cantidades, horas y vigencia histórica en todos los teléfonos.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), secciones 11–13, historia OCT-017.
- Requiere specs 07, 08, 20–22 y 24.
- Goals son effective-dated y no se sobrescriben como un único registro.
- Water usa eventos independientes; duplicate intencional es válido.

## Alcance

### Dentro

- Push/pull, versions/tombstones e idempotencia para water y goals.
- Recalculo local de progress con goal efectiva.
- Dos teléfonos, offline changes y dates/timezones.

### Fuera

- Conflicto irreconciliable final; spec 26.
- Recomendaciones de metas o remote session management.

## Tareas en orden

1. Emitir change records atómicos para create/update/delete water y upsert goal version.
2. Extender payload/version del protocolo sin romper clientes de spec 24.
3. Sincronizar water por event ID y operation ID, manteniendo local_date/time.
4. Sincronizar cada goal_version por effective_date; no convertirlas en latest-only.
5. Recalcular summaries de cada día afectado después del commit local.
6. Detectar dos ediciones de la misma entidad/fecha base y conservar conflicto para spec 26.
7. Probar bootstrap, pagination, offline retry, goal retroactiva, water duplicate/delete y zonas.

## Criterios de aceptación verificables

- Water creada/editada/borrada converge entre dos teléfonos sin cambiar fecha/hora.
- Goal version aparece con la misma effective_date y cambia solo días correspondientes.
- Retry no duplica water ni goal versions.
- Historial de metas anterior permanece disponible.
- Summary local coincide con API después de sync.
- Conflictos quedan preservados, no last-write-wins silencioso.

## Notas técnicas

- Una goal version usa clave estable user+effectiveDate o ID global con constraint equivalente.
- Recalcular días desde la fecha efectiva puede ser costoso; invalidar por rango de forma paginada.
- No sync de datos de perfil de salud porque no existen.
