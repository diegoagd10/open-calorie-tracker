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
    return Response.json({ entries: intakeService.listWeights() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = requestBody(await readJson(request));
    const entry = intakeService.upsertWeight(body.date as string, body.weightLb);
    return Response.json(entry);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  return PUT(request);
}

export async function PATCH(request: Request) {
  return PUT(request);
}
