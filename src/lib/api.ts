export class BadRequestError extends Error {
  readonly status = 400;
  readonly code = "MALFORMED_REQUEST";

  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequestError("Request body must contain valid JSON");
  }
}

export function errorResponse(error: unknown): Response {
  if (isHttpError(error)) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  return Response.json(
    { error: "The request could not be completed", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

function isHttpError(
  error: unknown,
): error is Error & { status: number; code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    typeof error.status === "number" &&
    typeof error.code === "string" &&
    error instanceof Error
  );
}
