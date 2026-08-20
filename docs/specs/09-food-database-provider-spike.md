# 09 — Spike de API de base de alimentos

## Objetivo

Seleccionar la API/catálogo que alimentará búsqueda, medidas, nutrición y, si es viable, resolución por barcode. Producir un adapter probado y un ADR que desbloqueen la spec 10 y definan claramente la cobertura real.

## Contexto y dependencias

- Fuente de verdad: PRD.md, secciones 7.1, 7.2, 8 y decisión pendiente de mercado; historias OCT-004 y OCT-009.
- Requiere specs 01–03 y contratos de dominio existentes; no requiere UI.
- El producto solo permite seleccionar items existentes y debe soportar nutrientes faltantes, medidas y snapshots.
- La prioridad geográfica sigue abierta; el spike debe hacer visible cómo cambia la elección según mercado.

## Alcance

### Dentro

- Comparar al menos tres APIs/datasets con documentación primaria y muestras reales.
- Evaluar búsqueda textual, detalle, porciones/medidas, imágenes, nutrientes primarios/adicionales y lookup UPC/EAN.
- Probar mapping, latencia, rate limit, licencia, costo, cobertura y términos de cache/snapshot.
- Elegir proveedor principal y fallback, o documentar bloqueo.

### Fuera

- UI y persistencia de entradas; spec 10.
- Escaneo/cámara e imagen privada; specs 15–17.
- Contratar o publicar claves sin autorización.
- Ingredientes: aunque el proveedor los devuelva, se descartan.

## Tareas en orden

1. Confirmar con owner el mercado inicial usado para puntuar; si falta, evaluar al menos US y declarar el supuesto.
2. Crear matriz común para búsqueda, UPC/EAN, nutrients, serving units, imágenes, localización, SLA, costo, rate limit, licencia, cache y privacidad.
3. Investigar al menos tres opciones mediante docs/terms oficiales y guardar enlaces/fecha en docs/decisions/009-food-provider.md.
4. Ejecutar probes opt-in para diez queries y diez barcodes representativos, incluyendo cero resultados, duplicados, datos parciales y productos sin imagen.
5. Medir calidad de resultados, campos nulos, p50/p95 local observada, errores y cuotas; no presentar muestras pequeñas como cobertura estadística.
6. Definir FoodCatalogProvider.search y lookupBarcode con DTO normalizado, timeout, cancelación y errores tipados.
7. Implementar un adapter experimental del candidato principal y contract tests grabados/sintéticos legales; la suite obligatoria no usa red.
8. Definir qué datos pueden persistirse como snapshot histórico y por cuánto tiempo según licencia.
9. Escribir ADR con ranking, decisión, fallback, costos, cobertura conocida, gaps y condición de reevaluación.

## Criterios de aceptación verificables

- El ADR compara al menos tres opciones con fuentes primarias y fecha.
- Existe evidencia reproducible para search, no-results, partial nutrients, units, image y UPC/EAN.
- Se selecciona un proveedor que permite legalmente los snapshots requeridos o se documenta un bloqueo con owner.
- El contrato normaliza missing como null y nunca almacena ingredientes.
- La spec 10 puede implementar search/log sin decidir campos ni errores; la 16 conoce si barcode usa el mismo proveedor.
- Probes son opt-in y pnpm test pasa offline.

## Notas técnicas

- “Food Database API” no significa acceso directo desde el navegador: las claves y mapping viven en apps/api.
- Separar provider ID de ID interno para conservar snapshots y cambiar de vendor.
- Tratar URLs de imagen remotas según licencia; no asumir permiso para copiarlas.
- No ocultar falta de cobertura: la UI debe poder mostrar no results sin crear una entrada.
