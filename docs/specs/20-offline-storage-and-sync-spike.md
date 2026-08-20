# 20 — Spike de almacenamiento offline y sincronización

## Objetivo

Seleccionar y probar la arquitectura local-first que permitirá ver/loggear offline, encolar mutaciones, procesar imágenes y sincronizar múltiples teléfonos sin pérdida silenciosa.

## Contexto y dependencias

- Fuente de verdad: PRD.md, sección 13 e historias OCT-013–OCT-018.
- Requiere specs 01–19: modelos reales de food, water, goals, favorites, plates e imágenes.
- El PRD exige preservar ambos cambios irreconciliables como registros separados.
- El spike debe decidir persistencia Ionic/web, protocolo sync, IDs, cursors, tombstones e idempotencia antes de escribir features offline.

## Alcance

### Dentro

- Comparar almacenamiento local compatible con web y targets móviles.
- Prototipar cache reciente, mutation queue, restart, retry, tombstone, image queue y delta sync.
- Definir conflict model que distingue duplicates intencionales, retries y competing edits.
- ADR y contratos bloqueantes para specs 21–26.

### Fuera

- Funcionalidad offline final.
- Background execution garantizada por OS.
- Realtime/social collaboration.

## Tareas en orden

1. Definir escenarios y volumen: cold restart offline, varios días recientes, saved items, imágenes grandes, dos teléfonos y borrados.
2. Comparar al menos dos stores compatibles (por ejemplo SQLite nativo/IndexedDB abstraction) por atomicidad, migrations, encryption, capacity y testing.
3. Diseñar IDs client-generated globales, operation IDs, entity version, server cursor, tombstones y idempotency.
4. Prototipar write local + queue atómica, cierre de proceso, restart y replay sin duplicar.
5. Prototipar delta pull/push Hono con auth, pagination, retry/backoff y acknowledgement.
6. Probar imagen offline separada de metadata, upload resumable/retry y cleanup.
7. Definir ventana “recent records” garantizada por días/bytes y comportamiento de eviction que nunca quite cambios pendientes.
8. Diseñar merge por entidad y preservación como copia para conflicto irreconciliable.
9. Definir observabilidad, límites, schema migrations y recovery de cola corrupta.
10. Escribir ADR con elección, diagramas, contratos, riesgos, rollout y kill switch.

## Criterios de aceptación verificables

- El ADR selecciona store/protocolo y define recent window explícita.
- Un prototype sobrevive restart y reenvía una mutación exactamente una vez lógicamente.
- IDs, operation IDs, cursors, versions y tombstones tienen formato/semántica inequívocos.
- Un prototype de imagen se recupera de fallo sin orphan permanente.
- Existen ejemplos para duplicate intencional, retry y conflicto preservado.
- Specs 21–26 pueden implementar sin reabrir arquitectura básica.
- Tests del prototype son locales y deterministas.

## Notas técnicas

- Offline-first exige que la escritura local y queue compartan transacción.
- No confiar en timestamps del cliente para last-write-wins.
- Cifrado local y protección de imágenes deben considerar dispositivo perdido; documentar límites reales de plataforma.
- El servidor sigue siendo autoridad de ownership, no del orden de intención offline.
