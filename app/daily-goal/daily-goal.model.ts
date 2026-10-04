/** Calories in milli-kcal, nutrients in mg, water in fl oz text such as `"80"`. */
export type DailyGoalTargets = {
  calorieTarget: number;
  waterTarget: string;
  proteinTarget: number;
  carbohydrateTarget: number;
  fatTarget: number;
  fiberTarget: number;
  sugarMaximum: number;
  sodiumMaximum: number;
};

/** The account's one Daily Goal; every Food Log day is evaluated against it. */
export type DailyGoal = DailyGoalTargets & {
  userId: number;
  /** UTC instant Setup first saved the goal. */
  createdAt: string;
  /** UTC instant of the last save. */
  updatedAt: string;
};
