import { errorResponse, readJson } from "@/lib/api";
import { intakeService } from "@/lib/database";
import { ValidationError } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const date = new URL(request.url).searchParams.get("date") ?? "";
    return Response.json(intakeService.getFoodLogDay(date));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const entry = intakeService.createFoodLog(await readJson(request));
    return Response.json(entry, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJson(request);
    const record = body as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof record.id !== "string") {
      throw new ValidationError("Food log ID is required");
    }
    return Response.json(intakeService.updateFoodLog(record.id, record));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJson(request);
    const record = body as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof record.id !== "string") {
      throw new ValidationError("Food log ID is required");
    }
    intakeService.deleteFoodLog(record.id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
