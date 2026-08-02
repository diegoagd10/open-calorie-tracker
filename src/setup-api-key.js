import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env");

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Set OpenAI API key</title>
    <style>
      body { font: 16px system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; }
      input { box-sizing: border-box; width: 100%; padding: .75rem; margin: .5rem 0 1rem; }
      button { padding: .7rem 1rem; cursor: pointer; }
      small { color: #555; }
    </style>
  </head>
  <body>
    <h1>Set OpenAI API key</h1>
    <p>This page is served locally. The key will be saved to the project’s ignored <code>.env</code> file and will not be displayed or logged.</p>
    <form method="post" action="/save">
      <label for="apiKey">OpenAI API key</label>
      <input id="apiKey" name="apiKey" type="password" autocomplete="off" required autofocus>
      <button type="submit">Save key locally</button>
    </form>
    <p><small>Only enter an API key you created at platform.openai.com.</small></p>
  </body>
</html>`;

const successPage = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Saved</title>
<body style="font:16px system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem">
  <h1>Saved securely</h1>
  <p>The key was written locally. You can close this tab and return to Codex.</p>
</body></html>`;

function send(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) {
      throw new Error("Request is too large.");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function saveKey(request, response, server) {
  try {
    const form = new URLSearchParams(await readBody(request));
    const apiKey = form.get("apiKey")?.trim();

    if (!apiKey || /[\r\n]/.test(apiKey)) {
      send(response, 400, "Invalid API key.");
      return;
    }

    try {
      await fs.access(envPath);
      send(response, 409, "A .env file already exists. Close this page and handle it locally.");
      return;
    } catch {
      // The file does not exist, so it is safe to create it.
    }

    await fs.writeFile(envPath, `OPENAI_API_KEY=${JSON.stringify(apiKey)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await fs.chmod(envPath, 0o600);

    send(response, 200, successPage);
    server.close(() => process.exit(0));
  } catch {
    send(response, 400, "Unable to save the API key.");
  }
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/") {
    send(response, 200, page);
    return;
  }

  if (request.method === "POST" && request.url === "/save") {
    void saveKey(request, response, server);
    return;
  }

  send(response, 404, "Not found.");
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  console.log(`Secure local key setup: http://127.0.0.1:${address.port}`);
  console.log("The key will not be printed or logged.");
});
