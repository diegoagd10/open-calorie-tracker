# 12 — Resumen diario de calorías y nutrición

## Objetivo

Mostrar calorías y seis nutrientes contra las metas activas del día, con progreso neutral y propagación correcta de datos faltantes.

## Contexto y dependencias

- Fuente de verdad: [docs/PRD.md](../PRD.md), sección 6, historia OCT-006.
- Requiere specs 01–11: metas históricas y food entries ordenadas.
- Calorías son consumed-only; nunca restan ejercicio. Sugar y sodium son maximums; los demás son targets.
- Un valor desconocido es unavailable y vuelve incompleto solo el total afectado.

## Alcance

### Dentro

- Agregación server/domain de valores conocidos.
- Calorie summary fijo y nutrition carousel 3+3.
- Indicadores circulares accesibles, exceso neutral y estados incompletos.
- Invalidation tras futuras mutaciones mediante una única query derivada.

### Fuera

- Water summary, ya en spec 08 y siempre fuera del carrusel.
- Health Score, ejercicio, coaching, analytics semanales/mensuales.
- Cache materializado prematuro.

## Tareas en orden

1. Implementar funciones puras de suma por nutriente usando enteros/decimales canónicos.
2. Excluir entries pending/failed y sumar valores conocidos de successful.
3. Para cada nutriente devolver consumed, goalOrMaximum, incomplete y semanticType.
4. Extender GET /days/:date con summary resuelto contra goal_version activa.
5. Renderizar calorie summary fijo sobre el carrusel con eaten versus goal y texto alternativo al círculo.
6. Renderizar página 1 protein/carbohydrates/fat y página 2 fiber/sugar/sodium, tres tarjetas compactas cada una.
7. Mostrar unavailable por valor faltante y una marca textual de total incompleto.
8. Permitir swipe y controles explícitos/teclado para el carrusel; preservar foco al cambiar página.
9. Mostrar exceso sin error, warning moral ni cambio que implique “bad”.
10. Probar combinaciones completas/parciales, cero real, metas históricas, exceso, rounding y exclusión de fallos.

## Criterios de aceptación verificables

- Calories permanece visible mientras se cambia el carrusel y muestra eaten/goal.
- Las páginas contienen exactamente los nutrientes y orden del PRD.
- Un null no aparece como 0; los valores conocidos continúan sumándose.
- Solo el total cuyo dato falta se marca incomplete.
- Failed/pending no alteran ningún total.
- Sugar/sodium dicen maximum; el resto target.
- Exceso se comunica neutralmente y cada gráfico tiene equivalente textual.
- Tests de dominio cubren aritmética y pnpm verify pasa.

## Notas técnicas

- Preferir agregado on-read hasta medir necesidad de cache; reduce invalidation bugs.
- Redondear solo en presentación y usar la misma función en API/UI.
- El círculo no puede ser la única fuente de valor ni estado.
- “Unavailable” describe datos, no fracaso del usuario.
