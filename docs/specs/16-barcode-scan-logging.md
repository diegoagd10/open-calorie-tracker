# 16 — Registro mediante barcode

## Objetivo

Permitir escanear un barcode online y registrar inmediatamente una porción cuando se resuelve, conservando la imagen capturada; todo fallo crea una entry visible, no nutricional, retryable o terminal.

## Contexto y dependencias

- Fuente de verdad: PRD.md, secciones 7.2, 8.1 y 13, historia OCT-009.
- Requiere specs 01–15, especialmente proveedor/catalog 09, Food Log/summaries y decisiones de scan/storage 15.
- La imagen no puede borrarse separadamente. Failed/pending no afectan totals.
- Offline pending se implementa en spec 23.

## Alcance

### Dentro

- Captura, upload privado, decode/lookup, success inmediato y una porción.
- Imagen en card, retry rápido y fallo terminal con detail/delete.
- Autorización, idempotencia, cleanup y tests.

### Fuera

- Foto de nutrition label; spec 17.
- Offline scan; spec 23.
- Entrada manual o estimación desde foto de comida.

## Tareas en orden

1. Añadir source=barcode, error classification e imagen requerida para outcomes de scan.
2. Implementar POST /days/:date/barcode-entries multipart con timezone, clientNow e Idempotency-Key.
3. Validar/re-encodear imagen, guardar privado y resolver barcode con adapter decidido.
4. En success, obtener snapshot autorizado del catálogo y crear una porción successful con imagen.
5. En retryable failure, crear failed sin nutrition, mensaje claro e imagen, con Retry.
6. En terminal failure, crear failed sin nutrition, detail comprensible e imagen, con Delete.
7. Implementar POST /food-entries/:id/retry reutilizando imagen y misma entry.
8. Servir imagen solo a owner mediante stream o URL corta; ajenos reciben 404.
9. Extender DELETE con outbox para hacer imagen inaccesible y borrarla fiablemente.
10. Habilitar Scan Barcode en Add Food y mostrar estados accesibles/newest-first.
11. Probar success, no-match, timeout, terminal, retry, idempotencia, aislamiento, totals y cleanup.

## Criterios de aceptación verificables

- Un scan exitoso crea inmediatamente una porción y muestra la imagen capturada.
- Todo fallo crea una card visible sin contribuir totals.
- Retryable ofrece Retry y actualiza la misma entry; terminal muestra detail y Delete.
- La imagen no tiene delete independiente ni URL pública.
- Borrar entry vuelve imagen inaccesible y el outbox completa el borrado.
- Catálogo no-match no fabrica un alimento ni valores cero.
- Futuro se rechaza y reglas de hoy/pasado se respetan.
- Tests usan fakes y pnpm verify pasa sin cámara/red real.

## Notas técnicas

- La imagen capturada es requerida aunque el código se decodifique localmente.
- No aceptar nutrition enviada por web; resolver/mapping ocurre en API.
- Redactar barcode si logs externos pudieran asociarlo a identidad.
- Mantener checksum para idempotencia, no como identificador visible.
