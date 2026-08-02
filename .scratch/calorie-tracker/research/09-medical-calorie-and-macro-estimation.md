# Research: medical calorie and macro estimation

Date: 2026-08-02  
Ticket: [09-daily-nutrient-targets-and-limits](../issues/09-daily-nutrient-targets-and-limits.md)  
Status: evidence captured as input for Wayfinder; this artifact does not resolve the ticket or make a product decision.  
Scope: generally healthy people, with special attention to the difference between adults aged 19+ and adolescents aged 14–18. This is not individualized medical advice.

## Executive summary

- There are accepted methods for estimating energy needs, but they estimate different things. The 2023 National Academies report provides Estimated Energy Requirement (EER) equations for total energy expenditure using age, sex, height, weight, and a physical-activity category. Mifflin–St Jeor is a validated predictive equation for resting energy expenditure, not a complete daily-calorie prescription.
- The National Academies explicitly warns that the physical-activity category is difficult to classify and that an individual’s actual requirement can differ substantially from the calculated EER. Monitoring weight and adjusting over time is part of using the estimate correctly.
- Weight-change targets are population-level clinical guidance, not automatic calculator outputs. NIH guidance commonly starts with a modest goal such as 5–10% of starting weight over six months for people who would benefit from weight loss; older NHLBI guidance describes a 500–1,000 kcal/day deficit for approximately 1–2 lb/week. Neither should be presented as a universal safe prescription.
- Protein has multiple valid reference types: the DRI adequacy reference is about 0.8 g/kg/day for adults, the AMDR is 10–35% of energy, and the current Dietary Guidelines for Americans (2025–2030) gives a general protein serving goal of 1.2–1.6 g/kg/day. These are not interchangeable and none is a universal medical maximum.
- Carbohydrate and total fat are best represented as energy-distribution ranges, not universal daily maximums: 45–65% of energy from carbohydrate and 20–35% from total fat for adults. Fiber is an adequacy reference, commonly 14 g per 1,000 kcal, not a general maximum.
- Saturated fat and sodium have population-level upper-reference guidance. The current Dietary Guidelines say saturated fat should not exceed 10% of calories and sodium should be below 2,300 mg/day for the general population aged 14 and older. These are public-health references, not patient-specific limits; highly active people and people with medical conditions may need different guidance.
- Total sugar and added sugar must remain separate. FDA assigns no Daily Value to total sugar. FDA’s added-sugar label reference is 50 g/day on a 2,000-kcal diet, while the current Dietary Guidelines uses different, more food-pattern-oriented language and says no amount of added sugar is recommended as part of a healthy diet, with a one-meal limit of 10 g. The 50 g label value must not be treated as a universal personalized target.
- A self-service estimator should be limited to general informational estimates unless it collects appropriate life-stage and health context and clearly routes users with pregnancy, chronic disease, eating-disorder symptoms, underweight, medication-related concerns, or unusual training demands to a clinician or registered dietitian.

## How to interpret the references

The NIH Office of Dietary Supplements describes Dietary Reference Intakes (DRIs) as references for planning and assessing intakes of healthy people. They vary by age and sex and include different categories with different meanings: RDA, AI, EAR, and UL. ODPHP also lists EER, AMDR, and CDRR as distinct reference categories. A reference value is not automatically a personal goal or a clinical prescription.

| Reference type | Meaning | Appropriate product language |
| --- | --- | --- |
| EER | Estimated energy intake predicted to maintain energy balance for a defined age, sex, body size, activity category, and life stage | `estimated maintenance calories` |
| RDA | Intake sufficient for nearly all healthy people in a defined age/sex/life-stage group | `adequacy reference` or `at least` |
| AI | Adequacy reference used when evidence is insufficient to establish an RDA | `adequacy reference`; do not imply the exact individual requirement is known |
| AMDR | Range of energy distribution from a macronutrient associated with nutrient adequacy and lower chronic-disease risk | `general range`, not a minimum or maximum gram target by itself |
| UL | Highest average daily intake unlikely to pose adverse effects for nearly all people in a defined group | `upper reference`; not the same as a treatment limit |
| CDRR | Intake level associated with reduced chronic-disease risk under a specific evidence methodology | `population risk-reduction reference` |
| FDA DV | Standardized label reference, generally based on a 2,000-kcal diet | `label reference`, not a personal goal |

Sources: [NIH ODS, Nutrient Recommendations and Databases](https://ods.od.nih.gov/healthinformation/nutrientrecommendations.aspx) (accessed 2026-08-02); [ODPHP, Dietary Reference Intakes](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/dietary-reference-intakes) (last updated 2025-11-19; accessed 2026-08-02); [National Academies, Sodium and Potassium DRI model](https://nap.nationalacademies.org/resource/25353/interactive/) (2019; accessed 2026-08-02).

## Calories and total energy

### The strongest general-purpose population method: NASEM EER

The National Academies’ 2023 *Dietary Reference Intakes for Energy* defines EER as the average intake predicted to maintain energy balance for a person with defined age, sex, height, weight, physical-activity level, and life stage. The report’s adult equations are total-energy-expenditure models, not resting-metabolism equations.

For adults aged 19 and older, the 2023 report provides four equations for women and four for men. Height is in centimeters, weight in kilograms, and age in years. For example:

| Group | Inactive | Low active | Active | Very active |
| --- | --- | --- | --- | --- |
| Women 19+ | `584.90 − 7.01A + 5.72H + 11.71W` | `575.77 − 7.01A + 6.60H + 12.14W` | `710.25 − 7.01A + 6.54H + 12.34W` | `511.83 − 7.01A + 9.07H + 12.56W` |
| Men 19+ | `753.07 − 10.83A + 6.50H + 14.10W` | `581.47 − 10.83A + 8.30H + 14.94W` | `1004.82 − 10.83A + 6.52H + 15.91W` | `−517.88 − 10.83A + 15.61H + 19.11W` |

These equations are published in Appendix G of the report. The report also provides separate age-dependent equations for children and adolescents aged 3–18, plus pregnancy and lactation equations. Therefore, a single adult equation should not be applied to a 14–18-year-old user.

The report’s application guidance says to select the activity category, calculate the EER, then monitor body weight over time and adjust intake as required. It explicitly notes that actual individual requirements may vary considerably from the EER. The committee also found that classifying people into activity categories is difficult: associations between doubly labeled water measurements and accessible proxies such as step counts or activity questionnaires were generally weak.

Source: [National Academies, *Dietary Reference Intakes for Energy*](https://www.ncbi.nlm.nih.gov/books/n/nap26818/pdf/) (2023; Appendix G, pp. 301–302; application and limitations, pp. 145–177; accessed 2026-08-02).

### Mifflin–St Jeor: useful resting-energy estimate, not total daily need

The original Mifflin–St Jeor study developed a predictive equation for resting energy expenditure (REE) from healthy adults aged 19–78. The commonly used form is:

```text
Male:   RMR = 10 × weight_kg + 6.25 × height_cm − 5 × age_years + 5
Female: RMR = 10 × weight_kg + 6.25 × height_cm − 5 × age_years − 161
```

The equation estimates resting energy expenditure. It does not directly include physical activity, the thermic effect of food, growth, pregnancy, lactation, illness, or other clinical energy costs. Multiplying it by an activity factor is a practical heuristic, but the result is still an estimate and is not equivalent to a measured requirement.

The 2023 National Academies report lists Mifflin–St Jeor among the commonly used predictive equations and warns that prediction error varies with age, sex, ethnicity, and BMI category. The NIH/NIDDK Body Weight Planner’s research appendix also states that it estimated resting metabolic rate using Mifflin–St Jeor within a larger dynamic weight-change model. This supports Mifflin–St Jeor as a recognized clinical/research input, not as an official universal daily-calorie target.

Sources: [Mifflin et al., “A new predictive equation for resting energy expenditure”](https://pubmed.ncbi.nlm.nih.gov/2305711/) (1990; accessed 2026-08-02); [National Academies, *Dietary Reference Intakes for Energy*](https://www.ncbi.nlm.nih.gov/books/n/nap26818/pdf/) (2023, pp. 46–47; accessed 2026-08-02); [NIDDK Body Weight Planner research appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf) (accessed 2026-08-02).

### Activity and total-energy caveats

Energy needs can change with age, body size and composition, physical activity, growth, pregnancy, lactation, illness, medications, and changes in body weight. Wearables and step counts are not reliable substitutes for a validated total-energy measurement or a correctly selected PAL category. Even a well-selected equation estimates an average or expected value, not a guaranteed personal requirement.

The correct operational interpretation is iterative:

1. Estimate maintenance energy from an appropriate equation and life-stage profile.
2. Treat the result as a starting estimate with visible uncertainty.
3. Compare the estimate with weight and other relevant outcomes over time.
4. Adjust with the user or clinician when the observed trend differs from the intended trend.

The last step is evidence-based guidance from the National Academies, not a product decision. A one-day calorie total cannot validate or invalidate an energy estimate.

## Weight-change targets

Weight-change guidance depends on whether weight loss is appropriate for the person, the starting weight and health context, the desired rate, and whether a clinician is involved.

- NIDDK consumer guidance says adults who would benefit from weight loss should often begin with 5–10% of starting weight over six months. Its clinician guidance also warns that weight loss is not the right goal for every person with a BMI above 25; age, sex, health status, medical history, and cardiometabolic risk matter.
- Older NHLBI obesity guidance describes 1–2 lb/week as a reasonable rate for an obesity-treatment program and associates it with a 500–1,000 kcal/day deficit. This is a clinical-program reference, not a safe default for every user. It is especially inappropriate to apply without screening for low body weight, pregnancy, eating-disorder risk, medical conditions, or medication effects.
- The NIH Body Weight Planner models a goal weight, time period, intake, and activity change dynamically. NIDDK states that it is for adults aged 18 and older, not younger people or pregnant/breastfeeding women, and is not medical advice. That limitation is important: even an official personalized planning tool does not claim to replace a health-care professional.
- The National Academies notes that energy requirements decrease as body weight decreases, so a static deficit will not remain a static intervention over a long weight-loss period.

Sources: [NIDDK, Health Tips for Adults](https://www.niddk.nih.gov/health-information/weight-management/healthy-eating-physical-activity-for-life/health-tips-for-adults) (accessed 2026-08-02); [NIDDK, Talking with Your Patients about Weight](https://www.niddk.nih.gov/health-information/professionals/clinical-tools-patient-management/weight-management/talking-with-your-patients-about-weight) (accessed 2026-08-02); [NHLBI, Practical Guide to the Identification, Evaluation, and Treatment of Overweight and Obesity in Adults](https://www.nhlbi.nih.gov/files/docs/guidelines/prctgd_c.pdf) (historical clinical guideline; accessed 2026-08-02); [NIDDK, About the Body Weight Planner](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner) (last reviewed 2017-05; accessed 2026-08-02).

## Protein, carbohydrate, fat, and fiber

### Protein

The DRI table gives age- and sex-specific protein references. For adults aged 19 and older, the familiar adequacy reference is approximately 0.8 g/kg/day using reference body weight. For ages 14–18, the table gives 52 g/day for males and 46 g/day for females, and adolescence should not be collapsed into an adult profile without an explicit product decision.

The AMDR for adults is 10–35% of energy from protein. The current Dietary Guidelines for Americans, 2025–2030, additionally presents a general protein serving goal of 1.2–1.6 g/kg/day, adjusted to individual caloric requirements. The Scientific Foundation describes this range as remaining within the adult AMDR and as a general dietary goal, not as a clinical prescription for every person.

There is no established protein UL for healthy people in the DRI framework. That does not mean unlimited protein is appropriate: high-protein intake can be unsuitable when kidney function, medications, hydration, or other clinical factors are relevant.

Sources: [National Academies/NCBI, DRI table for total water and macronutrients](https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/?report=objectonly) (DRI report 2002/2005; table hosted by NCBI in 2011; accessed 2026-08-02); [National Academies/NCBI, AMDR table](https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t5/?report=objectonly) (DRI report 2002/2005; table hosted by NCBI in 2011; accessed 2026-08-02); [USDA/HHS, Dietary Guidelines for Americans 2025–2030](https://cdn.realfood.gov/DGA.pdf) (10th edition, January 2026, pp. 2 and 8; accessed 2026-08-02); [NIH ODS, Exercise and Athletic Performance health-professional fact sheet](https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/) (accessed 2026-08-02).

### Carbohydrate and total fat

For adults, the DRI carbohydrate RDA is 130 g/day and the AMDR is 45–65% of total energy. The DRI total-fat AMDR is 20–35% of energy. For ages 4–18, the AMDRs differ: carbohydrate remains 45–65%, total fat is 25–35%, and protein is 10–30%. These age distinctions are another reason not to use one adult macro calculator for every user aged 14 and above.

Neither the carbohydrate RDA nor the AMDR is a universal maximum. The FDA’s 275 g carbohydrate and 78 g total-fat Daily Values are standardized label references based on a 2,000-kcal diet, not personalized targets. If a product derives gram ranges from a user-entered calorie target, it should label them as a translation of a general AMDR, not as a medical prescription.

Sources: [National Academies/NCBI, DRI table for macronutrients](https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/?report=objectonly) (2002/2005 DRI report; accessed 2026-08-02); [National Academies/NCBI, AMDR table](https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t5/?report=objectonly) (2002/2005 DRI report; accessed 2026-08-02); [FDA, Daily Value reference guide](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels) (current page; accessed 2026-08-02).

### Fiber

The general DRI planning reference for adults is 14 g of fiber per 1,000 kcal. The age- and sex-specific AI values in the DRI table include:

| Group | Fiber AI |
| --- | ---: |
| Males 14–18 | 38 g/day |
| Females 14–18 | 26 g/day |
| Males 19–50 | 38 g/day |
| Females 19–50 | 25 g/day |
| Males 51+ | 30 g/day |
| Females 51+ | 21 g/day |

The FDA label reference is 28 g/day for a 2,000-kcal diet. The DRI report did not establish a general UL for dietary fiber. The absence of a UL is not a claim that every person tolerates every amount or that supplements are interchangeable with food fiber.

Sources: [National Academies/NCBI, DRI table for macronutrients](https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/?report=objectonly) (2002/2005 DRI report; accessed 2026-08-02); [FDA, Daily Value reference guide](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels) (current page; accessed 2026-08-02).

## Added sugar, total sugar, saturated fat, and sodium

| Nutrient | General reference for healthy people | What it is not |
| --- | --- | --- |
| Total sugar | FDA assigns no Daily Value because no recommendation has been made for a total daily amount. Record it separately for context. | Not a field to which the added-sugar limit can be applied. |
| Added sugar | FDA label DV: 50 g/day on a 2,000-kcal diet, based on less than 10% of energy. The current DGA 2025–2030 says no amount is recommended as part of a healthy diet and says one meal should contain no more than 10 g. | Not a universal personalized “ideal” or medical treatment limit. |
| Saturated fat | Current DGA: no more than 10% of daily calories. FDA label DV: 20 g on a 2,000-kcal diet. | Not a limit on total fat and not a recommendation to eliminate fat. |
| Sodium | Current DGA: less than 2,300 mg/day for the general population aged 14 and older; highly active people may need more to offset sweat losses. FDA label DV is 2,300 mg. | Not a universal clinical limit for hypertension, kidney disease, heart failure, medications, or other conditions. |

Two distinctions matter:

1. The FDA label DV is a standardized comparison tool. It uses 2,000 kcal for general nutrition advice and is not a personal calorie or nutrient prescription.
2. A DRI UL, a CDRR, a Dietary Guideline, and an FDA DV are different evidence/policy objects. The National Academies’ sodium review did not establish a sodium UL because the relevant chronic-disease evidence is handled through the CDRR framework; that does not make sodium unrestricted or make 2,300 mg a treatment threshold.

The current DGA is especially important for added sugar. The federal label still provides the 50 g reference, but the 2025–2030 policy document uses a stricter food-pattern message. The product should preserve the source, edition, date, and semantic category rather than flattening these into one unqualified “maximum.”

Sources: [FDA, Added Sugars on the Nutrition Facts Label](https://www.fda.gov/food/nutrition-facts-label/added-sugars-nutrition-facts-label) (current page; accessed 2026-08-02); [FDA, Daily Value on the Nutrition and Supplement Facts Labels](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels) (current page; accessed 2026-08-02); [USDA/HHS, Dietary Guidelines for Americans 2025–2030](https://cdn.realfood.gov/DGA.pdf) (10th edition, January 2026, pp. 3–5; accessed 2026-08-02); [ODPHP, current Dietary Guidelines](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/current-dietary-guidelines) (last updated 2026-06-10; accessed 2026-08-02); [National Academies, Sodium and Potassium DRI model](https://nap.nationalacademies.org/resource/25353/interactive/) (2019; accessed 2026-08-02).

## When clinician or dietitian oversight is needed

The sources support routing users away from an automatic self-service prescription when any of the following applies:

- pregnancy or breastfeeding;
- age below 18, especially because adolescent energy and nutrient equations differ from adult equations;
- underweight, unintentional weight loss, growth concerns, or a goal that would produce a low BMI;
- chronic kidney disease or altered kidney function, where protein, sodium, potassium, phosphorus, fluids, and calories may need individual adjustment;
- diabetes, hypertension, heart failure, or other conditions where nutrient limits and medication effects can change the plan;
- medications or treatments that affect appetite, weight, fluid balance, glucose, or electrolytes;
- eating-disorder symptoms, compulsive restriction, bingeing, purging, or distress centered on weight and food;
- unusually high training volume, heat exposure, or sweat losses; or
- a need for a therapeutic diet, rapid weight change, or medical nutrition therapy.

NIDDK specifically says that people with chronic kidney disease should work with a health-care professional or registered dietitian to determine protein, sodium, fluid, and calorie needs. NIMH describes eating disorders as serious illnesses requiring medical care, monitoring, and nutritional counseling. NIDDK’s Body Weight Planner also excludes people under 18 and pregnant or breastfeeding women and says it is not medical advice.

Sources: [NIDDK, Healthy Eating for Adults with Chronic Kidney Disease](https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/healthy-eating-adults-chronic-kidney-disease) (accessed 2026-08-02); [NIMH, Eating Disorders: What You Need to Know](https://www.nimh.nih.gov/health/publications/eating-disorders) (accessed 2026-08-02); [NIDDK, About the Body Weight Planner](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner) (last reviewed 2017-05; accessed 2026-08-02); [NIDDK, Talking with Your Patients about Weight](https://www.niddk.nih.gov/health-information/professionals/clinical-tools-patient-management/weight-management/talking-with-your-patients-about-weight) (accessed 2026-08-02).

## Implications for a future product decision

These are research implications, not resolutions for ticket 09:

1. Keep `estimated maintenance calories`, `user-entered target`, `RDA`, `AI`, `AMDR`, `UL`, `CDRR`, and `FDA DV` as separate concepts in the domain and UI.
2. If a calculator is introduced, use an adult profile only for adults aged 19+ or provide an explicit adolescent profile. Do not silently treat “14+” as one adult population.
3. Prefer the 2023 NASEM EER equations for a general healthy-person maintenance estimate. Mifflin–St Jeor can be exposed as a documented REE method or used as an internal input to a larger model, but should not be presented as the user’s daily calories by itself.
4. Make activity classification and uncertainty visible. Allow the user to monitor results over time and adjust an estimate rather than treating the first result as truth.
5. If weight-change goals are supported, collect a goal and time horizon, show that the result is an estimate, reject or warn on unsafe/clinically inappropriate inputs, and route relevant users to professional care. Do not hard-code a universal 500–1,000 kcal deficit.
6. Preserve separate fields for total sugar and added sugar. Do not apply the added-sugar reference to total sugar.
7. Store the reference type, population, source edition, publication date, and calculation inputs with any generated estimate so a later guideline update does not silently rewrite historical targets.
8. A product that only tracks food and shows consumed totals can remain informational without calculating a medical target. The existence of accepted equations does not require the app to offer them.

## Open questions for the domain ticket

- Whether v1 should offer any calculator or only allow user-entered targets.
- Whether the supported population is adults 18+, adults 19+, or a broader 14+ scope with age-specific adolescent handling.
- Whether a user may choose a general reference profile, a personal target, or both.
- Whether protein should use the DRI adequacy reference, the current DGA 1.2–1.6 g/kg serving goal, a user-entered target, or remain informational.
- Whether carbohydrate, fat, and fiber references should be derived from a user calorie target or shown only as static/general references.
- Whether added sugar should use the FDA label DV, the current DGA meal guidance, a user-defined limit, or no default limit.
- How warnings and professional-care guidance should be presented without diagnosing or prescribing.

No runtime code was modified, and ticket 09 was not resolved or closed. This research artifact is the only file added for this task.

## Primary sources consulted

- [U.S. Department of Health and Human Services and U.S. Department of Agriculture — Dietary Guidelines for Americans, 2025–2030](https://cdn.realfood.gov/DGA.pdf), 10th edition, January 2026.
- [Office of Disease Prevention and Health Promotion — Current Dietary Guidelines](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/current-dietary-guidelines), last updated June 10, 2026.
- [National Academies — Dietary Reference Intakes for Energy](https://www.ncbi.nlm.nih.gov/books/n/nap26818/pdf/), 2023.
- [National Academies/NCBI — Recommended Dietary Allowances and Adequate Intakes, Total Water and Macronutrients](https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t4/?report=objectonly), based on the 2002/2005 DRI report; NCBI table hosted 2011.
- [National Academies/NCBI — Acceptable Macronutrient Distribution Ranges](https://www.ncbi.nlm.nih.gov/books/NBK56068/table/summarytables.t5/?report=objectonly), based on the 2002/2005 DRI report; NCBI table hosted 2011.
- [National Academies — Sodium and Potassium DRI model](https://nap.nationalacademies.org/resource/25353/interactive/), 2019.
- [NIH Office of Dietary Supplements — Nutrient Recommendations and Databases](https://ods.od.nih.gov/healthinformation/nutrientrecommendations.aspx), accessed 2026-08-02.
- [Mifflin et al. — A new predictive equation for resting energy expenditure](https://pubmed.ncbi.nlm.nih.gov/2305711/), 1990.
- [NIDDK — About the Body Weight Planner](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner), last reviewed May 2017.
- [NIDDK — Body Weight Planner research appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf), accessed 2026-08-02.
- [NIDDK — Health Tips for Adults](https://www.niddk.nih.gov/health-information/weight-management/healthy-eating-physical-activity-for-life/health-tips-for-adults), accessed 2026-08-02.
- [NHLBI — Practical Guide to the Identification, Evaluation, and Treatment of Overweight and Obesity in Adults](https://www.nhlbi.nih.gov/files/docs/guidelines/prctgd_c.pdf), historical clinical guideline, accessed 2026-08-02.
- [U.S. FDA — Added Sugars on the Nutrition Facts Label](https://www.fda.gov/food/nutrition-facts-label/added-sugars-nutrition-facts-label), accessed 2026-08-02.
- [U.S. FDA — Daily Value on the Nutrition and Supplement Facts Labels](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels), accessed 2026-08-02.
- [NIDDK — Healthy Eating for Adults with Chronic Kidney Disease](https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/healthy-eating-adults-chronic-kidney-disease), accessed 2026-08-02.
- [NIMH — Eating Disorders: What You Need to Know](https://www.nimh.nih.gov/health/publications/eating-disorders), accessed 2026-08-02.
