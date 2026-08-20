# 14 — Alimentos favoritos

## Objetivo

Permitir guardar una configuración de food entry exitosa como favorito, reutilizarla con sus cantidades/nutrición guardadas y eliminarla sin alterar ocurrencias históricas.

## Contexto y dependencias

- Fuente de verdad: PRD.md, sección 10, historia OCT-008.
- Requiere specs 01–13: snapshot food estable y aislamiento de edición.
- Un favorito es un template privado, no una referencia viva al catálogo o entry original.

## Alcance

### Dentro

- Migración favorite_foods con snapshot propio.
- Save/list/log/remove y UI bajo Saved foods and reusable plates.
- Reuso en hoy o pasado con reglas temporales existentes.

### Fuera

- Reusable plates; spec 19.
- Offline; spec 21.
- Compartir favoritos o editar el catálogo.

## Tareas en orden

1. Añadir favorite_foods con owner, display name, measurement, basis, nutrients/other facts y timestamps.
2. Crear favorito desde entry successful propia; rechazar pending/failed.
3. Copiar snapshot completo en transacción, sin FK funcional que cambie historia.
4. Implementar GET /saved-foods, POST desde entry, POST /days/:date/from-favorite y DELETE.
5. Al reutilizar, crear food_entry nueva con source=favorite y cantidades guardadas.
6. Integrar lista/búsqueda básica en la primera opción de Add Food.
7. Permitir eliminar con confirmación; mantener entries ya registradas.
8. Probar aislamiento, duplicados, eliminación del original/favorito y nutrientes null.

## Criterios de aceptación verificables

- Solo successful entries pueden guardarse.
- Reutilizar crea una ocurrencia nueva con snapshot idéntico y hora/reglas del día.
- Cambiar/borrar entry original no cambia favorito.
- Borrar favorito no cambia ocurrencias pasadas.
- Dos usuarios nunca ven/reutilizan favoritos ajenos.
- La primera opción Add Food muestra favoritos aun antes de plates reutilizables.
- Tests confirman snapshot isolation y pnpm verify pasa.

## Notas técnicas

- Mantener source provenance para diagnóstico sin acoplar el valor nutricional.
- Un favorito puede tener mismo nombre que otro; usar ID para identidad.
- No convertir nutrientes desconocidos a cero al copiar.
