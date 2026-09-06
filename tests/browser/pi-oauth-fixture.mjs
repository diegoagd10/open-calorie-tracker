// Only preloaded by the local Playwright server. Exercise Pi's real SDK and
// credential store while replacing the external OpenAI OAuth transport.
import { readFile } from "node:fs/promises";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
    return Response.json({ device_auth_id: "browser-device", user_code: "TEST-1234", interval: 1 });
  }
  if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
    const decision = await readFile("data/playwright-tests/pi/decision", "utf8").catch(() => "pending");
    if (decision === "approve") return Response.json({ authorization_code: "browser-approval", code_verifier: "browser-verifier" });
    if (decision === "reject") return new Response("synthetic-private-error", { status: 500 });
    return new Response(null, { status: 403 });
  }
  if (url === "https://auth.openai.com/oauth/token") {
    const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "browser-account" } })).toString("base64");
    return Response.json({ access_token: `test.${payload}.test`, refresh_token: "browser-refresh-secret", expires_in: 3600 });
  }
  return originalFetch(input, init);
};
