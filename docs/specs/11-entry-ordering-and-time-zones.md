# 11 — Orden de entradas y zonas horarias

## Objetivo

Completar las reglas temporales del Food Log para altas actuales y retroactivas, garantizando orden newest-first determinista y que viajar entre zonas no mueva entradas históricas de fecha.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), secciones 5.1 y 8, historia OCT-005.
- Requiere specs 01–10: navegación por fecha y alta de catálogo para hoy.
- food_entries persiste local_date, time_minutes, timezone, created_at e ID.
- Los duplicados intencionales están permitidos; reintentos técnicos se deduplican por idempotency key.

## Alcance

### Dentro

- Altas de food en cualquier fecha pasada.
- Regla de hora para hoy, pasado vacío y pasado con entradas.
- Orden determinista a 23:59, concurrencia y DST.
- Pruebas de viajes y límites de calendario.

### Fuera

- Mover una entrada existente entre fechas.
- Offline/conflicts; specs 20–26.
- Plates y su hora propia; specs 18–19.

## Tareas en orden

1. Centralizar en dominio assignEntryTime(selectedDate, now, timezone, newestEntry).
2. Validar zona IANA y calcular hoy local en servidor con clientNow acotado.
3. Para hoy, asignar la hora local actual al crear.
4. Para pasado vacío, asignar 12:00 PM (720).
5. Para pasado con entradas, asignar un minuto después de la hora más nueva.
6. Si la hora más nueva es 23:59, conservar 23:59 y desempatar por created_at e ID; no pasar al día siguiente.
7. Serializar la lectura/asignación/escritura por usuario+fecha o usar retry transaccional para concurrencia.
8. Habilitar alta desde la UI de cualquier día pasado y mantener todas las acciones deshabilitadas para futuro.
9. Persistir la fecha como identidad inmutable; PATCH nunca acepta local_date.
10. Probar medianoche, DST spring/fall, zonas con offset no entero, dos altas concurrentes, duplicados y viaje posterior.

## Criterios de aceptación verificables

- Hoy usa la hora local actual; pasado vacío usa 12:00; pasado con entradas usa newest+1 minuto.
- Dos altas concurrentes quedan en orden determinista sin perder ninguna.
- Una entrada retroactiva nunca salta al día siguiente, incluso cuando el último evento es 23:59.
- Cambiar la zona del dispositivo y recargar conserva local_date y hora histórica.
- Una request futura falla sin escribir y ningún PATCH puede mover fecha.
- Duplicados intencionales permanecen separados; el mismo idempotency key no duplica.
- La lista siempre es newest-first con el mismo orden en DB, API y UI.

## Notas técnicas

- No usar new Date('YYYY-MM-DD') para fechas de negocio.
- Guardar instantes UTC para auditoría, pero no reconstruir local_date desde ellos.
- Documentar la política del caso 23:59 porque varios eventos compartirán hora visible.
- Usar reloj/IDs inyectables para evitar tests dependientes del sistema.
