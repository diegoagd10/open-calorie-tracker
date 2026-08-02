# Research: weight-change calorie model

Date: 2026-08-02  
Ticket: [09-daily-nutrient-targets-and-limits](../issues/09-daily-nutrient-targets-and-limits.md)  
Status: evidence captured for later Wayfinder discussion; this artifact does not resolve ticket 09.  
Scope: official NIDDK Body Weight Planner and National Academies energy-model sources for an open-source implementation.

## Executive summary

- The closest official model for a goal weight and target date is the NIDDK Body Weight Planner (BWP). It is a hosted interactive implementation of a dynamic adult body-weight model, with the model equations published in an official NIDDK appendix.
- The 2023 National Academies Estimated Energy Requirement (EER) equations are a strong maintenance-calorie baseline. EER predicts energy intake needed to maintain energy balance for a defined age, sex, weight, height, physical-activity level, and life stage; it is not itself a weight-loss or weight-gain trajectory model.
- The BWP produces calorie-intake plans for reaching and then maintaining a goal weight. It does not provide a complete macro-target calculator: carbohydrate percentage and sodium are advanced inputs, but protein and fat targets are not primary outputs.
- The official sources expose the tool and equations, but no official BWP source repository or software license was found. Reuse the published equations with attribution and implement independently; do not copy the hosted application, NIH branding, or assume the newer “available for licensing” system is open source.

## Documented BWP inputs and outputs

The guided BWP asks for:

- starting weight;
- sex, age, and height;
- physical activity level (the interface describes a typical range of 1.4–2.5 and a default of 1.6);
- goal weight; and
- a goal duration in days or a target date.

It optionally accepts physical-activity changes for the weight-change phase and the goal-maintenance phase. Expert mode exposes an uncertainty range, percentage of calories from carbohydrate, sodium intake, initial body-fat percentage, and resting metabolic rate. These are documented interface inputs, not all requirements of the underlying model.

The primary outputs are calories to maintain current weight, calories to reach the goal by the selected date, and calories to maintain the goal weight. The simulation also exposes projected weight, body-fat percentage, intake/expenditure charts, tabular daily values, high/low weight ranges, and CSV export. The interface warns for low or high BMI goals and rejects calorie goals below 1,000 kcal/day.

Sources: [NIDDK Body Weight Planner](https://www.niddk.nih.gov/bwp) and [NIDDK, research behind the Body Weight Planner](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner).

## What the underlying model does

The NIDDK appendix describes a dynamic model of adult body-weight change. It represents energy partitioning between fat and lean tissue, glycogen and associated body water, thermic effect of food, adaptive thermogenesis, and physical-activity energy expenditure. Physical activity is represented by a parameter whose energy cost is modeled as proportional to body weight. If body-fat mass is not supplied, the model estimates it from sex, age, height, and body weight.

The model was validated against human feeding studies and implemented as a Java web-based simulation tool. The current NIDDK page still provides the interactive BWP and asks users publishing work based on it to cite the 2011 Hall et al. paper. The official research page therefore documents both an executable implementation and a research appendix—not merely a formula or a calculator description.

Sources: [NIDDK supplementary web appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf), especially “Energy Partitioning,” “Total Energy Expenditure,” and “Model Validation and Web-based Implementation”; [NIDDK research page](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner).

## National Academies EER role

The 2023 National Academies report defines EER as average energy intake predicted to maintain energy balance for a defined age, sex, weight, height, physical-activity level, and life stage. Adult equations are for ages 19+; separate equations exist for children/adolescents and for pregnancy/lactation. The report also says the correct physical-activity category is important, actual individual requirements vary, and weight should be monitored and energy intake adjusted over time.

For this use case, EER is best treated as the maintenance baseline. A goal-weight/date calculation needs the BWP-style dynamic energy-balance model (or a separately validated model) to account for changing body weight and energy expenditure over the trajectory. Applying a fixed calorie deficit or the EER equation alone would not reproduce the documented dynamic behavior.

Source: [National Academies, Dietary Reference Intakes for Energy (2023)](https://nap.nationalacademies.org/catalog/26818/dietary-reference-intakes-for-energy) (see also the [free report PDF](https://www.ncbi.nlm.nih.gov/books/n/nap26818/pdf/)).

## Applicability and limitations

- NIDDK’s BWP disclaimer limits use to adults 18 and older and excludes younger people and pregnant or breastfeeding women. It says the tool is not medical advice.
- The National Academies’ adult EER equations begin at age 19, so “adult” is not one interchangeable age boundary across these sources. Adolescents require their own life-stage equations and references.
- NIDDK warns that BWP values may be too high for someone with an abnormally low metabolism or who is very sedentary. The tool’s low/high BMI warnings are screening warnings, not diagnoses.
- The dynamic model is an estimate based on population research and assumptions about body composition, activity, intake, and adaptation. It cannot establish an individual’s medically appropriate target, and the source model does not make clinical decisions for conditions, medications, eating disorders, pregnancy, lactation, or unusual training demands.
- BWP’s macro-related controls are limited. Its documented interface can vary carbohydrate percentage and sodium, but it does not define a complete protein/carbohydrate/fat target policy. Any macro targets would need a separate reference-policy decision.

Sources: [NIDDK BWP disclaimer and warnings](https://www.niddk.nih.gov/bwp), [NIDDK research disclaimer](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner), and [National Academies EER report](https://nap.nationalacademies.org/catalog/26818/dietary-reference-intakes-for-energy).

## Reuse and licensing findings

The NIH states that most information on NIH.gov is public domain, while third-party material, images, logos, trademarks, and marked copyrighted material can be restricted. The NIDDK BWP research page contains no source-code repository or software license for the hosted planner or its Java implementation. It also separately mentions a newer “Personalized Body Weight Management System” as available for licensing; that is not evidence that the public BWP implementation is open source.

Practical conclusion for an open-source app:

1. Reimplement the published equations independently rather than copying the hosted application or undocumented code.
2. Attribute Hall et al., the NIDDK BWP research page, and the National Academies report.
3. Do not use NIH/NIDDK logos or imply endorsement.
4. Check every asset separately for third-party copyright, and obtain legal review if copying software, figures, or the newer licensed system is contemplated.

Sources: [NIH copyright FAQ](https://www.nih.gov/about-nih/frequently-asked-questions) and [NIDDK research page](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner).

## Implications for later product decisions

These are research implications, not a resolution of ticket 09:

- A future Lose/Gain flow can collect current weight, goal weight, target date, age, sex category used by the selected equation, height, activity, and any required safety/profile inputs; it should show maintenance, goal-phase, and goal-maintenance estimates separately.
- Use the 2023 NASEM EER equations for a maintenance baseline only when the selected life-stage profile fits; use a documented dynamic model for weight change.
- Show assumptions, uncertainty, warnings, source/model version, and a confirmation step. Store the inputs and model version with the generated target so later model updates do not silently rewrite history.
- Keep macro-target policy separate from the calorie trajectory model. BWP is evidence for calories and weight trajectory, not a complete method for all macros.

No runtime code was modified, ticket 09 was not resolved or closed, and no commit was created.
