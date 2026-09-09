# MiniMax para extraer nutrición desde fotografías

Fecha de revisión: 2026-09-03.

## Conclusión

Sí es técnicamente viable hacer ambos flujos con MiniMax, pero con dos
condiciones importantes:

1. La suscripción debe dar acceso a un **Token Plan de MiniMax Open Platform**
   y a su `Subscription Key`. Tener una cuenta unificada o créditos de otro
   producto MiniMax no basta para asumir acceso a la API.
2. MiniMax debe ser el **extractor visual**, no la fuente autoritativa de
   nutrición ni quien escriba directamente en el diario. El backend debe
   validar su salida, resolver alimentos contra USDA u otra fuente estructurada,
   calcular los totales y presentar un borrador para confirmación humana.

Para prototipos individuales se puede consumir la cuota del Token Plan. Para
producción, la propia FAQ recomienda pay-as-you-go debido a las ventanas de
cuota y al rate limiting dinámico del plan de suscripción
([Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq#token-plan-limits)).

No hay en la documentación pública un benchmark que garantice exactitud de OCR
en tablas nutricionales ni exactitud de ingredientes o cantidades desde un
platillo. No se debe guardar una estimación sin que el usuario la revise.

## Decisión adoptada

La implementación inicial usará la **suscripción MiniMax Open Platform Token
Plan** y su `Subscription Key` para consumir `MiniMax-M3` mediante el endpoint
compatible con OpenAI. La clave permanecerá exclusivamente en el servidor y la
cuota de la suscripción cubrirá tanto la lectura de etiquetas como el análisis
de platillos.

Esta decisión aplica al despliegue privado y al volumen inicial del proyecto.
No se usará una suscripción de MiniMax Agent ni créditos de otro producto salvo
que la consola de Open Platform confirme que están asociados al Token Plan y a
la misma `Subscription Key`.

USDA seguirá siendo la fuente nutricional principal para ingredientes. MiniMax
se limitará a extraer texto, proponer componentes y estimar cantidades; no
aportará valores nutricionales autoritativos ni persistirá resultados sin
validación y confirmación del usuario. La primera versión tampoco dependerá de
`web_search` para calcular calorías.

Se reconsiderará pay-as-you-go si el uso deja de ser privado o interactivo, las
ventanas de cuota afectan el flujo normal, se necesita capacidad predecible
para varios usuarios o se requieren garantías comerciales adicionales. Hasta
que ocurra una de esas condiciones, el Token Plan es la opción elegida.

## ¿La suscripción incluye la API?

MiniMax tiene una cuenta común para varios productos, pero dice que el acceso a
cada servicio depende del tipo de cuenta, plan, compatibilidad y región; una
cuenta no garantiza todas las funciones
([términos generales](https://www.minimax.io/terms-of-service-v2.html#unified-account)).

La distinción práctica es esta:

| Producto o saldo | ¿Sirve para estas llamadas? | Evidencia |
| --- | --- | --- |
| Open Platform **Token Plan** | Sí, para los recursos elegibles y mientras haya cuota. | En `Billing > Token Plan` se obtiene una `Subscription Key`; esa clave usa la cuota del plan y después Credits elegibles ([preparación](https://platform.minimax.io/docs/guides/quickstart-preparation), [FAQ](https://platform.minimax.io/docs/token-plan/faq#token-plan-key)). |
| Credits comprados en Open Platform | Sí, incluso sin asiento de Token Plan, mediante la misma `Subscription Key`. | Los Credits tienen la misma cobertura de recursos que Token Plan ([FAQ](https://platform.minimax.io/docs/token-plan/faq#credits)). |
| API pay-as-you-go | Sí, mediante una API key estándar y saldo de la cuenta. | La API key estándar y la `Subscription Key` son separadas y no intercambiables ([FAQ](https://platform.minimax.io/docs/token-plan/faq#api-key-interchangeable)). |
| MiniMax Agent Basic/Pro/Ultra o créditos de Agent | No asumirlo. Sus términos describen créditos para tareas del Agent, no un derecho independiente a Open Platform API. | [Términos de suscripción de Agent](https://agent.minimax.io/doc/en/credit-rules.html). |
| Hailuo, Audio, Talkie u otra suscripción de consumidor | No asumirlo; cada producto tiene términos y beneficios propios. | [Relación entre términos por producto](https://www.minimax.io/terms-of-service-v2.html#relationship-between-these-terms-and-product-terms). |

MiniMax anunció en mayo de 2026 la unión de Agent Plan y Token Plan, con créditos
compartidos entre Agent y API
([anuncio oficial](https://www.minimax.io/blog/minimax-agent-team-long-running-1779893953)).
Como las páginas legales más antiguas todavía describen Agent por separado, la
prueba operativa no debe ser el nombre comercial del recibo: hay acceso si la
consola muestra un Token Plan activo, saldo en el usage bar y una
`Subscription Key` utilizable.

## Capacidades relevantes

### Visión

`MiniMax-M3` acepta imágenes en el endpoint compatible con OpenAI Chat
Completions (`POST https://api.minimax.io/v1/chat/completions`) mediante una
parte `image_url`. Acepta URL o data URL Base64, JPEG/PNG/GIF/WebP, hasta 10 MB
por imagen y 64 MB por petición. `detail` puede ser `low`, `default` o `high`, y
se puede limitar el lado mayor con `max_long_side_pixel`
([entrada multimodal de M3](https://platform.minimax.io/docs/api-reference/text-openai-api#multimodal-input)).

También existe `API-vlm`, que recibe una imagen y devuelve texto. Con Token
Plan descuenta de la cuota según su precio equivalente; el MCP de Token Plan lo
expone como `understand_image`, con JPEG/PNG/GIF/WebP y máximo de 20 MB
([FAQ](https://platform.minimax.io/docs/token-plan/faq#api-vlm),
[guía MCP](https://platform.minimax.io/docs/guides/token-plan-mcp-guide)).

`image-01` no es la opción para OCR: es un modelo de generación y edición de
imágenes ([guía de generación](https://platform.minimax.io/docs/guides/image-generation)).

### Salida estructurada y herramientas

M3 puede llamar funciones cuyas entradas se describen mediante JSON Schema y
devuelve sus argumentos como JSON. Esto permite definir, por ejemplo,
`submit_nutrition_label` y `submit_dish_hypothesis`, validar los argumentos en
el servidor y rechazar o reintentar resultados inválidos
([Tool Use de M3](https://platform.minimax.io/docs/guides/text-m3-function-call)).

No se encontró una garantía de **Structured Outputs estricto** para M3. La
referencia que documenta `response_format: {type: "json_schema"}` restringe
esa función a `MiniMax-Text-01`, que no es el modelo visual
([referencia de Text Generation](https://platform.minimax.io/docs/api-reference/text-post)).
La lista actual de parámetros de M3 incluye `tools`, pero no `response_format`
([parámetros M3](https://platform.minimax.io/docs/api-reference/text-openai-api#minimax-m3-request-parameters)).
Por tanto, el JSON del modelo siempre debe pasar por un esquema local y por
reglas de dominio; el tool schema no sustituye esa validación.

### Búsqueda web

M3 ofrece `web_search` ejecutado por MiniMax en el servidor mediante Anthropic
Messages o OpenAI Responses. Está en **Beta** y actualmente es la única server
tool documentada
([Server Tools](https://platform.minimax.io/docs/guides/server-tools)).

No conviene usar resultados web abiertos como primera fuente de calorías. El
proyecto ya integra FoodData Central, cuya API oficial ofrece búsqueda y detalle
de alimentos y cuyos datos son de dominio público
([guía de API de USDA](https://fdc.nal.usda.gov/api-guide/)). La búsqueda web
debe ser solo un fallback con allowlist de fuentes, URL y fecha guardadas para
auditoría. La combinación mejor documentada es en dos pasos: visión por Chat
Completions y después lookup nutricional propio; no se encontró un ejemplo
oficial que combine imagen y server-side `web_search` en una sola llamada.

## Arquitectura recomendada

### Flujo 1: fotografía de una etiqueta

1. Intentar primero el flujo local de código de barras ya existente. Si Open
   Food Facts devuelve el producto, es preferible a transcribir la etiqueta.
2. Si no hay resultado, pedir consentimiento explícito para enviar la foto a
   MiniMax. Corregir orientación/recorte y quitar EXIF en el servidor.
3. Enviar una sola imagen a M3 con `detail: "high"` para texto pequeño y una
   función de salida con, como mínimo: nombre, tamaño de porción, unidad,
   porciones por envase, calorías, proteína, carbohidratos, grasa, fibra,
   azúcar y sodio. Cada valor debe incluir `value`, `unit`, `basis` y el texto
   observado como evidencia; los campos ilegibles deben ser `null`, no cero.
4. Validar tipos, rangos, unidades, separadores decimales y que no se mezclaron
   columnas «por porción» y «por envase». La comprobación 4/4/9 puede detectar
   algunos errores, pero no es prueba de exactitud porque las etiquetas
   redondean y fibra/alcoholes afectan el cálculo.
5. Mostrar foto, valores extraídos y base de medida juntos. El usuario confirma
   o corrige antes de crear un Food Entry.

### Flujo 2: fotografía de un platillo

1. M3 propone una lista de componentes visibles con nombre normalizado,
   preparación (`raw`, `cooked`, `fried`, etc.), cantidad estimada en gramos
   como intervalo, confianza y advertencias sobre aceite, salsa o ingredientes
   ocultos.
2. El usuario confirma componentes y cantidades. Cuando la masa no puede
   inferirse, se pide un peso o una selección de porción; no se convierte una
   foto automáticamente en un único número «exacto».
3. El backend busca cada ingrediente confirmado con el adaptador USDA existente
   y devuelve candidatos. El usuario o reglas deterministas eligen el alimento
   correcto, distinguiendo crudo/cocido y partes comestibles.
4. El backend calcula energía y macros por gramos con los valores elegidos. El
   modelo no hace la aritmética final ni elige silenciosamente datos de una web.
5. Se presenta un borrador con rango estimado, procedencia por ingrediente y
   total. Solo después de confirmar se crea el Food Entry o una receta
   reutilizable.

En ambos casos, separar `extract -> validate -> resolve -> calculate -> review
-> persist` evita que una alucinación tenga acceso directo a escritura. La clave
MiniMax vive solo en el servidor, con timeout, límite de tamaño, rate limit por
usuario e idempotencia; nunca llega al navegador.

## Encaje con el repositorio

El catálogo actual ya tiene la separación adecuada entre búsqueda y lectura en
[`app/catalog/food-catalog.server.ts`](../app/catalog/food-catalog.server.ts),
con adaptadores locales para
[`USDA`](../app/catalog/local-usda.server.ts) y
[`Open Food Facts`](../app/catalog/local-off.server.ts).
MiniMax debería entrar como un nuevo módulo de **image extraction**, no como un
`FoodCatalogProvider` que afirma ofrecer nutrición autoritativa.

Actualmente la tabla `food_entries` solo permite los proveedores `usda-fdc` y
`open-food-facts`, y solo sus tipos de datos asociados
([`app/database/schema.server.ts`](../app/database/schema.server.ts)). Además,
la edición existente afecta una sola ocurrencia del diario, no crea un producto
o receta reutilizable
([`app/routes/home.tsx`](../app/routes/home.tsx)). Por eso la implementación
necesitará una decisión de dominio y migración:

- **V1 de menor alcance:** crear un borrador efímero, hacer que el usuario
  confirme, y persistir una Food Entry con una nueva procedencia local explícita
  (`user-entered`/`image-assisted`) y los FDC IDs usados.
- **Producto reutilizable:** añadir entidades `custom_food`/`recipe` y
  `recipe_ingredient`; guardar la nutrición calculada, procedencia, versión y
  rango/incertidumbre. No reutilizar un ID falso de USDA u Open Food Facts.

Este cambio también contradice la expectativa actual de privacidad de la
cámara: el escáner de barcode documenta que los frames quedan en memoria y no
se transmiten ([`docs/barcode-scanning.md`](barcode-scanning.md)). La interfaz
debe diferenciar claramente «Scan barcode — local» de «Analyze photo — sent to
MiniMax».

## Coste y límites

Las cifras públicas observadas el 2026-09-03 son:

- Pay-as-you-go M3, entrada de hasta 512k tokens: **$0.30/M tokens de entrada**,
  **$1.20/M de salida** y **$0.06/M de cache read** en tier Standard. Por encima
  de 512k se duplican; Priority cuesta 1.5 veces Standard
  ([precios pay-as-you-go](https://platform.minimax.io/docs/guides/pricing-paygo)).
- La guía estima por imagen: `low`, cientos de tokens hasta aproximadamente
  600; `default`, normalmente 1k–3k y hasta aproximadamente 5k; `high`, varios
  miles y puede superar 15k. El `usage` real de la respuesta manda
  ([entrada multimodal](https://platform.minimax.io/docs/api-reference/text-openai-api#multimodal-input)).
- Como cálculo ilustrativo, una imagen `default` de 1k–3k tokens y una salida de
  500 tokens costaría alrededor de **$0.0009–$0.0015** en M3 Standard, sin
  incluir prompt adicional ni búsquedas. Una imagen `high` de 15k tokens más la
  misma salida rondaría $0.0051; 15k no es un máximo contractual.
- La página de precios actual marca **$0.01 por llamada** de `API-vlm` y
  **$0.01 por búsqueda** de `web_search`
  ([pay-as-you-go](https://platform.minimax.io/docs/guides/pricing-paygo#mcp)).
- Los límites publicados para M3 pay-as-you-go son 200 RPM y 10 millones de TPM;
  el plan o interfaz puede imponer otros límites
  ([rate limits](https://platform.minimax.io/docs/guides/rate-limits)).
- Token Plan comparte una sola cuota entre texto, imagen y voz, con ventanas
  móviles de cinco horas y semanales. Al agotarse, usa Credits elegibles, se
  cambia a pay-as-you-go o se espera el reset
  ([overview](https://platform.minimax.io/docs/token-plan/intro#after-reaching-the-usage-limit)).

Hay una inconsistencia comercial en las páginas oficiales consultadas: la guía
de precios lista Plus/Max/Ultra a **$22/$55/$132 al mes**
([pricing Token Plan](https://platform.minimax.io/docs/guides/pricing-token-plan)),
mientras que la landing de compra ha mostrado **$20/$50/$120**. También existen
snippets cacheados con precios antiguos de `API-vlm`. Los términos de servicios
pagados establecen que precio, impuestos y beneficios mostrados en checkout son
los que controlan
([Paid Services Agreement](https://platform.minimax.io/protocol/paid-agreement)).
Antes de estimar presupuesto hay que registrar el precio y la cuota que muestre
la consola de la cuenta real.

## Privacidad y retención

Una foto de comida puede incluir rostros, interior del hogar, nombres, recibos o
metadatos de ubicación. MiniMax declara que procesa Input y Output, incluido el
contenido personal que contengan; usa mensajes y contenido para operar el
servicio, seguridad y análisis/mejora, y puede explotar comercialmente una base
desidentificada o anonimizada para I+D
([política de privacidad de API](https://platform.minimax.io/protocol/privacy-policy)).
Los términos además permiten usar input y contenido generado para proporcionar,
mantener, desarrollar y mejorar los servicios
([términos de Open Platform](https://platform.minimax.io/protocol/terms-of-service)).

La política pública no promete retención cero, un plazo fijo en días ni una
exclusión general de entrenamiento. Conserva datos mientras sea necesario o
permitido según la finalidad, seguridad, calidad, reclamaciones y obligaciones
legales; después los elimina o anonimiza. Los datos se almacenan en Estados
Unidos y pueden ser procesados por MiniMax o sus proveedores
([privacidad, secciones 8 y 9](https://platform.minimax.io/protocol/privacy-policy)).

Antes de producción se recomienda obtener por escrito de `api@minimax.io`:

- DPA y rol controlador/encargado;
- retención concreta de imágenes, prompts, respuestas y logs;
- disponibilidad de zero-retention y opt-out/no-training;
- subencargados, región y mecanismo de transferencia internacional;
- proceso de borrado y respuesta ante incidentes.

La aplicación debe, como mínimo, explicar la transferencia antes de abrir la
cámara, retirar EXIF, recortar al área de comida/etiqueta, no guardar la foto por
defecto, evitar logs de request bodies y permitir cancelar o borrar el borrador.
Los términos hacen al cliente responsable de avisos y consentimientos válidos de
sus usuarios finales
([Client Data](https://platform.minimax.io/protocol/terms-of-service)).

## Riesgos y validación previa

| Riesgo | Mitigación mínima |
| --- | --- |
| Confundir porción, envase, 100 g o columnas dobles de una etiqueta | Capturar `basis`, unidad y evidencia visual; validación de coherencia; revisión humana. |
| Leer mal decimal, unidad o sodio | Esquema local estricto, límites por campo, reintento y comparación con la imagen. Nunca transformar ilegible en cero. |
| No ver aceite, salsa, relleno o peso de un platillo | Cantidades como intervalos, preguntas al usuario y advertencia visible; no mostrar falsa precisión. |
| Elegir el FDC incorrecto | Mostrar candidatos y procedencia; distinguir crudo/cocido y marca; guardar FDC ID y fecha. |
| JSON inválido o tool call omitida | Parseo seguro, reintento acotado y fallback manual. M3 no tiene Structured Outputs estricto documentado. |
| Datos web incorrectos o cambiantes | USDA/API propia primero; allowlist, URL, fecha y revisión para fallback web. |
| Cuota agotada o throttling | Timeouts, backoff, límite por usuario, circuit breaker y fallback manual; pay-as-you-go en producción. |
| Exposición de fotos o API key | Procesamiento server-side, consentimiento, EXIF removal, no body logging, límites y borrado. |

Antes de implementar el guardado automático, ejecutar una prueba con etiquetas
reales diversas —formatos estadounidense y no estadounidense, reflejos,
inclinación, texto pequeño, bilingües y columnas dobles— y platillos con receta y
peso conocidos. Medir exactitud exacta por campo, error absoluto de calorías,
tasa de corrección humana, error silencioso, latencia, tokens y costo. Para
platillos, medir intervalo y cobertura además de un promedio: un único punto no
representa la incertidumbre real. La condición de lanzamiento debería incluir
cero errores silenciosos en datos fuera de rango y confirmación humana siempre;
los umbrales de exactitud restantes deben acordarse con producto tras el piloto.
