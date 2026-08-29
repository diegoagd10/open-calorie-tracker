export function loader() {
  return Response.json(
    { status: "live" },
    { headers: { "cache-control": "no-store" } },
  );
}
