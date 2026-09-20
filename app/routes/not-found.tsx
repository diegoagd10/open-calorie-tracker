export function loader() {
  throw new Response("This page does not exist.", { status: 404 });
}

export default function NotFound() {
  return null;
}
