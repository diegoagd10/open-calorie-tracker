# 23 — Captura y procesamiento de scans offline

## Objetivo

Permitir capturar barcode o nutrition label offline, crear inmediatamente una entry Pending con imagen preservada y procesarla automáticamente al recuperar conectividad.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), sección 13, historia OCT-015.
- Requiere specs 15–17 y 20–22: scans online, storage privado, local image queue y sync.
- Pending no tiene nutrición utilizable ni afecta totals.
- Si procesamiento posterior falla, cambia a retryable o terminal estándar.

## Alcance

### Dentro

- Persistencia local privada de imagen y metadata de barcode/label.
- Entry Pending visible y newest-first.
- Upload/process queue, resume/retry, transition success/failed y cleanup.

### Fuera

- Procesar completamente sin red.
- Merge multi-phone general; specs 24–26.
- Photo meal AI.

## Tareas en orden

1. Extender local schema con scan kind, image blob/file ref, checksum, upload state y operation ID.
2. Capturar/normalizar imagen offline y escribir entry Pending + imagen + queue atómicamente.
3. Asignar fecha/hora con reglas locales; futuro permanece bloqueado.
4. Renderizar Pending card con imagen y texto accesible, sin nutrition.
5. Al reconectar, subir de forma resumable/idempotente al private storage.
6. Invocar pipeline barcode/label correspondiente y actualizar la misma entry a successful o failed.
7. Para retryable ofrecer quick retry; terminal detail/delete.
8. Limpiar blob local solo después de confirmar disponibilidad privada servidor y conservar cache según ADR.
9. Manejar cancel/logout/quota/crash sin orphan o pérdida silenciosa.
10. Probar ambos scan kinds, restart, pérdida de red media-upload, duplicate retry, partial label y cleanup.

## Criterios de aceptación verificables

- Capturar offline crea Pending inmediato con imagen y cero contribución a totals.
- Pending e imagen sobreviven cold restart.
- Reconectar procesa una sola entry y conserva local_date/order.
- Success suma nutrition; failures adoptan acciones estándar sin fabricar datos.
- Retry reutiliza misma entry/imagen.
- Quota o archivo inválido produce error antes de una entry incompleta oculta.
- Cleanup no elimina la única copia antes del ack.

## Notas técnicas

- Cifrar/proteger blob según capacidades del store elegido.
- Separar estado de upload de estado de extracción.
- Checksum ayuda a reanudar/deduplicar retry, no a deduplicar consumos distintos.
