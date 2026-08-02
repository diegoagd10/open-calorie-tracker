# Research: food data and estimation policy

Status: needs-triage
Labels: wayfinder:research, needs-triage
Parent: ../spec.md
Blocked by: none

## Question

What can the existing Open Food Facts integration reliably provide for barcode lookup and ingredient search, and what policy should the product use when records are missing, conflicting, localized, or rate-limited? Pair those facts with the AI image-extraction capability already present in the repository to define where the app presents sourced values, estimates, or an explicit “enter manually” fallback.

This ticket is research-first: it should return facts and constraints before a product decision is finalized in the food-input and recipe tickets.

## Comments
### Research resolution (2026-08-02)

La investigación AFK está capturada en [05-food-data-and-estimation-policy.md](../research/05-food-data-and-estimation-policy.md). Resume las capacidades y límites primarios de Open Food Facts, el contrato actual de `src/server.js` y `src/extract-ingredients.js`, las restricciones relevantes de imagen/Structured Outputs de OpenAI y una política recomendada para distinguir valores sourced, candidatos/estimaciones y entrada manual.

La evidencia no cierra todavía la decisión de producto: deja abiertas la disponibilidad exacta del índice Search-a-licious para términos/ingredientes, la política de locales/conflictos, la arquitectura de cache/rate limiting y la privacidad de imágenes. No se modificó código de runtime.
