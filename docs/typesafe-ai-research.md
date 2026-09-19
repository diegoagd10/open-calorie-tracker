# TypeSafe AI: encaje proporcional en Open Calory Tracker

Fecha de revisión: 2026-09-18.

## Conclusión

No hay una integración indispensable hoy. La aplicación ya resuelve el cálculo, la persistencia y los catálogos con código y permite revisión humana del análisis de fotografías. Las dos oportunidades razonables son **reordenar una lista pequeña de alimentos ambiguos** y **auditar errores semánticos en el texto producido por el análisis de fotos**. Ambas requieren demostrar una mejora frente a reglas y aliases; no hay mediciones del proyecto que prueben ese beneficio todavía.

Estas recomendaciones son inferencias de diseño contrastadas con la inspección del repositorio realizada en esta investigación, no resultados de un experimento con la API. No se instaló TypeSafe, no se envió información de usuarios y no se cambió código de la aplicación.

## Alcance de la lectura

Se recuperó el índice oficial [`llms.txt`](https://docs.typesafe.ai/llms.txt), se descargaron las **109 páginas Markdown que enumera** y se revisaron sus conceptos, restricciones, referencias de SDK/API y cookbooks. Se contrastaron las páginas relevantes mediante sus versiones web y los tres documentos legales enlazados. El inventario completo aparece al final.

La lectura incluye documentación y ejemplos publicados; no incluye reproducir llamadas, verificar cachés experimentales, ejecutar notebooks, ver el video externo de Loom ni auditar exhaustivamente el código fuente enlazado de los SDKs. Eso limita las conclusiones sobre calidad, costos reales y disponibilidad.

El navegador de investigación no pudo abrir `llms.txt`; la descarga HTTP sí funcionó. Ninguna de las 109 páginas del índice quedó inaccesible por HTTP. El enlace adicional `/cookbooks`, citado por Agent skill pero ausente del índice, falló en la herramienta web; su descarga HTTP en Markdown respondió con la página ya indexada Self-consistency: nouls. Las 18 páginas individuales de cookbooks sí se recuperaron.

## Qué ofrece realmente

TypeSafe presenta Jev como un modelo de decisiones acotadas: recibe texto o JSON y devuelve resultados tipados, sin redactar respuestas ni explicar razonamientos. La salida depende de opciones o criterios que define la aplicación. El modelo **no admite imágenes, audio ni video**; convertir una fotografía en texto exige otro modelo o extractor primero. [System One](https://docs.typesafe.ai/concepts/system-one).

| Primitiva | Uso real | Consecuencia para este proyecto |
| --- | --- | --- |
| Choice | Elegir entre opciones conocidas, con probabilidades y confidence; hasta 255 opciones. | Puede sugerir un candidato de un shortlist, incluyendo `none`. No descubre alimentos ausentes de la lista. |
| Score | Distribución sobre 2–10 niveles descritos; el valor es la media de sus índices. | Sirve para una rúbrica de relevancia, no para estimar gramos o calorías interpolando cifras. |
| Noul | Probabilidad de un sí/no; sin campo confidence separado. | Puede marcar una relación semántica concreta, por ejemplo solapamiento entre componentes descritos. |

Fuentes: [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul).

Las preguntas independientes comparten el estado y se evalúan juntas; una respuesta no alimenta a otra dentro de esa petición. Las dependencias que requieren obtener nuevos datos se resuelven en código con otra llamada. El estado debe contener solo evidencia pertinente. [Primitives](https://docs.typesafe.ai/primitives), [State](https://docs.typesafe.ai/concepts/state).

`confidence` se deriva de la forma de la distribución de Choice/Score. No es una verificación externa ni una garantía de que el alimento elegido sea correcto. Sus umbrales deben ajustarse usando ejemplos etiquetados del dominio. [Confidence](https://docs.typesafe.ai/confidence).

## Precio, límites y madurez

A esta fecha, la página de modelos publica `jev-1.13.0`, con los aliases `jev-latest` y `jev-preview` apuntando a él. Cobra **USD 0.042 por millón de tokens de entrada**, con salida gratis; admite 64k tokens en estado y preguntas combinados y 32k en estado más la pregunta más larga. Publica 1,200 RPM y 250,000 tokens/s, advirtiendo que los límites cambian dinámicamente. El entrenamiento privilegia inglés; otros idiomas requieren validación. No ofrece fine-tuning/LoRA por cliente. [Models](https://docs.typesafe.ai/models).

Cálculo ilustrativo propio, con esa tarifa: una petición de 2,000 tokens cuesta USD 0.000084; 10,000 peticiones semejantes, USD 0.84. El número de tokens real debe incluir estado y criterios. Esto no estima la latencia, el costo de otro modelo o el tiempo de implementar y mantener la integración.

El precio por tokens favorece un experimento pequeño, pero el costo dominante para una aplicación privada puede ser añadir proveedor, configuración, dependencia de red, revisión de prompts y casos de fallo. No se verificó saldo mínimo, checkout, descuentos ni acceso de una cuenta real.

La documentación declara consultas habituales cercanas a 100 ms; esto es una afirmación del proveedor, no un p95 medido desde este despliegue ni un SLA. [How to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).

El SDK JS publicó su primera versión pública 0.5.7 el 2026-09-11 y 0.6.0 el 2026-09-15, cambiando la representación de Score.criteria; Python publicó 0.7.0 el 2026-09-18 con cambio de serialización a Pydantic. Esto indica una interfaz reciente y activa, con cambios incompatibles concretos, no demuestra falta de fiabilidad. [JS changelog](https://docs.typesafe.ai/sdk/javascript/changelog), [Python changelog](https://docs.typesafe.ai/sdk/python/changelog).

## Restricciones que importan aquí

Jev 1.13 reconoce problemas con precisión numérica, conteo, fechas, negaciones/indirección, contexto irrelevante y contenido adversarial. No deben suponerse identidades entre preguntas independientes: una Noul y su negación pueden no sumar uno; Choice y Noul tampoco son intercambiables. La documentación recomienda conservar aritmética e invariantes en código y seleccionar valores candidatos previamente extraídos. [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

Por tanto, una salida válida por esquema no demuestra corrección semántica. Un verificador textual tampoco detecta lo que el extractor visual omitió de la imagen: no puede confirmar aceite invisible, ingredientes ocultos o masa real si esa evidencia no llegó al texto.

Existe una inconsistencia documental en los presupuestos de contexto: Primitives habla de aproximadamente 32k para el presupuesto compartido, mientras Models distingue 64k total y 32k para estado más pregunta más larga. Para diseñar, tomar Models como referencia más específica y confirmar mediante la API antes de acercarse al límite. [Primitives](https://docs.typesafe.ai/primitives), [Models](https://docs.typesafe.ai/models).

## Qué evidencia publican los ejemplos

Todos los siguientes son ejemplos o experimentos **del proveedor**. No se reprodujeron, no son benchmarks nutricionales y no garantizan una mejora en esta aplicación.

| Ejemplo | Evidencia publicada | Límite para nuestra decisión |
| --- | --- | --- |
| [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe) | En 40 consultas legales, shortlist BM25 de 30: top1 5% → 18%, top10 38% → 62%. | Solo reordena candidatos recuperados; no mide selección USDA ni consultas españolas. |
| [SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade) | Extraer → verificar por campo → escalar; gráfica interna sobre 100 prompts de extracción textual. El fallo del ejemplo inicial está hard-coded. | No prueba verificación visual. La calidad de otro proveedor/modelo en este proyecto requiere medición propia. |
| [Self-consistency: choices](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook) | Un post, 8 preguntas, 15 repeticiones; acuerdo 90.8%, o 99.2% con abstención y 74.2% de respuestas automáticas. | Repetibilidad no es exactitud; el propio ejemplo admite que otro modelo supera el acuerdo aquí. |
| [Self-consistency: nouls](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook) | Un reclamo de seguro, 14 preguntas, 15 repeticiones; probabilidades fronterizas cruzan 0.5. | Una banda de revisión reduce acciones contrapuestas, sin demostrar que las acciones sean correctas. |
| [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions) | Documento largo y 13 preguntas: batching ahorra tokens frente a enviar el documento 13 veces. | El ahorro temporal compara llamadas secuenciales; no justifica añadir preguntas innecesarias. |
| [Entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment) | 450 pares candidatos de catálogos de cerveza; rutas distinto/revisión/mismo. | Posible analogía para duplicados, pero fusionar fuentes nutricionales es un problema distinto y más costoso. |
| [Pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook) | Regex encuentra spans; Choice selecciona el rol; código normaliza el valor. | Buen patrón para texto de etiqueta ya extraído; no sustituye OCR ni validaciones numéricas actuales. |
| [Citation checking](https://docs.typesafe.ai/cookbooks/citation_check) | Primero string match, luego juicio de soporte contextual; 8 citas con fallos plantados. | Analogía para comprobar respaldo textual de preparación; muestra pequeña y sin evidencia de fotos. |
| [Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) | Filtra pertinencia, contradicciones e inyección en un corpus pequeño. | El propio texto dice que el filtro no constituye una frontera de seguridad. |

También se revisaron búsqueda por líneas, recuperación de formato, function calling, sugerencia de skills, guardrails, extracción de fechas, clasificación jerárquica, autoresearch/CatBoost y clasificación SEC mediante confidence. Son patrones válidos para sus tareas; no hay necesidad de añadir esas capacidades al diario actual. La elección de funciones con enums no cubre números/texto libre sin un paso adicional. [Function calling](https://docs.typesafe.ai/cookbooks/function_calling).

## Dos oportunidades proporcionales

### 1. Sugerir el alimento más pertinente entre candidatos existentes

**Hipótesis de valor:** reducir el tiempo que tarda el usuario en elegir una variante cuando la búsqueda ya devuelve varios alimentos plausibles. Un ejemplo de evaluación sería discriminar preparación cruda/cocida o nombre alternativo, no una afirmación de que el sistema actual falle en ese ejemplo.

La búsqueda USDA actual usa FTS local, prefijos y un conjunto pequeño de aliases; OFF se consulta por barcode. Si falta el candidato correcto o no hay resultados, reordenar no ayuda. Antes del modelo conviene ampliar aliases demostrablemente útiles y reglas de preparación. Referencias locales: [local-usda.server.ts](../app/catalog/local-usda.server.ts), [local-off.server.ts](../app/catalog/local-off.server.ts).

Experimento limitado: obtener 5–25 candidatos por el mecanismo existente; preguntar una Choice con IDs y `none` cuando la selección siga siendo ambigua. Enviar únicamente consulta, nombre, categoría y preparación pertinentes. Mostrar sugerencia y candidatos; conservar selección humana y aritmética actual. Un error, timeout o resultado incierto vuelve al orden local. Choice solo puede devolver opciones presentes, incluida la salida explícita que evita forzar una coincidencia. [Choice](https://docs.typesafe.ai/primitives/choice), [Line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find).

No introducir RAG, base vectorial, agentes autónomos ni clasificación masiva del catálogo para probar esta hipótesis.

### 2. Auditar errores semánticos del análisis de fotografías

**Hipótesis de valor:** encontrar componentes descritos con palabras distintas que se solapan, o una preparación propuesta sin respaldo en el texto disponible. Por ejemplo, contar un plato compuesto y parte de sus ingredientes como componentes separados.

El flujo ya tiene corrección libre, selección de preparación, instrucciones contra solapamiento y validación de duplicados exactos, además de revisión humana. Referencias locales: [photo-analysis.md](photo-analysis.md), [result.server.ts](../app/photo-analysis/result.server.ts). El proveedor Pi actual emplea Luna con esfuerzo bajo y un plazo global de 20 segundos; no hay razón medida para agregar una cascada completa de modelos.

Primera etapa: evaluación privada fuera del flujo del usuario, sobre texto de borradores etiquetados; una pregunta acotada por relación que se desea revisar. Solo pasar a modo de observación si el verificador detecta errores que reglas e instrucciones existentes omiten y tiene pocos falsos positivos. No verificar foto, peso o calorías mediante este modelo textual. El patrón de verificar campos puede inspirar el experimento, sin adoptar sus resultados internos como garantía. [SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade).

## Casos que no compensan hoy

- Calcular calorías/macros, convertir unidades o decidir rangos numéricos con Score: código ya lo calcula y el proveedor desaconseja precisión numérica. [Jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
- Reemplazar visión/OCR: la entrada es solo texto. [System One](https://docs.typesafe.ai/concepts/system-one).
- Reparar datos OFF, inferir nutrición faltante o hacer que las importaciones de millones de productos dependan del modelo: no hay fuente nutricional autoritativa nueva ni beneficio validado.
- Chatbot, coach, puntuación moral de comidas o gamificación: contradicen el objetivo explícito del [README](../README.md) de registrar progreso factual sin coaching ni juicio.
- Clasificar intención para elegir entre botones ya explícitos: añade red para resolver una decisión que la interfaz conoce.
- Guardrail genérico como frontera de seguridad: no sustituye validación, autorizaciones o aislamiento; el modelo admite susceptibilidad a contenido adversarial. [Jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
- Fusionar automáticamente registros USDA/OFF: identidad, variantes y bases nutricionales requieren procedencia y reglas; un juicio semántico no basta para mutar catálogos.
- Autoresearch, CatBoost o recomendaciones predictivas: faltan datos etiquetados y un problema de producto que lo justifique.

## Evaluación antes de decidir

No implementar una dependencia de producción por la tarifa o una demo. Preparar 50–100 consultas reales etiquetadas y comparar orden actual, aliases/reglas mejorados y Jev opcional. Medir presencia del candidato correcto en el shortlist por separado de top1/top3, tiempo de selección, regresiones, abstenciones y resultados en español.

Como criterio inicial **propuesto, no observado ni contractual**, exigir una mejora de alrededor de 15 puntos porcentuales en top3 para los casos ambiguos, sin empeorar los fáciles, y latencia adicional p95 menor de un segundo con fallback. Ajustar estos criterios a la frecuencia y gravedad del problema real antes de probar.

Para fotos, reunir 50–100 borradores con etiquetas humanas sobre solapamiento/preparación; comparar reglas existentes y verificador, medir precisión/recall, falsos positivos, correcciones evitadas y latencia. No confundir concordancia entre dos modelos con corrección contra evidencia visual. Mantener un conjunto final que no se use al escribir los criterios.

Si los aliases/reglas resuelven la mayoría o los fallos semánticos son infrecuentes, detener la integración. Un piloto pequeño ayuda a descartar complejidad; no es obligación de adoptar la herramienta.

## Integración y datos si el piloto convence

Existe SDK `@typesafe-ai/sdk` para Node >=20, TypeScript/ESM/CommonJS, o HTTP directo a `POST https://api.typesafe.ai/v1/systemone` con Bearer key y estado/preguntas. La API documenta errores 401/422/429/529 y backoff para límites/sobrecarga. [JS SDK](https://docs.typesafe.ai/sdk/javascript), [API](https://docs.typesafe.ai/api).

El cliente JS no permite uso de navegador por defecto; la opción que lo habilita expone la clave. Su timeout predeterminado es 10,000 ms **por intento**, sin presupuesto total. RequestOptions.signal cancela llamada y reintentos, y RetryPolicy permite acotarlos. Un eventual módulo `.server.ts` necesita cancelación global y fallback para respetar el plazo actual, no confiar en defaults. El debug incluye cuerpos sin redacción. [Client config](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig), [Request options](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions), [Retry policy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy).

Enviar solo consulta/candidatos o relaciones textuales necesarias, sin nombre del usuario, historial de peso o diario completo. Una integración debe ser opcional y la búsqueda/cálculo/guardado deben funcionar cuando esté apagada. Esto preserva el propósito privado/self-hosted expresado en el README.

TypeSafe publica compromiso de no entrenar con Input, procesamiento en EE.UU. y retención durante el tiempo razonablemente necesario, sin plazo fijo. ZDR se ofrece a enterprise; no es propiedad del plan común. [Privacy policy](https://typesafe.ai/legal/privacy-policy), [Legal](https://docs.typesafe.ai/legal). El DPA define roles controller/processor y retención según finalidad; su apartado de datos sensibles está en N/A, por lo que no equivale a garantía de compatibilidad para enviar datos de salud. [DPA](https://typesafe.ai/legal/data-processing).

Hallazgo contractual concreto: Master Customer Agreement §2.3(f) restringe publicar benchmarks o información de desempeño del servicio; §4.1 no autoriza entrenamiento con datos del cliente sin consentimiento. El piloto propuesto es privado; publicar sus cifras requeriría resolver esa restricción con el proveedor. También depende de créditos y los comprados tienen vencimiento por defecto. [Master Customer Agreement](https://typesafe.ai/legal/master-customer-agreement).

## Seguimiento: modelo visual económico → Jev

Revisión adicional: 2026-09-18. Sí, un modelo visual puede convertir una foto en texto/JSON que Jev procese. Un candidato económico para el piloto es **`gemini-3.1-flash-lite`**, marcado estable, con entrada de imágenes y salida estructurada; no se afirma que sea la versión más nueva ni que reconozca comida mejor que el proveedor actual. El sufijo `-image` corresponde a otra variante orientada a generación y no hace falta para este flujo. [Ficha de Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite).

Google documenta imágenes inline o File API; el límite inline es 20 MB para la petición completa. Structured Outputs permite un esquema JSON, pero Google exige validar los valores y manejar respuestas conformes al esquema que sean semánticamente incorrectas. [Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

Flujo de diseño propuesto, aún sin implementar ni medir:

1. **Visión:** recibir foto y correcciones/contexto del usuario; producir componentes con IDs, nombres alternativos para búsqueda, preparación propuesta, evidencia visible y ambigüedades. Separar lo observado de lo inferido. El peso confirmado debe venir del usuario o una etiqueta; el peso visual, si se ofrece, es un intervalo estimado explícito, o queda pendiente. No pedir nutrición autoritativa.
2. **Validación y búsqueda local:** validar JSON y reglas de dominio; consultar USDA por cada componente mediante código. Si faltan resultados, pedir corrección o ampliar búsqueda local. Jev no puede seleccionar el alimento correcto si no está entre los candidatos.
3. **Jev opcional:** enviar el JSON reducido y shortlists pertinentes; una Choice por componente con IDs y `none`, todas juntas si comparten estado. Preguntar únicamente qué candidato corresponde a la descripción/preparación, y usar incertidumbre para pedir confirmación. Un par de preguntas textuales puede detectar solapamiento descrito; no verifica la foto original.
4. **Código y usuario:** calcular nutrición desde candidatos y cantidades confirmados, mostrar borrador con procedencia y guardar tras revisión. Si visión/Jev fallan, conservar el flujo manual y los resultados locales.

El precio Standard publicado de 3.1 Flash-Lite es **USD 0.25/M tokens de entrada de texto/imagen/video y USD 1.50/M de salida, incluido thinking**. Como cálculo propio ilustrativo: 2,000 tokens de entrada y 400 de salida cuestan USD 0.0011; sumar una petición Jev de 2,000 tokens cuesta USD 0.000084, total USD 0.001184. Los tokens reales de imagen, prompt, salida y pensamiento pueden variar. El free tier marca uso del contenido para mejorar productos y el paid tier marca que no; para fotos privadas conviene valorar esa diferencia, sin equipararla a retención cero. [Precios oficiales](https://ai.google.dev/gemini-api/docs/pricing).

El adaptador actual de Pi usa `ModelRuntime.completeSimple` y no crea AgentSession ni herramientas de shell/archivos; el nombre del paquete no implica que el flujo sea un agente de programación. [pi.server.ts](../app/photo-analysis/pi.server.ts). Reemplazar o complementar ese extractor requiere comparar resultados reales; la tarifa por tokens no demuestra ahorro frente al costo y cuota de la suscripción actual.

Las dos etapas no mejoran la exactitud por sí solas: si visión confunde pescado con pollo o inventa una preparación, Jev puede elegir con confianza el candidato equivocado a partir de ese texto. Comparar **visión económica + selección local** frente a **la misma visión + Jev**, además del flujo actual; añadir Jev solo si reduce correcciones o errores de selección. No confundir confianza de selección con certidumbre sobre ingredientes o masa.

## Inventario completo de páginas revisadas

Las páginas se consultaron en formato Markdown para lectura completa. Los links siguientes apuntan a la versión web correspondiente; varias referencias API repiten miembros heredados y tipos sin añadir capacidades nuevas.

1. [Introduction](https://docs.typesafe.ai/introduction) — recuperada.
2. [Quick start](https://docs.typesafe.ai/introduction/quickstart) — recuperada.
3. [System One](https://docs.typesafe.ai/concepts/system-one) — recuperada.
4. [State](https://docs.typesafe.ai/concepts/state) — recuperada.
5. [Primitives (Questions)](https://docs.typesafe.ai/primitives) — recuperada.
6. [Choice](https://docs.typesafe.ai/primitives/choice) — recuperada.
7. [Score](https://docs.typesafe.ai/primitives/score) — recuperada.
8. [Noul](https://docs.typesafe.ai/primitives/noul) — recuperada.
9. [Advanced: structure](https://docs.typesafe.ai/primitives/advanced) — recuperada.
10. [AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer) — recuperada.
11. [Confidence](https://docs.typesafe.ai/confidence) — recuperada.
12. [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) — recuperada.
13. [Example use cases](https://docs.typesafe.ai/concepts/use-case-map) — recuperada.
14. [Patterns](https://docs.typesafe.ai/patterns) — recuperada.
15. [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out) — recuperada.
16. [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing) — recuperada.
17. [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring) — recuperada.
18. [Intent routing](https://docs.typesafe.ai/patterns/intent-routing) — recuperada.
19. [Demos](https://docs.typesafe.ai/demos) — recuperada.
20. [Smart home assistant demo](https://docs.typesafe.ai/demos/smart-home) — recuperada.
21. [Client SDKs](https://docs.typesafe.ai/sdk) — recuperada.
22. [TypeSafe Python SDK](https://docs.typesafe.ai/sdk/python) — recuperada.
23. [Usage](https://docs.typesafe.ai/sdk/python/usage) — recuperada.
24. [Changelog](https://docs.typesafe.ai/sdk/python/changelog) — recuperada.
25. [API reference](https://docs.typesafe.ai/sdk/python/api) — recuperada.
26. [Async client](https://docs.typesafe.ai/sdk/python/api/clients/async) — recuperada.
27. [Sync client](https://docs.typesafe.ai/sdk/python/api/clients/sync) — recuperada.
28. [Questions](https://docs.typesafe.ai/sdk/python/api/types/questions) — recuperada.
29. [Answers and responses](https://docs.typesafe.ai/sdk/python/api/types/responses) — recuperada.
30. [Retries](https://docs.typesafe.ai/sdk/python/api/retries) — recuperada.
31. [Common types](https://docs.typesafe.ai/sdk/python/api/types/common) — recuperada.
32. [Exceptions](https://docs.typesafe.ai/sdk/python/api/exceptions) — recuperada.
33. [Constants](https://docs.typesafe.ai/sdk/python/api/constants) — recuperada.
34. [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) — recuperada.
35. [Changelog](https://docs.typesafe.ai/sdk/javascript/changelog) — recuperada.
36. [API reference](https://docs.typesafe.ai/sdk/javascript/api) — recuperada.
37. [Class: APIConnectionError](https://docs.typesafe.ai/sdk/javascript/api/classes/APIConnectionError) — recuperada.
38. [Class: APIError](https://docs.typesafe.ai/sdk/javascript/api/classes/APIError) — recuperada.
39. [Class: APIPromise<T>](https://docs.typesafe.ai/sdk/javascript/api/classes/APIPromise) — recuperada.
40. [Class: APITimeoutError](https://docs.typesafe.ai/sdk/javascript/api/classes/APITimeoutError) — recuperada.
41. [Class: APIUserAbortError](https://docs.typesafe.ai/sdk/javascript/api/classes/APIUserAbortError) — recuperada.
42. [Class: AuthenticationError](https://docs.typesafe.ai/sdk/javascript/api/classes/AuthenticationError) — recuperada.
43. [Class: BadRequestError](https://docs.typesafe.ai/sdk/javascript/api/classes/BadRequestError) — recuperada.
44. [Class: InternalServerError](https://docs.typesafe.ai/sdk/javascript/api/classes/InternalServerError) — recuperada.
45. [Class: NotFoundError](https://docs.typesafe.ai/sdk/javascript/api/classes/NotFoundError) — recuperada.
46. [Class: PermissionDeniedError](https://docs.typesafe.ai/sdk/javascript/api/classes/PermissionDeniedError) — recuperada.
47. [Class: RateLimitError](https://docs.typesafe.ai/sdk/javascript/api/classes/RateLimitError) — recuperada.
48. [Class: TypeSafeClient](https://docs.typesafe.ai/sdk/javascript/api/classes/TypeSafeClient) — recuperada.
49. [Class: TypeSafeError](https://docs.typesafe.ai/sdk/javascript/api/classes/TypeSafeError) — recuperada.
50. [Class: UnprocessableEntityError](https://docs.typesafe.ai/sdk/javascript/api/classes/UnprocessableEntityError) — recuperada.
51. [Interface: ChoiceQuestion<T>](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ChoiceQuestion) — recuperada.
52. [Interface: ChoiceResponse<T>](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ChoiceResponse) — recuperada.
53. [Interface: Logger](https://docs.typesafe.ai/sdk/javascript/api/interfaces/Logger) — recuperada.
54. [Interface: ModelCard](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ModelCard) — recuperada.
55. [Interface: Models](https://docs.typesafe.ai/sdk/javascript/api/interfaces/Models) — recuperada.
56. [Interface: NoulQuestion](https://docs.typesafe.ai/sdk/javascript/api/interfaces/NoulQuestion) — recuperada.
57. [Interface: NoulResponse](https://docs.typesafe.ai/sdk/javascript/api/interfaces/NoulResponse) — recuperada.
58. [Interface: Questions](https://docs.typesafe.ai/sdk/javascript/api/interfaces/Questions) — recuperada.
59. [Interface: RequestOptions](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions) — recuperada.
60. [Interface: RetryPolicy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy) — recuperada.
61. [Interface: ScoreQuestion<T>](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ScoreQuestion) — recuperada.
62. [Interface: ScoreResponse<T>](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ScoreResponse) — recuperada.
63. [Interface: SystemOneRequest<Q>](https://docs.typesafe.ai/sdk/javascript/api/interfaces/SystemOneRequest) — recuperada.
64. [Interface: SystemOneRequestPayload](https://docs.typesafe.ai/sdk/javascript/api/interfaces/SystemOneRequestPayload) — recuperada.
65. [Interface: SystemOneResult<Q>](https://docs.typesafe.ai/sdk/javascript/api/interfaces/SystemOneResult) — recuperada.
66. [Interface: TypeSafeClientConfig](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig) — recuperada.
67. [Interface: Usage](https://docs.typesafe.ai/sdk/javascript/api/interfaces/Usage) — recuperada.
68. [Interface: WithResponse<T>](https://docs.typesafe.ai/sdk/javascript/api/interfaces/WithResponse) — recuperada.
69. [Type Alias: ChoiceCriteria](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/ChoiceCriteria) — recuperada.
70. [Type Alias: Description](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/Description) — recuperada.
71. [Type Alias: EntryType](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/EntryType) — recuperada.
72. [Type Alias: EnvVar](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/EnvVar) — recuperada.
73. [Type Alias: Fetch](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/Fetch) — recuperada.
74. [Type Alias: JsonValue](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/JsonValue) — recuperada.
75. [Type Alias: LogLevel](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/LogLevel) — recuperada.
76. [Type Alias: Question](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/Question) — recuperada.
77. [Type Alias: ResultFor<T>](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/ResultFor) — recuperada.
78. [Type Alias: ScoreCriteria](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/ScoreCriteria) — recuperada.
79. [Type Alias: ScoreLegend<T>](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/ScoreLegend) — recuperada.
80. [Type Alias: ScoreOf<T>](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/ScoreOf) — recuperada.
81. [Variable: ENV](https://docs.typesafe.ai/sdk/javascript/api/variables/ENV) — recuperada.
82. [Variable: LOG_LEVELS](https://docs.typesafe.ai/sdk/javascript/api/variables/LOG_LEVELS) — recuperada.
83. [Variable: VERSION](https://docs.typesafe.ai/sdk/javascript/api/variables/VERSION) — recuperada.
84. [Function: choice()](https://docs.typesafe.ai/sdk/javascript/api/functions/choice) — recuperada.
85. [Function: noul()](https://docs.typesafe.ai/sdk/javascript/api/functions/noul) — recuperada.
86. [Function: score()](https://docs.typesafe.ai/sdk/javascript/api/functions/score) — recuperada.
87. [Models](https://docs.typesafe.ai/models) — recuperada.
88. [API reference](https://docs.typesafe.ai/api) — recuperada.
89. [Agent skill](https://docs.typesafe.ai/agent-skill) — recuperada.
90. [Legal](https://docs.typesafe.ai/legal) — recuperada.
91. [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13) — recuperada.
92. [Self-consistency: nouls](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook) — recuperada.
93. [Self-consistency: choices](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook) — recuperada.
94. [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions) — recuperada.
95. [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe) — recuperada.
96. [Line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find) — recuperada.
97. [Structure recovery](https://docs.typesafe.ai/cookbooks/autoformat) — recuperada.
98. [Function calling](https://docs.typesafe.ai/cookbooks/function_calling) — recuperada.
99. [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion) — recuperada.
100. [Knowledge graph entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment) — recuperada.
101. [Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) — recuperada.
102. [Double-checking citations](https://docs.typesafe.ai/cookbooks/citation_check) — recuperada.
103. [Guardrails for LLMs](https://docs.typesafe.ai/cookbooks/llm_guardrails) — recuperada.
104. [SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade) — recuperada.
105. [Date extraction](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook) — recuperada.
106. [Pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook) — recuperada.
107. [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification) — recuperada.
108. [Autoresearch feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) — recuperada.
109. [Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence) — recuperada.

Referencias legales adicionales revisadas: [DPA](https://typesafe.ai/legal/data-processing), [Master Customer Agreement](https://typesafe.ai/legal/master-customer-agreement), [Privacy policy](https://typesafe.ai/legal/privacy-policy).
