# Domain: daily nutrient targets and limits

Status: closed
Labels: wayfinder:grilling, closed
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

Which nutrition references should the product offer as User-configured targets, minimums, ranges, or upper limits, and which should remain informational? Decide the first-release population scope, calorie-target creation, protein policy, carbohydrate/fat/fiber references, added-sugar and total-sugar treatment, saturated-fat and sodium limits, default profiles, over-limit presentation, and reference-profile versioning. Use the accepted research in [08-nutrition-reference-limits](../research/08-nutrition-reference-limits.md) without turning general references into personalized medical advice.

## Comments

### Research artifact (2026-08-02)

See [Research: medical calorie and macro estimation](../research/09-medical-calorie-and-macro-estimation.md). The evidence supports general maintenance-energy estimates such as the 2023 National Academies EER equations, but not a universal personal prescription. It also distinguishes adult 19+ equations and references from adolescent 14–18 values, so the provisional adult/14+ scope needs an explicit product decision before any calculator is designed. The artifact does not resolve this ticket.

See [Research: weight-change calorie model](../research/09-weight-change-model.md). The NASEM EER is the maintenance baseline; a Lose/Gain target-date calculation requires an independently implemented, attributed dynamic model in the style of the NIDDK Body Weight Planner. The NIDDK tool is not a complete macro-target calculator, and no public source repository or software license for its hosted implementation was identified. This artifact does not resolve the ticket.

### Resolution (2026-08-02)

V1 targets adults 19+ and provides an optional, general Nutrition estimate. The estimate requires age, the sex category used by the selected equation, height, weight, and an explicitly selected activity level: `Inactive`, `Low active`, `Active`, or `Very active`. If any required input is missing, the app shows no estimate and allows a manual target instead of guessing. Users aged 14–18, pregnancy/lactation, clinical conditions, eating-disorder concerns, unusual training demands, and other situations needing individualized care are outside this target-calculation profile and must not receive an automatic profile.

The User selects a Nutrition plan: Lose, Maintain, or Gain. Maintain uses a maintenance estimate from the 2023 National Academies EER equations. Lose and Gain require a target weight and target date and use an independently implemented, documented, and attributed dynamic energy-balance model in the style of the NIDDK Body Weight Planner; the app does not copy the hosted tool or use NIH/NIDDK branding. The resulting Nutrition target is a proposal, not an active target, until the User reviews and confirms it. No universal deficit or surplus is hard-coded.

After confirmation, the generated profile activates these references, with per-nutrient editing or disabling available:

- Protein: `1.2–1.6 g/kg/day` general range; `0.8 g/kg/day` shown separately as an adequacy reference, with no universal maximum.
- Total carbohydrates: `45–65%` of calories.
- Total fat: `20–35%` of calories.
- Fiber: minimum of `14 g per 1,000 kcal` when a calorie target exists; no general maximum.
- Saturated fat: general upper reference below `10%` of daily calories, not a personalized clinical limit.
- Sodium: general upper reference below `2,300 mg/day` for adults 19+, not a personalized clinical limit.
- Total sugar: tracked separately and informational, with no default daily limit.
- Added sugar: tracked separately; the `50 g` FDA value is label-reference context only, not a personal default target.

The app may show an optional secondary Label reference profile based on standardized FDA 2,000-kcal labeling values. It is clearly separated from the User's Nutrition target and never becomes the default personal goal. Without a confirmed Nutrition target or manual target, the Daily summary shows consumed totals and reference information but no active progress evaluation. Target indicators use neutral, direction-specific language such as `below minimum`, `within range`, `above range`, and `over upper reference`; they do not diagnose, shame, or treat a one-day deviation as a health conclusion.

Every generated estimate and confirmed target stores its reference-profile version, source edition/date, model version, and input values. Later guideline or model changes apply only to new estimates and targets; historical targets do not silently change. The supporting evidence is captured in [medical calorie and macro estimation research](../research/09-medical-calorie-and-macro-estimation.md) and [weight-change model research](../research/09-weight-change-model.md). This resolves the nutrition-target domain decision without implementing runtime code.
