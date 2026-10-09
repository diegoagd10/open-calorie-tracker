import type { Route } from "./+types/api.v1.daily-logs";
import { InvalidFoodLogRangeError } from "../food-log/food-log.server";
import { getFoodLogService } from "../food-log/runtime.server";
import { presentDailyFoodLogs } from "../food-log/present.server";
import { apiError, authenticateApiRequest, privateHeaders } from "../api-keys/rest.server";

export function headers() {
  return privateHeaders;
}

export function loader({ request }: Route.LoaderArgs) {
  const caller = authenticateApiRequest(request, "daily-logs", "daily-log:read");
  if (caller instanceof Response) return caller;
  const query = new URL(request.url).searchParams;
  const startDates = query.getAll("startDate");
  const endDates = query.getAll("endDate");
  if (startDates.length !== 1 || endDates.length !== 1) return apiError("invalid_date_range", 400);
  try {
    const range = getFoodLogService().readRange(caller.userId, startDates[0], endDates[0]);
    if (!range) return apiError("missing_setup", 409);
    return Response.json(presentDailyFoodLogs(range), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof InvalidFoodLogRangeError) return apiError("invalid_date_range", 400);
    throw error;
  }
}

export function action() {
  return apiError("method_not_allowed", 405);
}
