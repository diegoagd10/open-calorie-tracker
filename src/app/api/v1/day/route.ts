import { errorResponse } from "@/lib/api";
import { intakeService } from "@/lib/database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const date = new URL(request.url).searchParams.get("date") ?? "";
    return Response.json(intakeService.getDailySummary(date));
  } catch (error) {
    return errorResponse(error);
  }
}
