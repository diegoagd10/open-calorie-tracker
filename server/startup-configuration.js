import { isIP } from "node:net";

function listeningPort(value, name) {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer from 1 through 65535`);
  }
  return port;
}

function configuredOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch {
    throw new Error(`${name} must be a valid origin`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !["http:", "https:"].includes(url.protocol) || !/^https?:\/\/[^/\\?#]+\/?$/.test(value)) {
    throw new Error(`${name} must be an origin without credentials, path, query, or hash`);
  }
  return url;
}

export function validateServerConfiguration(environment) {
  const port = listeningPort(environment.PORT ?? "3000", "PORT");
  if (environment.NODE_ENV !== "development" || environment.APPLICATION_URL) {
    if (!environment.APPLICATION_URL) {
      throw new Error("APPLICATION_URL is required outside development");
    }
    const publicUrl = configuredOrigin(environment.APPLICATION_URL, "APPLICATION_URL");
    if (environment.NODE_ENV === "production" && publicUrl.protocol !== "https:") {
      throw new Error("APPLICATION_URL must use HTTPS in production");
    }
  }

  if (!environment.LAN_URL) return { port };
  const lanUrl = configuredOrigin(environment.LAN_URL, "LAN_URL");
  const match = /^http:\/\/(\[[^\]]+\]|[^:]+):\d+\/?$/.exec(environment.LAN_URL);
  const ip = match?.[1].replace(/^\[|\]$/g, "");
  if (lanUrl.protocol !== "http:" || !ip || !isIP(ip)) {
    throw new Error("LAN_URL must use HTTP with an exact server IP and explicit port");
  }
  const lanPort = listeningPort(environment.LAN_PORT ?? "3002", "LAN_PORT");
  if (lanPort === port) throw new Error("LAN_PORT must differ from PORT");
  return { port, lanPort, lanHost: isIP(ip) === 6 ? "::" : "0.0.0.0" };
}
