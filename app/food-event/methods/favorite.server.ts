import type { FoodSnapshot } from "../food-event.model";
import { FoodEventNotFoundError } from "../food-event.exceptions";
import type { FavoritePolicy, FoodEventRepository } from "../food-event.repository.server";

/** A favorite's own snapshot, unchanged by later edits to its source event, and the link to it. */
export function favoriteFood(
  repository: Pick<FoodEventRepository, "findFavorite">,
  userId: number,
  favoriteId: number,
): { snapshot: FoodSnapshot; favorite: FavoritePolicy } {
  const favorite = Number.isSafeInteger(favoriteId) && favoriteId > 0 ? repository.findFavorite(userId, favoriteId) : null;
  if (!favorite) throw new FoodEventNotFoundError("That food is no longer in My foods.");
  return { snapshot: favorite.snapshot, favorite: { reuse: favorite.id } };
}
