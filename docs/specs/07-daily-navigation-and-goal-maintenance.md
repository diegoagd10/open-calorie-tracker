# 07 — Navegación diaria y mantenimiento histórico de metas

## Objetivo

Permitir que un usuario con onboarding completo abra hoy o cualquier fecha pasada mediante tira horizontal y calendario, y cambie sus metas desde una fecha elegida sin alterar las metas visibles en días anteriores.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), secciones 5 y 12, historia OCT-002.
- Requiere specs 01–06: sesión, onboarding y goal_versions.
- La fecha del registro es YYYY-MM-DD local; no se deriva nuevamente de UTC.
- No hay límite artificial de historia y las fechas futuras no aceptan food/water.

## Alcance

### Dentro

- Ruta diaria con fecha seleccionada, tira de fechas cercanas y calendario para pasado.
- API para leer día/metas y crear una nueva versión de metas efectiva desde una fecha.
- Resolución histórica determinista de metas.
- Estados vacío, carga/error y accesibilidad completa.

### Fuera

- Registros de alimentos/agua, summaries y tarjetas; specs posteriores.
- Analytics semanales/mensuales, scoring o colorear días moralmente.
- Mover registros entre fechas.

## Tareas en orden

1. Definir SelectedLocalDate y resolución de hoy a partir de zona IANA validada.
2. Implementar GET /days/:date que devuelva fecha, metas efectivas y colecciones vacías hasta specs posteriores.
3. Implementar GET /me/goals?date= y PUT /me/goals/effective/:date con las ocho metas y unit system de presentación.
4. En una transacción, insertar o reemplazar la versión del mismo effective_date sin modificar versiones anteriores.
5. Rechazar edición para otro usuario, fechas inválidas y valores no positivos; permitir vigencia desde hoy o una fecha pasada elegida con confirmación explícita.
6. Crear ruta /log/:date; tras onboarding, / redirige al hoy local.
7. Crear tira horizontal de fechas cercanas que solo identifica la selección, con botones anterior/siguiente y sin score/color moral.
8. Crear calendario que permita cualquier pasado, destaque hoy/selección de forma accesible y deshabilite futuro para altas.
9. Añadir pantalla/formulario de metas que indique la fecha de vigencia y targets frente a maximums.
10. Probar cambio de mes/año, historia profunda, DST, viaje de zona, dos versiones, reemplazo idempotente y aislamiento.

## Criterios de aceptación verificables

- Tras onboarding se abre el log de hoy local.
- La tira y el calendario abren cualquier fecha pasada sin límite impuesto por API.
- Una fecha futura puede identificarse en navegación solo si el diseño lo necesita, pero ninguna acción de alta está habilitada.
- Una meta nueva efectiva el 10 no cambia el valor resuelto para el 9 y sí cambia el 10.
- Cambiar de zona no mueve registros ni versiones históricas a otro día.
- La fecha se anuncia a lector de pantalla y toda navegación funciona con teclado a 320 px.
- No aparecen scores, juicios, reportes semanales/mensuales ni acción “move date”.

## Notas técnicas

- Usar date-only para identidad de negocio y Temporal/polyfill o una librería bien probada para zona IANA.
- El servidor valida la relación fecha/zona; no confía únicamente en clientNow.
- Mantener la respuesta GET /days extensible para alimentos, agua y totals.
- La historia “sin límite” requiere paginar eventos dentro del día, no restringir fechas.
