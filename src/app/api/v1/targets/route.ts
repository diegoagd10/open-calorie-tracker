import { errorResponse, readJson } from "@/lib/api";
import { intakeService } from "@/lib/database";
import { currentLocalDate, validateDate } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const date = validateDate(
      searchParams.get("date") ?? currentLocalDate(),
      "Date",
    );
    return Response.json({
      target: intakeService.getTarget(date),
      hasTargets: intakeService.hasTargets,
      versions: intakeService.listTargets(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(
      { target: intakeService.createTarget(await readJson(request)) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  return POST(request);
}
