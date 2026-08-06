import type {
  DailyTargetVersion,
  FoodLogEntry,
  FoodProduct,
  FoodLogSnapshot,
  DailyNutritionTotals,
  DailyTargetStatuses,
  TargetInput,
  UserSettings,
  WaterDay,
  WeightEntry,
} from "./domain";
import {
  aggregateFoodLogs,
  calculateTargetStatuses,
  currentLocalDate,
  normalizeFoodLogCreateInput,
  normalizeFoodLogSnapshot,
  normalizeFoodLogSnapshotPatch,
  normalizeTargetInput,
  normalizeTargetWeight,
  normalizeWaterAmount,
  normalizeWeight,
  assertNotFutureDate,
  validateDate,
  ConflictError,
  NotFoundError,
  type FoodLogCreateInput,
} from "./domain";
import { FoodLogRepository } from "./food-log-repository";
import { ProductRepository } from "./product-repository";
import { SettingsRepository } from "./settings-repository";
import { TargetRepository } from "./target-repository";
import { WaterRepository } from "./water-repository";
import { WeightRepository } from "./weight-repository";
import { manualProductDraftProvider } from "./product-draft";

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

function productSnapshot(
  product: FoodProduct,
  date: string,
  quantity: number,
): FoodLogSnapshot & FoodLogCreateInput {
  return {
    date,
    productId: product.id,
    titleSnapshot: product.name,
    servingDescriptionSnapshot: product.servingDescription,
    quantity,
    caloriesPerServingCal: product.caloriesPerServingCal,
    proteinPerServingG: product.proteinPerServingG,
    carbsPerServingG: product.carbsPerServingG,
    fatPerServingG: product.fatPerServingG,
    fiberPerServingG: product.fiberPerServingG,
    sugarPerServingG: product.sugarPerServingG,
    sodiumPerServingMg: product.sodiumPerServingMg,
  };
}

export type DailySummary = {
  date: string;
  entries: FoodLogEntry[];
  totals: DailyNutritionTotals;
  water: WaterDay;
  target: DailyTargetVersion | null;
  statuses: DailyTargetStatuses | null;
};

export class IntakeService {
  constructor(
    private readonly products: ProductRepository,
    private readonly foodLogs: FoodLogRepository,
    private readonly userId: string,
    private readonly targets?: TargetRepository,
    private readonly water?: WaterRepository,
    private readonly weights?: WeightRepository,
    private readonly settings?: SettingsRepository,
  ) {}

  listProducts(query = ""): FoodProduct[] {
    return this.products.listActive(query);
  }

  getProduct(id: string): FoodProduct {
    const product = this.products.findById(id);
    if (!product || product.status !== "active") {
      throw new NotFoundError("Food product was not found");
    }
    return product;
  }

  createProduct(input: unknown): FoodProduct {
    const draft = manualProductDraftProvider.toDraft(input);
    try {
      return this.products.create(draft);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictError("A food with that name already exists");
      }
      throw error;
    }
  }

  updateProduct(id: string, input: unknown): FoodProduct {
    const draft = manualProductDraftProvider.toDraft(input);
    if (!this.products.findById(id)) {
      throw new NotFoundError("Food product was not found");
    }

    try {
      const product = this.products.update(id, draft);
      if (!product) throw new NotFoundError("Food product was not found");
      return product;
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictError("A food with that name already exists");
      }
      throw error;
    }
  }

  retireProduct(id: string): void {
    if (!this.products.findById(id)) {
      throw new NotFoundError("Food product was not found");
    }
    this.products.retire(id);
  }

  createFoodLog(input: unknown): FoodLogEntry {
    const createInput = normalizeFoodLogCreateInput(input);
    const product = this.getProduct(createInput.productId);
    return this.foodLogs.create(
      productSnapshot(product, createInput.date, createInput.quantity),
    );
  }

  getFoodLogDay(date: string): {
    date: string;
    entries: FoodLogEntry[];
    totals: DailyNutritionTotals;
  } {
    const normalizedDate = validateDate(date, "Date");
    assertNotFutureDate(normalizedDate);
    const entries = this.foodLogs.listByDate(normalizedDate);
    return {
      date: normalizedDate,
      entries,
      totals: aggregateFoodLogs(entries),
    };
  }

  updateFoodLog(id: string, input: unknown): FoodLogEntry {
    const existing = this.foodLogs.findById(id);
    if (!existing) {
      throw new NotFoundError("Food log entry was not found");
    }

    const patch = normalizeFoodLogSnapshotPatch(input);
    const snapshot = normalizeFoodLogSnapshot({
      titleSnapshot: existing.titleSnapshot,
      servingDescriptionSnapshot: existing.servingDescriptionSnapshot,
      quantity: existing.quantity,
      caloriesPerServingCal: existing.caloriesPerServingCal,
      proteinPerServingG: existing.proteinPerServingG,
      carbsPerServingG: existing.carbsPerServingG,
      fatPerServingG: existing.fatPerServingG,
      fiberPerServingG: existing.fiberPerServingG,
      sugarPerServingG: existing.sugarPerServingG,
      sodiumPerServingMg: existing.sodiumPerServingMg,
      ...patch,
    });

    const updated = this.foodLogs.updateSnapshot(id, snapshot);
    if (!updated) throw new NotFoundError("Food log entry was not found");
    return updated;
  }

  deleteFoodLog(id: string): void {
    if (!this.foodLogs.delete(id)) {
      throw new NotFoundError("Food log entry was not found");
    }
  }

  getDailySummary(date: string): DailySummary {
    const normalizedDate = validateDate(date, "Date");
    assertNotFutureDate(normalizedDate);
    const entries = this.foodLogs.listByDate(normalizedDate);
    const totals = aggregateFoodLogs(entries);
    const target = this.targets?.findEffective(normalizedDate) ?? null;
    const water = this.water?.get(normalizedDate) ?? {
      date: normalizedDate,
      totalFluidOz: 0,
      updatedAt: "",
    };

    return {
      date: normalizedDate,
      entries,
      totals,
      water,
      target,
      statuses: target
        ? calculateTargetStatuses(totals, water.totalFluidOz, target)
        : null,
    };
  }

  listTargets(): DailyTargetVersion[] {
    if (!this.targets) throw new Error("Target repository is unavailable");
    return this.targets.list();
  }

  getTarget(date: string): DailyTargetVersion | null {
    if (!this.targets) throw new Error("Target repository is unavailable");
    const normalizedDate = validateDate(date, "Date");
    assertNotFutureDate(normalizedDate);
    return this.targets.findEffective(normalizedDate);
  }

  createTarget(input: unknown): DailyTargetVersion {
    if (!this.targets) throw new Error("Target repository is unavailable");
    const normalized = normalizeTargetInput(input);
    return this.targets.create(normalized as TargetInput);
  }

  addWater(date: string, amount: unknown): WaterDay {
    if (!this.water) throw new Error("Water repository is unavailable");
    const normalizedDate = validateDate(date, "Date");
    assertNotFutureDate(normalizedDate);
    return this.water.add(normalizedDate, normalizeWaterAmount(amount));
  }

  setWater(date: string, amount: unknown): WaterDay {
    if (!this.water) throw new Error("Water repository is unavailable");
    const normalizedDate = validateDate(date, "Date");
    assertNotFutureDate(normalizedDate);
    return this.water.set(normalizedDate, normalizeWaterAmount(amount));
  }

  getWater(date: string): WaterDay {
    if (!this.water) throw new Error("Water repository is unavailable");
    const normalizedDate = validateDate(date, "Date");
    assertNotFutureDate(normalizedDate);
    return this.water.get(normalizedDate);
  }

  listWeights(): WeightEntry[] {
    if (!this.weights) throw new Error("Weight repository is unavailable");
    return this.weights.list();
  }

  upsertWeight(date: string, value: unknown): WeightEntry {
    if (!this.weights) throw new Error("Weight repository is unavailable");
    const normalizedDate = validateDate(date, "Date");
    assertNotFutureDate(normalizedDate);
    return this.weights.upsert(normalizedDate, normalizeWeight(value));
  }

  getSettings(): UserSettings | null {
    if (!this.settings) throw new Error("Settings repository is unavailable");
    return this.settings.get();
  }

  updateSettings(targetWeight: unknown): UserSettings {
    if (!this.settings) throw new Error("Settings repository is unavailable");
    return this.settings.setTargetWeight(normalizeTargetWeight(targetWeight));
  }

  get currentUserId(): string {
    return this.userId;
  }

  get hasTargets(): boolean {
    return this.targets?.hasAny() ?? false;
  }

  get today(): string {
    return currentLocalDate();
  }
}
