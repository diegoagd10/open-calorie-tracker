import { errorResponse, readJson } from "@/lib/api";
import { intakeService } from "@/lib/database";
import { ValidationError } from "@/lib/domain";

export const runtime = "nodejs";

function requestBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Request body must be an object");
  }
  return value as Record<string, unknown>;
}

export async function GET() {
  try {
    const settings = intakeService.getSettings();
    return Response.json({ settings, ...(settings ?? {}) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = requestBody(await readJson(request));
    const settings = intakeService.updateSettings(
      body.targetWeightLb ?? body.targetWeight,
    );
    return Response.json({ settings, ...settings });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  return PATCH(request);
}
