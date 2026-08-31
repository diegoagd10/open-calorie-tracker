import { isIP } from "node:net";

function privateDockerNetworkCidr(value) {
  const match = /^([^/]+)\/(\d{1,2})$/.exec(value.trim());
  if (!match || isIP(match[1]) !== 4) return false;
  const prefix = Number(match[2]);
  if (!Number.isInteger(prefix) || prefix < 16 || prefix > 32) return false;
  const octets = match[1].split(".").map(Number);
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function validateServerConfiguration(environment) {
  const port = Number.parseInt(environment.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }

  if (environment.NODE_ENV === "development") return { port };

  const applicationUrl = environment.APPLICATION_URL;
  if (!applicationUrl) {
    throw new Error("APPLICATION_URL is required outside development");
  }

  const canonicalUrl = new URL(applicationUrl);
  if (
    canonicalUrl.username ||
    canonicalUrl.password ||
    canonicalUrl.pathname !== "/" ||
    canonicalUrl.search ||
    canonicalUrl.hash
  ) {
    throw new Error(
      "APPLICATION_URL must be an origin without credentials, path, query, or hash",
    );
  }
  if (
    environment.NODE_ENV === "production" &&
    canonicalUrl.protocol !== "https:"
  ) {
    throw new Error("APPLICATION_URL must use HTTPS in production");
  }
  if (environment.NODE_ENV === "production") {
    const trustProxy = environment.TRUST_PROXY;
    if (!trustProxy || !privateDockerNetworkCidr(trustProxy)) {
      throw new Error(
        "TRUST_PROXY must be one private IPv4 Docker network CIDR with a prefix from 16 through 32",
      );
    }
  }

  return { port };
}
