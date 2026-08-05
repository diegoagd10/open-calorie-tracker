import FoodDatabaseClient from "@/app/foods/FoodDatabaseClient";
import AppShell from "@/app/AppShell";

export default async function FoodsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const params = await searchParams;
  const date = typeof params.date === "string" ? params.date : undefined;
  return (
    <AppShell>
      <FoodDatabaseClient initialDate={date} />
    </AppShell>
  );
}
