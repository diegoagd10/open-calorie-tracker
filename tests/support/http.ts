export async function waitForHttpResponse(
  url: string,
  options: {
    accepts?: (response: Response) => boolean;
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const accepts = options.accepts ?? (() => true);
  const timeoutAt = Date.now() + (options.timeoutMs ?? 15_000);
  let lastError: unknown = new Error(`no accepted response from ${url}`);

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(url);
      if (accepts(response)) return response;
      lastError = new Error(`response returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, options.intervalMs ?? 50),
    );
  }
  throw lastError;
}
