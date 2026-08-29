import { isDatabaseReady } from "../database/database.server";
import { getApplicationDatabase } from "../database/runtime.server";

export function loader() {
  try {
    const database = getApplicationDatabase().getStatus();
    const ready = isDatabaseReady(database);

    return Response.json(
      { status: ready ? "ready" : "not_ready" },
      {
        headers: { "cache-control": "no-store" },
        status: ready ? 200 : 503,
      },
    );
  } catch {
    return Response.json(
      { status: "not_ready" },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
}
