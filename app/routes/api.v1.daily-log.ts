import type { Route } from "./+types/api.v1.daily-log";
import { parseIsoLocalDate } from "../shared/local-date";
import { getFoodLogService } from "../food-log/runtime.server";
import { apiError, authenticateApiRequest, privateHeaders } from "../api-keys/rest.server";
import { presentDailyFoodLog } from "../food-log/present.server";

export function headers() {
  return privateHeaders;
}

export function loader({ request }: Route.LoaderArgs) {
  const caller = authenticateApiRequest(request, "daily-log", "daily-log:read");
  if (caller instanceof Response) return caller;
  const dates = new URL(request.url).searchParams.getAll("date");
  if (dates.length !== 1 || !parseIsoLocalDate(dates[0])) return apiError("invalid_date", 400);
  const foodLog = getFoodLogService().read(caller.userId, dates[0]);
  if (!foodLog) return apiError("missing_setup", 409);
  return Response.json(presentDailyFoodLog(foodLog), { headers: privateHeaders });
}

export function action() {
  return apiError("method_not_allowed", 405);
}
