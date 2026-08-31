export type ClientIpSources = {
  nodeEnvironment: string | undefined;
  proxyClientIp?: string;
  remoteAddress?: string;
  testClientIp?: string;
};

export function resolveClientIp({
  nodeEnvironment,
  proxyClientIp,
  remoteAddress,
  testClientIp,
}: ClientIpSources): string {
  if (nodeEnvironment === "test" && testClientIp) return testClientIp;
  return proxyClientIp ?? remoteAddress ?? "unknown";
}
