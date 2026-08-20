# 21 — Ver y registrar datos offline

## Objetivo

Permitir reiniciar la app sin conexión, ver registros recientes y registrar water, favorite foods o reusable plates con respuesta inmediata local y sincronización posterior.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), sección 13, historia OCT-013.
- Requiere specs 01–20 y la arquitectura decidida por el spike 20.
- Nuevas búsquedas de Food Database pueden estar no disponibles offline.
- La ventana reciente y límites se toman del ADR 20 y se comunican honestamente.

## Alcance

### Dentro

- Cache local de días recientes, metas activas, favorites y reusable plates.
- Lectura tras cold restart offline.
- Alta offline de saved food, reusable plate y water con operation ID.
- Indicador de sync factual y replay al reconectar.

### Fuera

- Edit/delete offline; spec 22.
- Captura scans offline; spec 23.
- Búsqueda nueva de catálogo garantizada offline.

## Tareas en orden

1. Implementar schema/migrations del store elegido para entities, cache metadata y mutation queue.
2. Hidratar recent days, goals y saved items tras sesión online sin mezclar usuarios.
3. Servir la ruta diaria desde local store y distinguir empty conocido de not cached.
4. Implementar create local + enqueue atómico para water, favorite food y reusable plate.
5. Aplicar reglas de fecha/hora local e IDs globales iguales a online.
6. Mostrar pending sync sin impedir uso ni tratarlo como error moral.
7. Al reconectar, enviar operations idempotentes, aplicar acknowledgements y refrescar delta.
8. Bloquear search remota offline con mensaje y retry; no crear entry.
9. Proteger logout: limpiar datos privados locales del usuario sin borrar cambios pendientes silenciosamente; si hay pending, requerir confirmación y política documentada.
10. Probar airplane mode, cold restart, reconnect, retry, storage quota, dos usuarios y eviction.

## Criterios de aceptación verificables

- Tras sincronizar y reiniciar offline, los días dentro de la ventana y saved items se ven.
- Water/favorite/reusable plate se registran offline y sobreviven restart.
- Reconectar crea una sola ocurrencia servidor por operation ID.
- Search nueva informa unavailable y no altera Food Log.
- Eviction nunca elimina pending mutations o imágenes.
- Cambiar usuario no expone cache ajena.
- Estados pending son accesibles y neutrales.
- Tests simulan red sin esperar tiempo real.

## Notas técnicas

- La UI lee primero local y reconcilia delta, evitando dos fuentes de estado independientes.
- Registrar ack antes de retirar operation de queue.
- Medir quota y presentar recuperación; no borrar datos del usuario silenciosamente.
- La sesión persistente permite uso offline solo si existe credencial local válida y política del ADR.
