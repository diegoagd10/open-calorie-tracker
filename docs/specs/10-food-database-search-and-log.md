# 10 — Búsqueda en base de alimentos y registro

## Objetivo

Entregar el primer recorrido vertical del Food Log: un usuario autenticado y con onboarding completo puede abrir hoy o una fecha pasada, buscar alimentos existentes mediante la API, seleccionar un resultado y registrar inmediatamente una porción como snapshot privado. La lista y los totales deben respetar fechas locales, orden, duplicados y nutrientes faltantes del PRD.

## Contexto y dependencias

- Fuente de verdad de producto: [docs/PRD.md](../PRD.md), secciones 5, 6, 7.1, 8 y 14.
- Requiere specs 01–09: auth, onboarding, navegación diaria, esquema de catálogo/entradas, pruebas y la selección de proveedor producida por el spike 09.
- La web consulta `apps/api`; la API accede a un puerto `FoodCatalogProvider`. Esta spec implementa el adapter del proveedor elegido en 09, conserva un adapter SQLite para desarrollo/tests y no presenta cobertura geográfica distinta de la realmente contratada.
- Solo se puede elegir un resultado existente. La selección registra una porción de inmediato. Un resultado del proveedor se copia a `food_entries`; cambios futuros del catálogo no alteran historia.
- Los nutrientes primarios son calorías, proteína, carbohidratos, grasa, fibra, azúcar y sodio. Un valor ausente es `null`, no cero, y vuelve incompleto el total aplicable.

## Alcance

### Dentro

- Vista diaria mobile-first con selector de fecha básico, resumen de calorías/nutrientes y Food Log.
- Búsqueda server-side de catálogo y selección de un resultado.
- Creación inmediata de una entrada exitosa de una porción.
- Registro para hoy, snapshots, orden básico newest-first y duplicados. Las reglas retroactivas y de zona horaria se completan en la spec 11.
- Snapshot nutricional, imágenes públicas de catálogo opcionales, aislamiento de usuario.
- Estados de carga, vacío, sin resultados, error y nutrientes incompletos.
- Contrato extensible de proveedor y tests sin red.

### Fuera

- Crear alimentos completamente manuales.
- Barcode, foto de comida o estimación por IA.
- Foto de etiqueta nutricional; corresponde a la spec 17.
- Edición/eliminación, favoritos, scans, plates y offline/sync; corresponden a las specs 13–26. Navegación/metas y water ya existen por dependencias 07–08 y esta entrega no los modifica.
- Guardar ingredientes o mostrar Health Score, ejercicio, coaching o gamificación.

## Tareas en orden

1. Definir en `packages/domain` los contratos `CatalogFood`, `FoodMeasurement`, `NutritionSnapshot`, `FoodEntry` y `DailyNutritionSummary`. Los valores desconocidos usan `null`; las funciones de suma devuelven por nutriente `{ knownTotal, incomplete }`.
2. Crear `FoodCatalogProvider.search(query, limit, signal)` con resultado normalizado y errores tipados `unavailable|rate_limited|invalid_response`. Implementar:
   - Adapter local SQLite para desarrollo/test sobre la semilla.
   - Fake determinista para tests.
   - Adapter del proveedor seleccionado por la spec 09, sin acoplar DTOs externos a dominio o DB.
3. Implementar búsqueda autenticada `GET /catalog/foods?q=...&limit=...`:
   - Requiere onboarding completo.
   - Trim, longitud mínima 2, máximo 100 y límite paginado acotado.
   - Devuelve solo items seleccionables y medidas disponibles; nunca crea entradas.
   - Query vacía/inválida devuelve 400; cero coincidencias devuelve 200 con `items: []`.
4. Implementar `POST /days/:localDate/food-entries` con `{ catalogFoodId, measurement, quantity, timeZone, clientNow }` para la fecha local de hoy:
   - Verificar auth/onboarding y que el item todavía existe.
   - Rechazar fechas distintas del día local actual en esta entrega; la spec 11 habilita el alta retroactiva y mantiene prohibido el futuro.
   - Copiar nombre, medida, cantidad y nutrientes a una entrada `source=catalog`, `status=successful`.
   - Por defecto registrar exactamente una porción/medida base; la selección estándar de UI envía ese valor.
5. Asignar la hora local actual en una transacción, persistiendo `local_date`, minutos y zona IANA. Ordenar por hora, creación e ID para que dos altas en el mismo minuto sean deterministas. La spec 11 añade las reglas de fechas pasadas y viajes.
6. Permitir entradas duplicadas; cada POST crea un evento distinto. Añadir idempotency key opcional/obligatoria para reintentos técnicos de la misma acción, de modo que un doble retry de red no se confunda con dos consumos intencionales. Documentar el header `Idempotency-Key` y almacenarlo por usuario/operación.
7. Implementar `GET /days/:localDate` para devolver metas activas y entradas del usuario newest-first. Puede devolver un agregado provisional para no romper el contrato, pero la UI completa de calorías, carrusel e incompletitud pertenece a la spec 12.
8. Crear la UI mínima del día:
   - Encabezado/selector de fecha que identifica el día sin puntuarlo ni colorearlo moralmente.
   - Reservar regiones estables para calorías y nutrición que la spec 12 completará, sin mostrar totales falsos.
   - Sección titulada exactamente “Food Log”, newest-first.
9. Crear el menú “Add Food” con exactamente las cuatro etiquetas del PRD: Saved foods and reusable plates, Food Database, Scan Barcode y Scan Nutrition Label. En esta entrega Food Database funciona; las demás pueden llevar a una pantalla honesta “Not available in this build”, sin crear datos. Las specs 14/19 habilitan saved items, la 16 barcode y la 17 nutrition label.
10. Crear la pantalla de búsqueda con input, debounce cancelable, resultados, sin resultados y error. Seleccionar un resultado debe registrar una porción inmediatamente, cerrar/volver al día y mostrar la nueva tarjeta; no añadir un paso de confirmación.
11. Renderizar tarjeta de catálogo con imagen remota solo si existe y carga; si no existe o falla, usar tarjeta de texto, nunca un placeholder engañoso. Mostrar nombre, medida/cantidad, calorías y hora.
12. Añadir tests de búsqueda, no-match, proveedor caído, mapping del adapter real, selección, snapshot aislado, duplicados, idempotencia de retry, fecha distinta de hoy rechazada, aislamiento y orden determinista.
13. Documentar contrato del proveedor, mapping, timeouts/cancelación, política de caché y limitación actual de cobertura del catálogo.

## Criterios de aceptación verificables

- Un usuario autenticado pero sin onboarding recibe 403 en catálogo/log; uno completo solo ve sus datos.
- Buscar una cadena con coincidencias muestra items existentes; elegir uno crea una entrada de una porción sin confirmación adicional.
- Buscar sin coincidencias muestra “No results” y el conteo de `food_entries` no cambia.
- Modificar después el registro de `catalog_foods` no cambia nombre, cantidad ni nutrición de la entrada ya guardada.
- Dos selecciones intencionales del mismo alimento crean dos entradas; repetir la misma request con igual idempotency key devuelve la primera sin duplicar.
- En esta entrega solo hoy admite altas y recibe la hora local actual; fechas pasadas y futuras se rechazan hasta la spec 11.
- Un alimento sin imagen usa tarjeta de texto. Un nutriente desconocido se mantiene como `null`; la spec 12 implementará su presentación agregada como incompleta.
- La vista de 320 px no tiene overflow horizontal; carrusel, selector y Add Food se usan con teclado y lector de pantalla.
- Todos los tests usan adapter local/fake; `pnpm verify` termina con código 0 sin Internet.

## Notas técnicas

- La API debe recalcular snapshots desde datos normalizados del provider; nunca aceptar valores nutricionales enviados por la web al crear desde catálogo.
- Los círculos de progreso necesitan alternativa textual (`consumed`, `goal/maximum`, unidad) y no dependen solo de color. Sobrepasar una meta se representa neutralmente.
- La suma usa aritmética entera/decimal del dominio y redondea únicamente al presentar.
- Aplicar timeout, abort signal y límites al adapter externo. No registrar queries junto a email/identidad si los logs pueden salir del sistema.
- La búsqueda nueva puede fallar offline según el PRD; esta spec muestra el error, pero no implementa cache offline.
