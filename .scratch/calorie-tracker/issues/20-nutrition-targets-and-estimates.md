# 20 - Configure and confirm Nutrition targets and estimates

**What to build:** Implement the optional Daily Targets surface, manual targets, adult Nutrition estimates, neutral reference statuses, and explicit confirmation/versioning for generated targets.

**Blocked by:** 13 - Navigate and correct the Daily log.

**Status:** ready-for-agent

**Mockup starting point:** Start with the Daily Targets view, calorie readout target states, nutrient reference readouts, no-target fixture, upper-reference fixture, and settings copy in `public/mockup.html`.

- [ ] The User can enter manual calorie and nutrient targets or disable individual references; no target is inferred and no progress evaluation appears before a manual or generated target is confirmed.
- [ ] The estimator accepts only the supported general adult 19+ profile inputs: age, equation sex category, height, weight, and explicit Inactive, Low active, Active, or Very active activity level.
- [ ] Maintain uses the 2023 National Academies EER equations; Lose and Gain require target weight/date and use an independently implemented, attributed dynamic energy-balance model rather than a fixed deficit or surplus.
- [ ] Generated targets are visible proposals until confirmation, and unsupported age/life-stage or clinically sensitive scope is explained without presenting an automatic profile.
- [ ] Confirmed references include protein `1.2-1.6 g/kg/day` plus separate `0.8 g/kg/day` adequacy context, carbohydrate `45-65%`, total fat `20-35%`, fiber minimum `14 g/1,000 kcal`, saturated fat below `10%` of calories, sodium below `2,300 mg/day`, informational total sugar, and added-sugar label context of `50 g`.
- [ ] The optional FDA Label profile remains separate from personal targets; statuses use neutral labels such as below minimum, within range, above range, and over upper reference.
- [ ] Every generated estimate and confirmed target stores source edition/date, reference-profile version, model version, and input values so later updates do not rewrite history.
- [ ] Calculation fixtures cover equations, dynamic weight-change behavior, boundaries, warnings, confirmation, editing/disabling references, and Daily log rendering without medical or shame-based language.
