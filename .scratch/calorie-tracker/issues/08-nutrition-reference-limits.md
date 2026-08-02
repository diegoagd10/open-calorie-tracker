# Research: nutrition reference targets and limits

Status: needs-triage
Labels: wayfinder:research, needs-triage
Parent: ../spec.md
Blocked by: none

## Question

Which official, non-diagnostic nutrition references should the product use for daily progress indicators, and how should the UX distinguish a user-defined calorie target, nutrient minimums, recommended ranges, and upper limits? Research official public-health or regulatory sources for the nutrients in scope, record the applicability and limitations of each reference, and recommend language that does not imply personalized medical advice.

The research must not invent a universal maximum for every macronutrient. It should explicitly identify which values are targets, minimums, ranges, or limits, and leave user-specific goal configuration for the domain decision.

## Comments

### Research resolution (2026-08-02)

La investigación está capturada en [08-nutrition-reference-limits.md](../research/08-nutrition-reference-limits.md). Distingue metas del usuario, mínimos, rangos, límites superiores y referencias regulatorias de etiqueta para calorías, proteína, fibra, carbohidratos, grasa, azúcar total/añadido, grasa saturada y sodio. Deja abiertas las decisiones de población, cálculo de metas, perfil por defecto y semántica del campo “azúcar”. No se modificó código de runtime ni se cerró el ticket.
