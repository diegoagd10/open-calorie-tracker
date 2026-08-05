import FoodEntryPrototype from "./FoodEntryPrototype";

type Variant = "A" | "B" | "C";

function parseVariant(value: string | string[] | undefined): Variant {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "B" || candidate === "C" ? candidate : "A";
}

export default async function Page({
  searchParams,
}: PageProps<"/prototype/food-entry">) {
  const params = await searchParams;

  return <FoodEntryPrototype initialVariant={parseVariant(params.variant)} />;
}
