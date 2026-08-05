import { afterEach, describe, expect, it } from "vitest";
import { CalorieRepository } from "./calorie-repository";

describe("CalorieRepository", () => {
  let repository: CalorieRepository | undefined;

  afterEach(() => repository?.close());

  it("persists entries and lists only the requested day, newest first", () => {
    repository = new CalorieRepository(":memory:");

    repository.add({ name: "Oats", calories: 250, date: "2026-08-04" });
    const banana = repository.add({
      name: "Banana",
      calories: 105,
      date: "2026-08-04",
    });
    repository.add({ name: "Toast", calories: 180, date: "2026-08-03" });

    expect(repository.listByDate("2026-08-04")).toEqual([
      banana,
      expect.objectContaining({
        id: expect.any(Number),
        name: "Oats",
        calories: 250,
        date: "2026-08-04",
      }),
    ]);
  });
});
