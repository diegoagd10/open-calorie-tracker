# Investigación AFK: datos de alimentos y política de estimación

Fecha: 2026-08-02
Ticket: [05-food-data-and-estimation-policy](../issues/05-food-data-and-estimation-policy.md)
Estado: evidencia capturada y aceptada como insumo de Wayfinder; las decisiones de producto y los límites pendientes están registrados en los tickets vinculados.

## Resumen ejecutivo

- Open Food Facts es adecuado como lookup de un producto identificado por barcode, pero sus registros son colaborativos y pueden estar incompletos, localizados o marcados con problemas de calidad. Un resultado encontrado no equivale a una etiqueta nutricional verificada.
- La API v3 actual soporta lectura por barcode y campos acotados, pero no ofrece búsqueda server-side de texto libre. La API v2 sí ofrece búsqueda estructurada por tags, categorías, marcas y nutrientes; para texto libre/ingredientes hay que validar por separado Search-a-licious o mantener fallback manual.
- El POC local solo implementa lookup v3 por barcode y renderiza los valores que encuentra. No implementa búsqueda de términos/ingredientes, evaluación de calidad, conflicto de locales, reintentos, cache ni una separación persistente entre dato de fuente y estimación.
- El extractor de imagen puede producir una propuesta estructurada de ingredientes, no una medición nutricional. Structured Outputs limita la forma del JSON, no garantiza que la identificación visual sea correcta; los rechazos, respuestas incompletas y límites de imagen deben ser estados explícitos.
- Recomendación de política: permitir que un valor “sourced” entre al flujo de confirmación solo con base y procedencia visibles; mostrar faltantes como faltantes, nunca como cero; tratar todo resultado de imagen o matching genérico como candidato/estimación; y conservar siempre “enter manually” como salida de primer nivel.

## 1. Open Food Facts: capacidades y límites

### Barcode lookup

La API v3 documenta `GET /api/v3/product/{code}` para recuperar un producto por barcode y permite limitar la respuesta con `fields`. `product_type=food` restringe el lookup al tipo de producto esperado. También admite `cc`, `lc` y `tags_lc` para contexto de país/idioma. La documentación recomienda un `User-Agent` identificable con nombre, versión y URL o contacto; si el origen de consultas problemáticas no se puede identificar, podrían bloquearlo. Fuentes: [Get Product Data](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/) y [API introduction](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/).

Open Food Facts normaliza automáticamente barcodes en lecturas y escrituras, especialmente ceros iniciales. La referencia enumera EAN-8/13/14, UPC-A/12 y UPC-E, y advierte que scanners pueden agregar o quitar ceros. El producto guardado puede tener un `code` distinto del texto introducido, aunque represente el mismo barcode normalizado. Fuente: [Barcode Normalization](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-barcode-normalization/).

El POC acepta 8–14 dígitos después de eliminar cualquier carácter no numérico, no valida dígito de control y no hace su propia normalización de ceros: [src/server.js](../../../src/server.js:35). Esto es un contrato del POC, no una validación de producción. La API remota puede devolver el `code` normalizado, pero el POC no lo presenta como una decisión de matching.

### Búsqueda por términos e ingredientes

La búsqueda v2 (`/api/v2/search`) es estructurada: soporta filtros por tags, categorías, marcas y nutrientes, paginación y `fields`. Permite AND/OR/exclusión para tags y comparadores para nutrientes por 100 g o por serving. La propia documentación dice que v2 no soporta `search_term`/full-text. Fuentes: [Search Products](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v2/search/get-search/) y [API CheatSheet](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/ref-cheatsheet/).

La documentación de Open Food Facts también dice que v3 no tiene búsqueda estructurada ni full-text server-side; el endpoint v1 legado (`/cgi/search.pl`) permite keyword search pero no se recomienda para integraciones nuevas. El mismo documento remite a Search-a-licious para búsqueda full-text. Fuente: [API introduction, search and version matrix](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/).

Search-a-licious tiene un contrato separado: su API principal usa `POST`, un campo `q` con sintaxis Lucene/full-text, `langs`, `fields`, `page` y `page_size`; su documentación de query language muestra términos simples, frases, filtros de campo y rangos numéricos. El proyecto puede indexar un campo `ingredients` como texto full-text, pero ese ejemplo describe configuración del índice y no prueba por sí solo que el índice público de `search.openfoodfacts.org` exponga exactamente ese campo o las mismas versiones de datos. Fuentes: [Search-a-licious API](https://openfoodfacts.github.io/search-a-licious/users/ref-openapi/), [query language](https://openfoodfacts.github.io/search-a-licious/users/explain-query-language/) y [field configuration](https://openfoodfacts.github.io/search-a-licious/users/explain-configuration/).

La sugerencia de taxonomía de ingredientes (`suggest.pl?tagtype=ingredients&term=...`) es autocomplete de valores taxonomizados, no un lookup nutricional de un ingrediente genérico. Fuente: [API CheatSheet, suggestions](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/ref-cheatsheet/).

**Conclusión:** no se debe diseñar una búsqueda de ingredientes como si `GET /api/v3/product` o `/api/v2/search?search_terms=...` fueran un buscador libre. Hace falta un adaptador aparte y una prueba de contrato contra el índice/endpoint que se elija. Mientras ese contrato no esté confirmado, el resultado de término/ingrediente debe ser un candidato que requiere elección o entrada manual, no una nutrición exacta automática.

### Nutrición, ingredientes e incompletitud

El esquema de nutrición distingue:

- `no_nutrition_data=on`: el producto no declara datos nutricionales en el envase; el esquema indica que es un caso frecuente.
- `nutrition_data_per`: los datos de la etiqueta son por `serving` o por `100g`.
- `serving_size` y, cuando se puede calcular, `serving_quantity`.
- Para cada nutriente, `_value`/`_unit` representan lo introducido por el contribuyente; `_100g` y `_serving` son valores normalizados para una base concreta. El esquema recomienda usar estos últimos, porque `_value` puede variar en unidad y en base.
- Existe también una dimensión `_prepared` para tablas de producto preparado, distinta de “as sold”.

Fuentes: [Product-Nutrition schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/) y [Explain nutrition data](https://openfoodfacts.github.io/documentation/docs/Product-Opener/dev/explain-nutrition-data/).

El esquema de ingredientes conserva el texto crudo (`ingredients_text`), el idioma parseado (`ingredients_lc`), ingredientes normalizados/anidados y contadores como `known_ingredients_n` y `unknown_ingredients_n`. Los porcentajes de ingredientes pueden ser estimados; `ingredients_percent_analysis` distingue entre no ejecutado, estimado y un intento imposible. Fuente: [Product-Ingredients schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_ingredients/).

La calidad no se reduce a “producto encontrado”: existen `data_quality_bugs_tags`, `data_quality_errors_tags`, `data_quality_warnings_tags`, `states`, `data_sources` y fechas de revisión. Para investigar una discrepancia puntual, la API v2 ofrece `blame`, con usuario, timestamp, revisión y valor de cada campo. Fuentes: [Product-Quality schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_quality/) y [Get Product Details v2](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v2/products/get-product-by-code/).

### Rate limiting y disponibilidad operativa

La documentación pública vigente indica:

- 15 requests/min/IP para lecturas de productos (`GET /api/v*/product`).
- 10 requests/min/IP para búsquedas (`GET /api/v*/search` y `/cgi/search.pl`); desaconseja explícitamente search-as-you-type porque se puede bloquear rápidamente.
- Si se alcanzan los límites, Open Food Facts se reserva bloquear la IP. Hay además límites globales que pueden responder HTTP 503.
- Para más de unos cientos de productos, recomiendan descargar CSV/JSONL o alojar una instancia local y actualizarla con exports diarios.

Fuente: [API introduction, rate limits](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/).

El POC envía `User-Agent`, pero cualquier error no-2xx termina como error genérico y no distingue not-found de rate-limit/503: [src/server.js](../../../src/server.js:127). La consecuencia de arquitectura es una inferencia: si el backend centraliza las consultas de muchos usuarios, la IP del servidor puede concentrar tráfico y consumir el límite común; se debe confirmar el despliegue real antes de fijar una política de cache/reintentos.

## 2. Contrato local del POC

### `src/server.js`

- `lookupProduct` llama a `https://world.openfoodfacts.org/api/v3/product/{barcode}`, con `product_type=food`, `fields` reducido y `User-Agent` configurable por `OPEN_FOOD_FACTS_USER_AGENT`: [src/server.js](../../../src/server.js:112).
- HTTP 404 se convierte en `null`; el endpoint JSON devuelve 404 con `Product not found`, mientras que `/lookup` renderiza una sección HTML de error. Cualquier otro status no-OK se convierte en excepción con el status: [src/server.js](../../../src/server.js:138).
- Los campos pedidos son nombre, marca, imágenes, texto de ingredientes, serving size, `nutrition_data_per` y `nutriments`. No se piden `no_nutrition_data`, idiomas/procedencia, estados ni tags de calidad.
- `buildNutrients` decide `serving` si encuentra cualquier valor numérico `*_serving`; si no, usa `100g`. No usa `nutrition_data_per` para validar esa decisión. Renderiza únicamente nutrientes presentes y muestra “no nutrition values” si ninguno existe: [src/server.js](../../../src/server.js:94).
- La documentación de Open Food Facts dice que `*_100g`/`*_serving` ya están normalizados. El POC vuelve a consultar `${alias}_unit` para convertir unidades: [src/server.js](../../../src/server.js:75). Esa conversión debe considerarse una incertidumbre del contrato: `_unit` describe la unidad introducida, no necesariamente la unidad de los valores normalizados; antes de producción hay que probar la normalización con fixtures que cubran kcal/kJ, g/mg/µg, serving, 100 g y preparado.
- Para ingredientes, el POC elige `ingredients_text` y luego `ingredients_text_en`; no expone `ingredients_lc`, ingredientes anidados, porcentajes estimados ni advertencias: [src/server.js](../../../src/server.js:152).
- No hay endpoint de búsqueda por términos/ingredientes ni cache, backoff, clasificación de errores o persistencia de procedencia. Es una inferencia directa del único flujo implementado, no una afirmación sobre lo que la API podría añadir.

### `src/extract-ingredients.js`

- El modelo es configurable por `OPENAI_MODEL` y el default del POC es `gpt-5.6-terra`: [src/extract-ingredients.js](../../../src/extract-ingredients.js:7). La documentación oficial actual identifica ese model ID y declara input de texto/imagen, output de texto, Responses API y Structured Outputs: [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra).
- El archivo acepta `.gif`, `.jpeg`, `.jpg`, `.png` y `.webp`, lee todo el archivo y crea una Data URL base64: [src/extract-ingredients.js](../../../src/extract-ingredients.js:9). La API oficial admite Data URLs base64 y esos formatos (GIF no animado), con hasta 512 MB de payload total y 1500 imágenes por request; su lista de requisitos también pide imágenes claras y sin watermarks/logos: [Images and vision](https://developers.openai.com/api/docs/guides/images-vision).
- Envía `input_image` con `detail: "high"` y un prompt que pide ingredientes visibles o identificables con confianza, además de `is_food` y un enum `food`/`no food`. `high` es un nivel de comprensión de alta fidelidad, pero la documentación advierte que los niveles distintos de `original` pueden redimensionar y que el modelo puede generar descripciones incorrectas; el detalle no es una confianza calibrada: [Images and vision, limitations](https://developers.openai.com/api/docs/guides/images-vision).
- El schema del POC es compatible con la forma documentada de Structured Outputs: objeto raíz, propiedades requeridas, enum, array y `additionalProperties: false`: [src/extract-ingredients.js](../../../src/extract-ingredients.js:17). La guía oficial aclara que Structured Outputs garantiza adherencia al schema solo dentro del subconjunto soportado de JSON Schema; todos los campos deben ser requeridos y los objetos deben deshabilitar propiedades adicionales: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- La salida estructurada no garantiza verdad semántica. El modelo puede identificar mal un alimento, omitir ingredientes ocultos o interpretar mal texto pequeño; la propia guía de visión incluye “accuracy” y “small text” entre las limitaciones. Por ello, `ingredients` debe tratarse como propuesta para confirmar, no como una etiqueta nutricional ni como autorización para registrar calorías.
- La guía de Structured Outputs documenta refusals que pueden no seguir el schema y respuestas `incomplete` por límites de salida o filtros de contenido. El POC solo acepta `response.status === "completed"` y `response.output_text`, luego hace `JSON.parse`: [src/extract-ingredients.js](../../../src/extract-ingredients.js:97). En producción habría que distinguir al menos rechazo, incompleta, error de API/red y JSON inválido, aunque esas mejoras quedan fuera de este ticket.
- Las imágenes se procesan como tokens y cuentan para el límite TPM; también se facturan según el modelo. Fuente: [Images and vision, limitations/costs](https://developers.openai.com/api/docs/guides/images-vision). El coste, las cuotas de proyecto y el acceso al model ID no están resueltos por el POC; deben verificarse en el entorno de despliegue.

## 3. Política recomendada para los tickets de producto

1. **Sourced / barcode.** Presentar el producto encontrado como dato de fuente solo cuando exista el producto y cada nutriente mostrado tenga base explícita (`per serving` o `per 100 g/ml`). Mostrar nombre, código normalizado, locale/basis, serving size, fecha de consulta y un enlace/identificador de fuente. No convertir faltantes en cero. Si hay `no_nutrition_data`, calidad problemática, base ambigua o un conflicto de locale, mostrar “sourced but needs review” y mantener la edición manual.
2. **Búsqueda de término/ingrediente.** Usar un adaptador separado para búsqueda estructurada/full-text. No usar `/api/v2/search` como texto libre ni hacer typeahead contra los límites públicos. Un match por nombre o ingrediente es un candidato; solo tras elegir el alimento y confirmar su base puede pasar a una entrada. Si el índice público, idioma o campo de ingredientes no está confirmado, ofrecer manual directamente.
3. **Imagen.** El extractor puede proponer `food/no food` e ingredientes visibles. No debe inferir por sí solo cantidades, calorías, gramos o ingredientes ocultos. La pantalla debe permitir corregir la lista, descartar la propuesta y pasar a manual; ningún resultado de imagen se agrega al daily log sin confirmación.
4. **Conflictos e incompletitud.** Conservar los valores de la fuente y sus advertencias sin “arreglarlos” con una media o con una estimación silenciosa. Separar “missing”, “conflicting”, “estimated” y “manual”. Para un producto empaquetado, un nutrition panel legible del envase tiene prioridad para corrección del usuario; el producto de OFF sigue siendo la referencia externa que se mostró.
5. **Rate limit/fallo remoto.** Diferenciar not-found, limit/503, timeout y fallo de parsing. Ante límite o indisponibilidad, no reintentar en bucle: usar cache local cuando sea seguro, backoff acotado y entrada manual. Search-as-you-type no es compatible con la política pública documentada.
6. **Snapshot histórico.** Una vez confirmada una entrada, guardar la nutrición usada como snapshot con `source_kind` (`off`, `ai_candidate`, `manual`), base, locale y procedencia. Esto permite que una corrección futura de OFF no cambie silenciosamente un daily log histórico, en línea con el lenguaje del dominio en [CONTEXT.md](../../../CONTEXT.md).

## Incertidumbres que deben quedar abiertas

- El índice público y el contrato exacto de Search-a-licious para términos/ingredientes, idiomas, campos y disponibilidad deben probarse antes de convertirlo en dependencia de producto.
- No se estableció aquí un catálogo nutricional canónico para ingredientes genéricos ni una fórmula para convertir una lista de ingredientes de una foto en cantidades/calorías.
- La documentación de Open Food Facts describe límites por IP o por usuario según cómo lleguen las requests; falta decidir cache y despliegue del backend.
- La retención, privacidad y consentimiento para enviar imágenes a OpenAI pertenece al ticket de privacidad/local user y no se resuelve aquí.
- `gpt-5.6-terra` está documentado y soporta las capacidades usadas por el POC hoy, pero acceso, cuotas, coste, políticas de seguridad y disponibilidad futura deben verificarse en el entorno objetivo; no se debe tomar el POC como configuración de producción.

No se modificó código de runtime. El único cambio previsto para este ticket es este artefacto de investigación y el comentario/enlace que lo registra.
