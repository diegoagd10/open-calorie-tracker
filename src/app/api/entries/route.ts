import { calculateDailyTotal, prepareCalorieEntry } from "@/lib/calories";
import { calorieRepository } from "@/lib/database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  const entries = calorieRepository.listByDate(date);

  return Response.json({
    entries,
    total: calculateDailyTotal(entries),
  });
}

export async function POST(request: Request) {
  try {
    const input = prepareCalorieEntry(await request.json());
    const entry = calorieRepository.add(input);

    return Response.json(entry, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid entry" },
      { status: 400 },
    );
  }
}
