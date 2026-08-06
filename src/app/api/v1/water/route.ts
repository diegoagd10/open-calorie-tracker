import { errorResponse, readJson } from "@/lib/api";
import { intakeService } from "@/lib/database";
import { currentLocalDate, validateDate, ValidationError } from "@/lib/domain";

export const runtime = "nodejs";

function requestDate(request: Request): string {
  return validateDate(
    new URL(request.url).searchParams.get("date") ?? currentLocalDate(),
    "Date",
  );
}

function requestBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Request body must be an object");
  }
  return value as Record<string, unknown>;
}

export async function GET(request: Request) {
  try {
    const water = intakeService.getWater(requestDate(request));
    return Response.json({ ...water, water });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = requestBody(await readJson(request));
    const water = intakeService.addWater(
      requestDate(request),
      body.amount ?? body.fluidOz ?? body.totalFluidOz,
    );
    return Response.json({ ...water, water });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = requestBody(await readJson(request));
    const value = body.totalFluidOz ?? body.amount ?? body.fluidOz;
    const shouldAdd =
      body.mode === "add" ||
      !("totalFluidOz" in body);
    const water =
      shouldAdd
        ? intakeService.addWater(requestDate(request), value)
        : intakeService.setWater(requestDate(request), value);
    return Response.json({ ...water, water });
  } catch (error) {
    return errorResponse(error);
  }
}
