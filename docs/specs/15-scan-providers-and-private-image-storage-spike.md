# 15 — Spike de scanning y almacenamiento privado

## Objetivo

Resolver antes de implementar scans qué tecnología se usará para captura, lookup de barcode, extracción de etiquetas y almacenamiento privado de imágenes, con privacidad, errores y borrado comprobados.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), secciones 7.2, 7.3, 8.1 y 13; historias OCT-009, OCT-010 y OCT-015.
- Requiere la decisión de catálogo 09 y las entries editables de spec 13.
- Barcode necesita resolver UPC/EAN y retener la imagen capturada. Label necesita extraer nutrition facts parciales y nombre opcional.
- Ninguna foto puede quedar pública o enviarse a un tercero no aprobado.

## Alcance

### Dentro

- Evaluar captura Ionic/Capacitor, resolución barcode, OCR/extraction y object storage.
- Comparar al menos tres opciones por categoría donde haya decisión externa.
- Probes de éxito, partial, retryable, terminal, private access y delete.
- ADR(s), contratos y clasificación de errores para specs 16, 17 y 23.

### Fuera

- UI final y entradas reales; specs 16–17.
- Contratación/despliegue irreversible.
- AI de fotos de comidas e ingredients.

## Tareas en orden

1. Confirmar si el proveedor 09 cubre lookupBarcode con calidad/licencia suficiente; comparar alternativa si no.
2. Comparar extracción de label por exactitud de siete nutrientes, partial data, nombre opcional, costo, latency, región, retention y training-use.
3. Comparar object stores por private access, signed URLs/streaming, lifecycle, encryption, delete guarantees, región y costo.
4. Probar captura JPEG/PNG/HEIC, orientación, tamaño, metadata stripping y experiencia web/dispositivo.
5. Definir BarcodeResolver, NutritionLabelExtractor y PrivateObjectStore con fakes/contract tests.
6. Definir retryable versus terminal y mensajes seguros; no guardar raw OCR o ingredients.
7. Prototipar upload→process→delete y demostrar que otro usuario/no autenticado no accede.
8. Documentar límites de 10 MiB, formatos, timeout, checksum, idempotencia y cleanup/orphans.
9. Escribir ADR con decisiones, evidencia, privacidad, costos, fallback y owners.

## Criterios de aceptación verificables

- Las decisiones de barcode, extraction y storage tienen evidencia y fuentes primarias fechadas.
- Un probe demuestra success, partial, retryable, terminal y delete privado.
- Los contratos permiten tests offline y separan mensajes públicos de detalles internos.
- Está documentado si barcode reutiliza proveedor 09 o cuál adapter adicional requiere.
- Ningún probe versiona fotos, secretos, OCR bruto o URL pública permanente.
- Specs 16/17 pueden implementarse sin otra selección tecnológica.

## Notas técnicas

- Un spike puede concluir bloqueado si privacidad/licencia no es aceptable; debe nombrar owner y condición de salida.
- Re-encodear imágenes elimina geolocation, pero conservar legibilidad de la etiqueta.
- Diseñar storage_key opaca y borrado mediante outbox desde el principio.
