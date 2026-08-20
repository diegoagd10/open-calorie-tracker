# 08 — Registro y progreso de agua

## Objetivo

Permitir registrar agua pura con cantidad exacta o presets, ver progreso diario en el sistema de unidades elegido y abrir los eventos individuales para editarlos o eliminarlos.

## Contexto y dependencias

- Fuente de verdad: PRD.md, sección 11, historia OCT-003.
- Requiere specs 01–07: usuario completo, día seleccionado, metas históricas y SQLite.
- El valor canónico es mililitros enteros; Glass=8 fl oz, Bottle=16 fl oz y Large bottle=24 fl oz permanecen como cantidades US aunque se muestren convertidas.

## Alcance

### Dentro

- Migración water_events con owner, local_date, time, timezone, amount_ml y timestamps.
- API create/list/update/delete aislada por usuario y fecha.
- Log Water exacto y presets; summary fuera del carrusel.
- Total, equivalencia de vasos de 8 fl oz, meta y eventos individuales.

### Fuera

- Otras bebidas; se registran como foods.
- Offline/sync; specs 21, 22 y 25.
- Recordatorios, coaching o recomendación de consumo.

## Tareas en orden

1. Añadir tabla/index water_events y repositorio transaccional con orden newest-first.
2. Crear funciones de conversión fl oz↔ml y política de redondeo visible sin cambiar el valor canónico.
3. Implementar POST /days/:date/water-events con amount/unit, timezone e idempotency key; rechazar futuro y cantidades no positivas.
4. Implementar GET, PATCH y DELETE por ID con propiedad obligatoria y sin mover fecha.
5. Para hoy usar hora local actual; para pasado aplicar 12:00 o un minuto después del evento más nuevo del día.
6. Extender GET /days/:date con water total, glassesEquivalent, goal efectiva y eventos.
7. Crear bloque Water fuera del carrusel y acción Log Water.
8. Ofrecer exactamente Glass 8, Bottle 16 y Large bottle 24 fl oz, más cantidad exacta.
9. Crear detalle con cada evento editable/eliminable, confirmación apropiada y lenguaje neutral.
10. Probar presets US/métrico, exacto, pasado/futuro, edición, borrado, aislamiento, idempotencia y DST.

## Criterios de aceptación verificables

- Los tres presets persisten cantidades canónicas equivalentes a 8/16/24 fl oz en US y métrico.
- El summary muestra volumen, vasos de 8 fl oz y progreso hacia la meta histórica del día.
- Cada evento conserva cantidad y hora y puede editarse/eliminarse sin afectar otro.
- Futuro rechaza altas y pasado aplica la regla horaria del PRD.
- Otras bebidas no aparecen como opción de Water.
- Superar la meta se muestra factual, sin warning moral.
- Tests demuestran aislamiento y pnpm verify pasa sin red.

## Notas técnicas

- Usar una constante exacta documentada para 1 US fl oz = 29.5735295625 ml y redondear solo al borde de persistencia/presentación.
- No derivar la cantidad canónica de un string ya redondeado en UI.
- El equivalente de vasos es informativo y puede ser decimal; incluir texto accesible alternativo al progreso circular.
