# 05 — Acceso passwordless básico

## Objetivo

Entregar creación de cuenta e inicio de sesión passwordless por email, con verificación obligatoria, sesiones persistentes independientes por teléfono, cierre de la sesión actual y estados claros de envío, error y reenvío. Ningún usuario no verificado debe entrar al producto.

## Contexto y dependencias

- Fuente de verdad de producto: `PRD.md`, secciones 2 y 3.
- Requiere specs 01–04: monorepo, pruebas, tablas `users`, `magic_links`, `email_delivery_attempts` y `sessions`, más la decisión de proveedor producida por el spike 04.
- La UI vive en `apps/web`; los endpoints Hono y adapters en `apps/api`; reglas y contratos puros en `packages/domain`; persistencia Drizzle en `packages/db`.
- La spec 04 selecciona y documenta el proveedor transaccional. Esta entrega implementa el adapter elegido detrás de `EmailSender`, además de un fake determinista y un transport de desarrollo que muestre el enlace solo fuera de producción. Producción debe rechazar el arranque si el adapter real no está configurado.
- “Basic Login” es el nombre de esta entrega. No se refiere a registro de alimentos.

## Alcance

### Dentro

- Solicitud, entrega, reenvío y consumo de magic links de un solo uso.
- Creación automática de cuenta para cualquier email válido al verificar el primer link.
- Cookie de sesión segura y persistencia por dispositivo.
- Consulta de sesión y cierre del dispositivo actual.
- Guardas de frontend/API para usuario verificado.
- Límites de abuso, respuestas que no enumeren cuentas y auditoría mínima de entrega.
- UI accesible de login, “revisa tu email”, error/reenvío y verificación.

### Fuera

- Contraseñas, OAuth/social login, nombres de usuario y MFA.
- Administración remota de sesiones o “cerrar todos los dispositivos”.
- Cambio de email, recuperación sin acceso al email y eliminación de cuenta.
- Onboarding y metas; corresponden a la spec 06.
- Reabrir la selección o contratar el proveedor de correo; esas tareas pertenecen al spike 04 y al owner externo. Esta spec sí implementa el adapter decidido.

## Tareas en orden

1. Definir contratos de dominio para email normalizado, token opaco, sesión autenticada, errores de entrega y reloj inyectable. Usar tokens aleatorios de al menos 256 bits y persistir únicamente su hash.
2. Implementar servicios de aplicación transaccionales:
   - Solicitar enlace: invalidar links anteriores no consumidos del email, crear uno con 15 minutos de vigencia y pedir envío.
   - Reenviar: crear un token nuevo; el anterior queda inválido.
   - Verificar: validar hash, vigencia y uso; crear o verificar usuario; consumir link y crear una sesión independiente.
   - Cerrar sesión: revocar solo la sesión representada por la cookie actual.
3. Implementar el adapter seleccionado en la spec 04 detrás de `EmailSender` con resultado tipado `sent|failed`. En desarrollo, el transport puede escribir el enlace a una outbox local protegida o al log con advertencia. Debe estar deshabilitado en producción. Los tests usan un fake que puede simular éxito y fallo.
4. Añadir rate limits persistentes o mediante una interfaz de store, con valores iniciales documentados:
   - Máximo 5 solicitudes por email normalizado cada 15 minutos.
   - Máximo 20 por IP cada 15 minutos.
   - Verificación limitada por IP/token sin registrar el token.
   Las respuestas de solicitud deben ser genéricas para no revelar si el usuario existe.
5. Implementar endpoints Hono:
   - `POST /auth/magic-links` con `{ email }`.
   - `POST /auth/magic-links/resend` con `{ email }`.
   - `GET /auth/verify?token=...` que consume el link y establece cookie.
   - `GET /auth/session` que devuelve usuario verificado y estado de onboarding, nunca hashes.
   - `POST /auth/logout` que revoca la sesión actual y elimina cookie.
6. Configurar la cookie `HttpOnly`, `Secure` en producción, `SameSite=Lax`, `Path=/` y nombre con prefijo seguro cuando HTTPS lo permita. Usar token aleatorio, buscar por hash y refrescar `last_seen_at` sin crear una sesión nueva por request. La cookie debe ser persistente y renovarse para que el teléfono permanezca conectado hasta logout dentro de los límites del navegador.
7. Asegurar que dos verificaciones válidas en dos teléfonos creen dos sesiones y que cerrar una no revoque la otra. Nunca reutilizar una sesión existente al iniciar desde otro dispositivo.
8. Crear middleware `requireVerifiedUser` para endpoints protegidos. Responder 401 sin sesión y 403 si una fila heredada/no verificada intenta acceder.
9. Implementar rutas web:
   - `/login`: email, validación, submit y error comprensible.
   - `/check-email`: confirmación neutral y acción Reenviar.
   - `/auth/verify`: estado de carga, éxito y errores de link inválido/expirado/usado.
   - Acción “Sign out” disponible en una pantalla autenticada mínima.
10. Cumplir el comportamiento de entrega:
    - Si el envío inicial falla, mostrar error claro y acción de reenvío.
    - Tras un reenvío exitoso, mostrar confirmación breve mediante región `status`.
    - No mostrar códigos internos, stack traces ni asegurar que una cuenta ya existe.
11. Añadir tests de dominio, repositorio, API y componentes para email inválido, envío exitoso/fallido, resend, expiración, single-use, concurrencia de consumo, rate limit, cookie, dos dispositivos, logout aislado y guardas.
12. Documentar variables de entorno del transport, URL pública usada en links, política de tokens/cookies y procedimiento local para obtener un enlace de desarrollo.

## Criterios de aceptación verificables

- Un email válido recibe un link; abrirlo por primera vez verifica/crea el usuario, establece cookie y redirige a `/onboarding` si aún no completó setup.
- Un link usado, expirado o reemplazado no crea sesión y muestra un estado recuperable con opción de solicitar otro.
- Al simular fallo de `EmailSender`, la UI muestra un error comprensible y Reenviar; al cambiar el fake a éxito, anuncia confirmación.
- La respuesta a un email nuevo y a uno existente tiene el mismo status y forma pública.
- Dos clientes de test pueden mantener sesiones simultáneas para el mismo usuario; logout de uno deja al otro autenticado.
- La base nunca contiene token de magic link o sesión en texto claro y los logs no contienen query params con el token.
- Requests sin sesión a rutas protegidas reciben 401; usuarios no verificados reciben 403.
- Tests verifican límites por email/IP con reloj controlado y no dependen de espera real.
- Navegación y formularios se usan solo con teclado, el foco de error es predecible y los mensajes se asocian al input.
- `pnpm verify` termina con código 0 sin acceder a un proveedor de email real.

## Notas técnicas

- Persistir la sesión en SQLite cumple la necesidad multi-teléfono; no usar Maps o memoria de proceso.
- La entrega de email no debe estar dentro de una transacción SQLite larga. Crear el intento, enviar y actualizar resultado; si falla, el link puede invalidarse para obligar un resend limpio.
- Aplicar comparación constante a hashes/tokens cuando corresponda y protección CSRF a mutaciones basadas en cookie mediante `Origin` permitido más `SameSite`.
- Evitar redirecciones abiertas: el destino después de verificar se decide en servidor a partir del estado de onboarding.
- Los textos deben ser neutrales y no pedir nombre, edad, peso ni información de salud.
