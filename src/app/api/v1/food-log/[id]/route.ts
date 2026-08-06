import { errorResponse, readJson } from "@/lib/api";
import { intakeService } from "@/lib/database";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(
      intakeService.updateFoodLog(id, await readJson(request)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    intakeService.deleteFoodLog(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
