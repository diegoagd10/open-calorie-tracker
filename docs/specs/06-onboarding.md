# 06 — Onboarding y metas iniciales

## Objetivo

Obligar a todo usuario recién verificado a elegir sistema de unidades y definir manualmente sus ocho metas diarias antes de acceder al registro. Guardar la configuración y primera versión de metas de forma atómica, accesible y sin solicitar datos de perfil de salud.

## Contexto y dependencias

- Fuente de verdad de producto: [docs/PRD.md](../PRD.md), secciones 4, 6, 11 y 12.
- Requiere specs 01–05: sesión verificada, middleware de auth y tablas `user_preferences`/`goal_versions`.
- Los sistemas de presentación son `us` y `metric`. La persistencia usa unidades canónicas: calorías kcal, agua ml, macronutrientes/fibra/azúcar en gramos y sodio en mg.
- Metas requeridas: calorías, agua, proteína, carbohidratos, grasa, fibra, azúcar y sodio. Azúcar y sodio son máximos; las otras seis son objetivos.
- El producto no calcula ni recomienda metas y no solicita nombre, edad, sexo, altura, peso u otro perfil de salud.

## Alcance

### Dentro

- Guardas para dirigir usuarios verificados pero incompletos a `/onboarding`.
- Selección US/métrico y formulario de las ocho metas.
- Conversión de presentación a unidades canónicas y vuelta a presentación sin deriva material.
- Primera `goal_version` efectiva desde la fecha local elegida para completar onboarding.
- API de lectura y finalización atómica.
- Validación, errores, accesibilidad y tests.

### Fuera

- Recomendaciones, defaults personalizados o cálculo a partir del cuerpo/actividad.
- Editar metas después del onboarding y escoger fechas históricas/futuras; una spec posterior deberá reutilizar el modelo versionado.
- Dashboard completo, registro de alimentos o agua.
- Perfil personal, Health Score, coaching, gamificación o lenguaje moral.

## Tareas en orden

1. Definir en `packages/domain`:
   - `UnitSystem = "us" | "metric"`.
   - `DailyGoals` con los ocho campos requeridos y unidades canónicas explícitas.
   - Validación finita, estrictamente positiva y con máximos técnicos amplios que eviten overflow sin convertirlos en consejo de salud.
   - Funciones puras de conversión y redondeo para agua (`fl oz ↔ ml`) y unidades nutricionales si la UI decide mostrarlas de forma distinta.
2. Definir el contrato de request con `unitSystem`, ocho valores, `localDate` (`YYYY-MM-DD`) y `timeZone` IANA. La fecha debe corresponder al “hoy” del cliente dentro de una tolerancia documentada; no confiar en una fecha arbitrariamente lejana.
3. Implementar una operación transaccional idempotente `completeOnboarding(userId, input)` que:
   - Inserte/actualice `user_preferences`.
   - Cree la primera `goal_versions` efectiva en `localDate`.
   - Marque `onboarding_completed_at` solo después de validar y escribir ambas.
   - Devuelva el estado guardado; una repetición idéntica no duplica versiones.
4. Implementar endpoints autenticados:
   - `GET /me/onboarding` → unidad, metas existentes si las hay y `completed`.
   - `PUT /me/onboarding` → valida y completa atómicamente.
   Ambos deben limitarse al usuario de la sesión y devolver errores de campo estructurados.
5. Actualizar `GET /auth/session` para incluir únicamente `onboardingCompleted: boolean` y permitir routing sin exponer metas innecesariamente.
6. Crear `/onboarding` en Ionic React con dos pasos o una sola pantalla claramente seccionada:
   - Selector accesible US/Metric.
   - Inputs numéricos para las ocho metas con unidad visible y texto que distingue target de maximum.
   - Botón Save deshabilitado solo mientras se envía, no como sustituto de errores claros.
7. No precargar recomendaciones de salud. Se pueden mostrar ejemplos de formato neutrales, pero todos los valores deben ser introducidos conscientemente por el usuario y ningún input puede ocultarse.
8. Al cambiar sistema de unidades después de introducir agua, convertir el valor actual conservando el valor canónico y avisar el cambio de unidad; no resetear silenciosamente el formulario.
9. Implementar manejo de errores: conservar valores ante 4xx/5xx, asociar errores a campos, enfocar el resumen del error y permitir reintento sin duplicar datos.
10. Añadir guardas de navegación:
    - No autenticado → `/login`.
    - Autenticado e incompleto → `/onboarding`, incluso si abre una ruta de log directa.
    - Autenticado y completo → ruta inicial del log (puede ser placeholder hasta spec 07).
    - Un usuario completo que abre `/onboarding` se redirige al log; editar metas no se habilita aquí.
11. Probar conversiones con tablas de casos, validación de los ocho campos, atomicidad ante fallo simulado, aislamiento entre usuarios, idempotencia, routing y flujo de teclado/lector de pantalla.
12. Documentar unidades canónicas, precisión visible, límites técnicos y la diferencia semántica entre target y maximum.

## Criterios de aceptación verificables

- Un usuario verificado sin onboarding no puede abrir la ruta del log y siempre llega a `/onboarding`.
- El formulario exige exactamente las ocho metas y el sistema US/métrico; no solicita ningún dato de perfil prohibido.
- Guardar datos válidos crea una preferencia y exactamente una versión de metas con la fecha local enviada, marca onboarding completo y redirige al log.
- Un fallo entre preferencias y metas revierte toda la transacción; el usuario sigue incompleto.
- Repetir el mismo `PUT` no duplica versiones ni cambia el instante original de finalización.
- Cambiar US→métrico→US mantiene el valor canónico del agua dentro de la tolerancia de redondeo documentada.
- Azúcar y sodio aparecen como máximos; el resto como objetivos, sin juicios por los números elegidos.
- Un usuario no puede leer o sobrescribir preferencias/metas de otro, aun manipulando payload o URL.
- La pantalla pasa tests de navegación por teclado, labels, mensajes de error, contraste y viewport de 320 px.
- `pnpm verify` termina con código 0.

## Notas técnicas

- Mantener conversiones y validación en `packages/domain` para que API y web usen las mismas reglas, pero la API siempre vuelve a validar.
- La UI puede aceptar decimales; convertir a enteros canónicos antes de persistir usando una única política de redondeo.
- Guardar la zona IANA usada al completar onboarding en preferencias si se necesita para validar “hoy”, pero no usarla para mover registros históricos.
- Los límites técnicos deben prevenir valores no finitos/overflow, no presentarse como rangos saludables.
- La resolución histórica ya existe en DB; esta entrega solo crea la versión inicial.
