# 03 — Esquema de base de datos y datos semilla

## Objetivo

Implementar en `packages/db` el esquema SQLite/Drizzle base para autenticación passwordless, onboarding, metas con vigencia histórica y los primeros orígenes de alimentos. Añadir migraciones reproducibles y una semilla idempotente; las capacidades posteriores ampliarán el esquema mediante nuevas migraciones, nunca por sincronización automática.

## Contexto y dependencias

- Fuente de verdad de producto: [docs/PRD.md](../PRD.md).
- Requiere las specs 01 y 02 completas: workspaces compilables, Vitest y base SQLite temporal.
- El PRD exige datos privados por usuario, verificación de email, sesiones simultáneas, metas históricas, fechas locales estables, nutrientes faltantes distintos de cero e imágenes asociadas a entradas escaneadas.
- Esta spec crea persistencia, constraints y repositorios básicos para specs 04–17. Agua, favoritos, plates y sincronización añaden sus propias migraciones en las specs que los implementan.
- Representación canónica:
  - Día de consumo: texto `YYYY-MM-DD` calculado en la zona del evento.
  - Hora de tarjeta: minutos desde medianoche (`0..1439`) más zona IANA original.
  - Instantes de sistema: UTC.
  - Cantidades escalables: enteros en millonésimas de la unidad (`*_micros`).
  - Calorías y nutrientes primarios: enteros en milésimas; `NULL` significa desconocido y nunca se convierte a cero.
  - Agua y sodio: unidades canónicas explícitas en nombres de columna (`ml`, `mg`), aunque el agua no se registra todavía.

## Alcance

### Dentro

- Cliente Drizzle/SQLite configurable, migraciones SQL y comando de migración.
- Tablas y constraints base para specs 04–17; cada capacidad añade mediante migración sus tablas específicas cuando corresponda.
- Repositorios pequeños con transacciones; Drizzle no se importa desde web ni dominio.
- Semilla solo para desarrollo/test con catálogo de alimentos conocido.
- Pruebas de migración, constraints, aislamiento e idempotencia.

### Fuera

- HTTP, UI, envío real de correo, búsqueda en proveedor externo, almacenamiento binario y extracción OCR/IA.
- Tablas definitivas de agua, platos, favoritos, barcode y sincronización offline.
- Perfil de salud: nombre, edad, sexo, altura, peso y datos similares están prohibidos por el PRD.
- Ingredientes; no deben existir columnas ni JSON para almacenarlos.

## Tareas en orden

1. Configurar `packages/db` para aceptar `DATABASE_URL` con archivo SQLite. El constructor debe ser explícito, no abrir conexiones al importar y permitir inyectar una conexión temporal en tests.
2. Crear migraciones Drizzle versionadas. La primera migración debe crear, como mínimo:
   - `users`: `id`, `email_normalized` único, `email_verified_at`, `created_at`.
   - `magic_links`: `id`, `email_normalized`, `token_hash` único, `expires_at`, `consumed_at`, `created_at`.
   - `email_delivery_attempts`: link asociado, número de intento, estado `sent|failed`, código de error seguro y timestamps.
   - `sessions`: `id`, `user_id`, `token_hash` único, `created_at`, `last_seen_at`, `revoked_at`; una fila por teléfono/sesión.
   - `user_preferences`: `user_id` único, `unit_system` (`us|metric`), `onboarding_completed_at`, timestamps.
   - `goal_versions`: `id`, `user_id`, `effective_date`, metas de calorías, agua, proteína, carbohidratos, grasa, fibra, azúcar y sodio, más timestamps; combinación `(user_id, effective_date)` única.
   - `catalog_foods`: identidad interna, `provider`, `external_id`, nombre, URL opcional de imagen, medida/base y snapshot de nutrientes primarios nullable; `(provider, external_id)` único.
   - `food_entries`: propietario, `local_date`, `time_minutes`, `timezone`, `source` (`catalog|nutrition_label` por ahora), `status` (`successful|pending|failed`), nombre, medida, cantidad y base de cálculo, nutrientes base nullable, referencia opcional de catálogo, clasificación/detalle seguro de error y timestamps.
   - `food_entry_images`: una imagen por entrada para esta entrega, `storage_key` único, MIME, bytes, checksum, timestamps y FK con cascade.
   - `food_entry_other_nutrients`: nombre normalizado, etiqueta visible, unidad y cantidad nullable para hechos adicionales; FK con cascade. Ingredientes quedan expresamente excluidos.
3. Añadir constraints de base de datos:
   - Email normalizado no vacío; timestamps requeridos.
   - Metas estrictamente positivas.
   - Fecha y zona no vacías; `time_minutes` entre 0 y 1439.
   - Cantidades/base mayores que cero para entradas exitosas.
   - Una entrada `successful` requiere nombre, medida y cantidad; una `failed` requiere clasificación de error y no puede tener nutrición utilizable.
   - Una entrada de `nutrition_label` exitosa o fallida conserva una fila de imagen; el repositorio debe imponerlo transaccionalmente aunque SQLite no pueda expresarlo con un `CHECK` entre tablas.
4. Crear índices para las consultas previstas:
   - Sesión por hash y sesiones activas por usuario.
   - Link por hash/email y expiración.
   - Meta más reciente por `(user_id, effective_date desc)`.
   - Entradas por `(user_id, local_date, time_minutes desc, created_at desc, id desc)`.
   - Búsqueda de catálogo por nombre normalizado y external ID.
5. Implementar repositorios/transactions en `packages/db`, sin lógica HTTP:
   - Crear/consumir link y registrar intento de entrega.
   - Crear/revocar/buscar sesión por hash.
   - Crear/verificar usuario y completar preferencias + primera versión de metas atómicamente.
   - Resolver metas activas para una fecha con `effective_date <= selected_date`.
   - Buscar catálogo local y crear/listar/actualizar/eliminar snapshots de `food_entries` limitados por `user_id`.
6. Añadir utilidades puras en `packages/domain` para normalizar email, validar fechas/zonas/unidades y representar nutrientes conocidos/desconocidos. Los tipos del dominio no deben exponer filas Drizzle.
7. Crear comandos raíz y de paquete:
   - `db:generate` para generar migraciones revisables.
   - `db:migrate` para aplicar migraciones pendientes.
   - `db:seed` para semilla de desarrollo.
   - `db:studio` solo como utilidad local, nunca requisito de CI.
8. Implementar una semilla idempotente, rechazada explícitamente cuando `NODE_ENV=production`, con:
   - Un usuario demo verificado y onboarding completo, documentado como no apto para despliegue.
   - Una versión de metas válida.
   - Al menos seis alimentos de catálogo: uno sin imagen, uno con nutrientes parciales y suficientes nombres distintos para probar búsqueda sin resultados y coincidencias múltiples.
   - Ningún token de sesión o magic link reutilizable y ninguna imagen privada real.
9. Probar migración desde base vacía, reejecución sin cambios, rollback/fracaso atómico donde aplique, constraints, cascade, búsqueda, resolución histórica de metas y aislamiento por `user_id`.
10. Documentar el diagrama textual de tablas, las unidades canónicas, la diferencia entre `NULL` y cero, cómo crear una migración y cómo recrear únicamente la base local.

## Criterios de aceptación verificables

- `pnpm db:migrate` sobre un archivo nuevo crea todas las tablas e índices y una segunda ejecución no cambia el esquema ni falla.
- `pnpm db:seed` dos veces deja las mismas cantidades de usuarios, metas y alimentos; en `NODE_ENV=production` termina con error antes de escribir.
- `pnpm --filter @calorie-tracker/db test` demuestra constraints, cascades, transacciones e aislamiento entre dos usuarios.
- Una meta efectiva el 10 de enero se resuelve para el 10 y días posteriores, mientras una consulta del 9 usa la versión anterior.
- Un nutriente desconocido se persiste y devuelve como `null`; una prueba impide que se agregue como cero.
- Una entrada fallida no puede contribuir calorías o nutrientes y una entrada exitosa conserva su snapshot aunque se modifique `catalog_foods`.
- El orden de entradas para un día es determinista por hora, creación e ID.
- `apps/web` no importa Drizzle ni `packages/db`; los endpoints aún no existen.
- El esquema no contiene campos de ingredientes ni datos de perfil de salud prohibidos.

## Notas técnicas

- Almacenar solo hashes criptográficos de tokens de login y sesión; nunca tokens en texto claro.
- Normalizar email mediante trim y lowercase conservador. No aplicar reglas específicas de proveedores como eliminar puntos o sufijos `+`.
- Los nutrientes base representan los valores para `basis_quantity_micros`; el total mostrado se calcula proporcionalmente con aritmética decimal/entera y una política de redondeo centralizada en dominio.
- `local_date` es identidad de negocio y no debe recalcularse desde UTC al leer. Esto evita que viajar cambie días históricos.
- Una URL de imagen del catálogo no es una imagen privada. Las fotos capturadas usan únicamente `storage_key`; nunca una ruta pública permanente.
- Si SQLite no permite alterar un constraint de forma segura, crear una migración copy-table explícita y probarla; no activar auto-sync de esquema en producción.
