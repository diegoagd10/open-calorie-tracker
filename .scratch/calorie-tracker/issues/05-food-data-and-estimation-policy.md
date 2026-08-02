# Research: food data and estimation policy

Status: closed
Labels: wayfinder:research, closed
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

What can the existing Open Food Facts integration reliably provide for barcode lookup and ingredient search, and what policy should the product use when records are missing, conflicting, localized, or rate-limited? Pair those facts with the AI image-extraction capability already present in the repository to define where the app presents sourced values, estimates, or an explicit “enter manually” fallback.

This ticket is research-first: it should return facts and constraints before a product decision is finalized in the food-input and recipe tickets.

## Comments
### Research resolution (2026-08-02)

La investigación AFK está capturada en [05-food-data-and-estimation-policy.md](../research/05-food-data-and-estimation-policy.md). Resume las capacidades y límites primarios de Open Food Facts, el contrato actual de `src/server.js` y `src/extract-ingredients.js`, las restricciones relevantes de imagen/Structured Outputs de OpenAI y una política recomendada para distinguir valores sourced, candidatos/estimaciones y entrada manual.

La evidencia no cierra todavía la decisión de producto: deja abiertas la disponibilidad exacta del índice Search-a-licious para términos/ingredientes, la política de locales/conflictos, la arquitectura de cache/rate limiting y la privacidad de imágenes. No se modificó código de runtime.

### Wayfinder resolution (2026-08-02)

The cited artifact is accepted as the research resolution. Open Food Facts is suitable for barcode lookup but is collaborative and may be incomplete, localized, or quality-flagged; a found product is therefore a reviewable candidate, not a verified label. Its current APIs do not provide the free-text ingredient search the product would need, and the public Search-a-licious contract remains unvalidated, so ingredient-term matching must retain a manual fallback and must not use search-as-you-type against the public limits.

The existing POC confirms the implementation gaps: it handles a narrow barcode lookup, does not classify provider failures, and does not implement term search, cache, backoff, quality handling, or durable source separation. The image POC can produce structured `food`/`no food` and ingredient proposals, but structured output does not establish visual truth or calibrated confidence. The resolved food-input policy therefore treats image ingredients and visible portion proposals as editable candidates, requires explicit confirmation, preserves missing/conflicting values, and keeps manual entry available. The product decision that source details belong only in backend troubleshooting logs supersedes any research suggestion to expose provenance in the normal UI.

Provider validation, cache/rate-limit strategy, deployment concentration, image privacy, and model access/cost remain work for the technical, privacy, and implementation-planning tickets; they are not silently decided by this research ticket. No runtime code changed.
