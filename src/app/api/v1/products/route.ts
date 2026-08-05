import { errorResponse, readJson } from "@/lib/api";
import { intakeService } from "@/lib/database";
import { ValidationError } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("query") ?? "";
    return Response.json({ products: intakeService.listProducts(query) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const product = intakeService.createProduct(await readJson(request));
    return Response.json(product, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJson(request);
    const record = body as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof record.id !== "string") {
      throw new ValidationError("Product ID is required");
    }
    return Response.json(intakeService.updateProduct(record.id, record));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJson(request);
    const record = body as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof record.id !== "string") {
      throw new ValidationError("Product ID is required");
    }
    intakeService.retireProduct(record.id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
