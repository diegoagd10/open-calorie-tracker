# 17 — Registro mediante foto de etiqueta nutricional

## Objetivo

Permitir que un usuario fotografíe una etiqueta nutricional y obtenga inmediatamente una entrada del Food Log con una porción, imagen privada retenida y valores extraídos editables. Tanto el éxito como los fallos deben producir estados visibles y seguros que nunca distorsionen los totales diarios.

## Contexto y dependencias

- Fuente de verdad de producto: [docs/PRD.md](../PRD.md), secciones 6.3, 7.3, 8, 8.1, 13 y 14.
- Requiere specs 01–16: auth/onboarding, navegación diaria, totales, edición, tablas de entradas/imágenes, API/UI del Food Log y las decisiones de scanning/storage de la spec 15.
- Una etiqueta legible sin producto reconocible se registra como **Unnamed food** sin warning. Ingredientes no se extraen, solicitan, almacenan ni muestran.
- La foto capturada se conserva y aparece en la tarjeta. No puede borrarse separadamente; al borrar la entrada también se elimina la imagen.
- La spec 15 selecciona proveedor de extracción y object storage. Esta spec implementa esos adapters detrás de `NutritionLabelExtractor` y `PrivateObjectStore`, conservando fakes locales completos. Producción debe requerir adapters configurados y consentimiento/privacidad acordados.
- Esta entrega cubre captura online. Captura offline, cola Pending y sincronización al recuperar conexión quedan fuera, aunque el estado `pending` se mantiene en el modelo para una spec posterior.

## Alcance

### Dentro

- Captura/selección de foto desde Ionic y upload autenticado.
- Validación, normalización segura y almacenamiento privado de la imagen.
- Extracción de nombre, medida, cantidad y nutrición mediante interfaz inyectable.
- Entrada exitosa inmediata o entrada fallida visible, retryable/no retryable.
- Retry, detalle comprensible, corrección posterior y eliminación.
- Imágenes en tarjetas y acceso privado autorizado.
- Nutrientes parciales y totales incompletos.

### Fuera

- Barcode y retención de imagen de barcode.
- Estimación de calorías desde una foto de comida.
- Ingredientes, creación manual desde cero y búsqueda automática adicional de producto.
- Procesamiento offline, sync multi-dispositivo y reconciliación de conflictos.
- Reabrir la selección comercial, privacidad o retención decidida en la spec 15. Esta spec sí implementa y configura los adapters seleccionados.

## Tareas en orden

1. Definir en `packages/domain`:
   - `NutritionLabelExtraction` con nombre opcional, medida, cantidad y nutrientes nullable.
   - Resultado discriminado `success | retryable_failure | terminal_failure` con códigos seguros y mensaje de usuario separado de detalles internos.
   - Validación de valores finitos/no negativos y reglas para una porción.
2. Definir puertos en API e implementar los adapters seleccionados en 15:
   - `NutritionLabelExtractor.extract(imageRef, signal)` sin dependencia de un vendor concreto.
   - `PrivateObjectStore.put/get/delete` con claves opacas y acceso nunca público.
   - Fakes deterministas que puedan devolver éxito completo, éxito parcial, nombre ausente y ambos tipos de fallo.
3. Implementar adapter de almacenamiento de desarrollo bajo un directorio configurable fuera de archivos públicos. Debe impedir path traversal, generar claves aleatorias y no activarse en producción. Documentar requisitos del adapter real: cifrado en tránsito/reposo, región/retención acordadas, URLs cortas o streaming autenticado y borrado verificable.
4. Añadir captura en Ionic mediante input/capacitor abstraction, aceptando JPEG, PNG y HEIC si la plataforma puede decodificarlo. Validar firma real, máximo inicial de 10 MiB y dimensiones razonables; re-encodear a formato soportado, corregir orientación y eliminar metadatos de ubicación sin perder legibilidad.
5. Implementar `POST /days/:localDate/nutrition-label-entries` como multipart autenticado con `timeZone`, `clientNow` e `Idempotency-Key`:
   - Validar onboarding y fecha no futura.
   - Guardar la imagen privada antes de invocar extracción.
   - Invocar extractor con timeout.
   - Crear transaccionalmente una entrada con la regla horaria de la spec 11 y su fila de imagen.
   - Compensar/borrar el objeto si falla la transacción antes de crear una entrada visible.
6. Mapear resultados:
   - Éxito: `status=successful`, `source=nutrition_label`, una porción y valores extraídos; si no hay nombre reconocible usar exactamente `Unnamed food` sin warning.
   - Fallo retryable: `status=failed`, sin nutrición utilizable, imagen retenida, acción Retry y mensaje claro.
   - Fallo terminal: `status=failed`, sin nutrición utilizable, imagen retenida, detalle comprensible y acción Delete; no ofrecer retry rápido.
   Las entradas fallidas aparecen newest-first pero no afectan ningún total.
7. Implementar `POST /food-entries/:id/retry` solo para `retryable_failure`. Reutilizar la imagen existente, aplicar idempotencia y convertir la misma entrada a éxito o al nuevo fallo; no crear una segunda tarjeta por retry técnico.
8. Implementar `PATCH /food-entries/:id` para entradas exitosas propias con nombre, medida, cantidad y valores nutricionales:
   - Permitir corregir `Unnamed food`.
   - Cambiar cantidad/medida recalcula proporcionalmente desde una base estable.
   - Editar valores nutricionales redefine la base de esa entrada solamente.
   - Valores no provistos permanecen `null`; vacío no se convierte a 0.
   - No modificar catálogo ni otras entradas históricas.
9. Implementar `DELETE /food-entries/:id` para entrada propia. Eliminar fila y referencias en transacción y ejecutar borrado del objeto de forma fiable mediante outbox/job reintentable. Para aceptación, la imagen debe dejar de ser recuperable; registrar métricas de fallos sin exponer contenido.
10. Implementar `GET /food-entries/:id/image` o URL firmada corta que compruebe sesión y propiedad en cada acceso. Responder 404 tanto para inexistente como ajena para no filtrar datos.
11. Habilitar “Scan Nutrition Label” en el menú Add Food. Crear UI de captura, progreso, éxito y fallo:
    - No cerrar la pantalla durante upload/extracción sin advertir.
    - Al éxito, volver al día y mostrar tarjeta con foto.
    - Retry rápido solo para retryable; detalle + Delete para terminal.
    - Editor posterior accesible con preview, nombre, medida, cantidad y todos los nutrientes primarios.
12. Actualizar el resumen diario para excluir `pending/failed` y propagar nutrición parcial de una entrada exitosa como `incomplete`. Valores conocidos siguen sumando.
13. Añadir tests unitarios/integración/UI para tipo/tamaño inválido, path traversal, éxito, éxito parcial, unnamed, timeout retryable, terminal, retry sobre misma entrada, idempotencia, corrección aislada, escalado proporcional, borrado de fila/objeto, autorización de imagen, fecha futura, orden y exclusión de totales.
14. Documentar contratos de extractor/storage, clasificación de errores, límites de archivo, privacidad, timeout, compensación y pasos requeridos antes de habilitar adapters reales en producción.

## Criterios de aceptación verificables

- Con fakes configurados a éxito, tomar/subir una etiqueta válida crea una entrada exitosa de una porción en el día elegido, muestra su foto y suma solo valores conocidos.
- Una etiqueta legible sin nombre crea `Unnamed food` sin banner de warning y el usuario puede renombrarla después.
- Una extracción parcial muestra valores ausentes como unavailable, nunca 0, y marca los agregados afectados como incompletos mientras suma los conocidos.
- Un fallo retryable crea una tarjeta de error sin nutrición y con Retry; reintentar con éxito actualiza esa misma entrada, no duplica tarjeta ni imagen.
- Un fallo terminal muestra detalle comprensible y Delete, sin acción rápida de retry.
- Ni entradas `failed` ni `pending` cambian totales de calorías/nutrientes.
- Editar nombre, medida, cantidad o nutrición afecta solo la entrada actual; los cálculos proporcionales pasan casos de ida/vuelta sin deriva fuera de la tolerancia definida.
- Un usuario ajeno no puede obtener, editar, reintentar ni borrar la entrada/imagen y recibe una respuesta que no revela su existencia.
- La foto no tiene URL pública permanente. Tras borrar la entrada, deja de ser accesible y el objeto se elimina, con retry automático si el primer delete de storage falla.
- Archivos inválidos, superiores a 10 MiB o con firma/MIME inconsistente se rechazan antes de enviarse al extractor.
- La interfaz funciona a 320 px, con teclado y lector de pantalla; progreso y errores se anuncian sin depender solo de color.
- `pnpm verify` termina con código 0 usando fakes y sin red externa.

## Notas técnicas

- No registrar cuerpos multipart, imágenes, URLs firmadas, tokens ni texto OCR bruto. Minimizar el payload enviado al extractor.
- Un “éxito” requiere que la imagen sea legible y exista al menos un dato nutricional utilizable; de lo contrario clasificar fallo, no fabricar ceros.
- Mantener el original solo si es necesario para legibilidad/corrección y lo permite la política acordada; la versión presentada debe estar normalizada y sin geolocalización.
- El borrado entre SQLite y object storage no puede ser una sola transacción; usar patrón outbox y hacer el acceso imposible en DB antes de confirmar al usuario.
- Los adapters reales deben tener contract tests opt-in y revisión de privacidad antes de producción. La suite obligatoria usa fakes locales.
- Barcode se entrega en la spec 16. Plates, offline y sincronización continúan en las specs 18–26.
