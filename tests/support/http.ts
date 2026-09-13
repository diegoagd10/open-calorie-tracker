import { request as httpRequest } from "node:http";

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

// Node fetch omits a caller-supplied Host. Use a wire-level request for authority
// and duplicate-header boundary tests.
export function requestHttp(url: string, options: {
  body?: string;
  headers?: Record<string, string | string[]>;
  method?: string;
} = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const headers = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
        }
        const body = [204, 205, 304].includes(response.statusCode ?? 0) ? null : Buffer.concat(chunks);
        resolve(new Response(body, { headers, status: response.statusCode }));
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(options.body);
  });
}
