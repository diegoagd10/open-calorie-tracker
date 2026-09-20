import { z } from "zod";
import { redirect } from "react-router";
import type { Route } from "./+types/photo-analysis";
import {
  getSessionForApplicationAccess,
  requireValidOrigin,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { getPhotoAnalysisService } from "../photo-analysis/runtime.server";
import { PhotoAnalysisUnavailableError } from "../photo-analysis/readiness.server";
import { presentPhotoAnalysisReadiness } from "./photo-analysis-readiness";

const noStore = { "Cache-Control": "private, no-store" };

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForApplicationAccess(request);
  if (!session) return redirect("/login");
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const service = getPhotoAnalysisService();
  try {
    if (url.searchParams.get("image") === "1") {
      const photo = service.photo(session.user.id, id);
      return new Response(new Uint8Array(photo.bytes), {
        headers: {
          ...noStore,
          "Content-Type": photo.mimeType,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
        },
      });
    }
    return Response.json(service.view(session.user.id, id), {
      headers: noStore,
    });
  } catch {
    return Response.json(
      { error: "Photo meal unavailable" },
      { status: 404, headers: noStore },
    );
  }
}

async function boundedForm(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Upload is empty");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 9 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Choose a photo up to 8 MB");
      }
      chunks.push(new Uint8Array(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(new Blob(chunks), {
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
  }).formData();
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await getSessionForApplicationAccess(request);
  if (!session) return redirect("/login");
  try {
    const form = await boundedForm(request);
    if (
      !getAuthenticationService().verifyCsrfToken(
        session.token,
        String(form.get("csrfToken") ?? ""),
      )
    ) {
      return Response.json(
        { error: "CSRF token rejected" },
        { status: 403, headers: noStore },
      );
    }
    const service = getPhotoAnalysisService();
    const userId = session.user.id;
    const id = String(form.get("id") ?? "");
    const idempotencyKey = String(form.get("idempotencyKey") ?? "");
    const intent = form.get("intent");
    let mealId = id;
    if (intent === "start") {
      const photo = form.get("photo");
      if (!(photo instanceof File)) throw new Error("Choose a plate photo");
      mealId = (await service.start(userId, {
        foodLogDate: String(form.get("date") ?? ""),
        idempotencyKey,
        photo: {
          bytes: Buffer.from(await photo.arrayBuffer()),
          mimeType: photo.type,
        },
      })).id;
    } else if (intent === "correct") {
      mealId = (await service.correct(
        userId,
        z.coerce.number().int().positive().parse(form.get("entryId")),
        { idempotencyKey, correction: String(form.get("correction") ?? "") },
      )).id;
    } else if (intent === "retry") {
      await service.retry(userId, id, {
        idempotencyKey,
        attemptId: String(form.get("attemptId") ?? ""),
      });
    } else if (intent === "cancel") {
      service.cancel(userId, id, String(form.get("attemptId") ?? ""));
    } else if (intent === "delete") {
      service.delete(userId, id);
      return Response.json({ deleted: true }, { headers: noStore });
    } else throw new Error("Unknown photo action");
    return Response.json(service.view(userId, mealId), {
      status:
        intent === "start" || intent === "correct" || intent === "retry"
          ? 202
          : 200,
      headers: noStore,
    });
  } catch (error) {
    const unavailable =
      error instanceof PhotoAnalysisUnavailableError
        ? presentPhotoAnalysisReadiness(
            { state: "unavailable", code: error.code },
            session.user.role,
          )
        : undefined;
    return Response.json(
      {
        error:
          unavailable?.reason ?? (error instanceof z.ZodError
            ? "Check the photo request and try again"
            : error instanceof Error
              ? error.message
              : "Photo analysis unavailable"),
        ...(unavailable?.destination
          ? { destination: unavailable.destination }
          : {}),
      },
      { status: unavailable ? 503 : 400, headers: noStore },
    );
  }
}
