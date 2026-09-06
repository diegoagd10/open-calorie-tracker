# Domain docs

## Before exploring

Read root `CONTEXT.md` and any decisions in `docs/adr/` relevant to the area being explored.

If these files are absent, proceed silently. The domain-modeling skill creates them as terminology and decisions are resolved.

## Layout

This repo uses a single context:

- `CONTEXT.md`: domain vocabulary and model.
- `docs/adr/`: architecture decision records.

## Vocabulary

Use terms defined in `CONTEXT.md` when naming domain concepts in issues, proposals, hypotheses, and tests. If a concept is missing, reconsider the terminology or note the gap for domain-modeling.

## Decisions

Explicitly flag proposals that contradict an existing ADR, identifying the decision and why it should be reconsidered.
