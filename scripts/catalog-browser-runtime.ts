export const catalogBrowserPorts = {
  public: process.env.CATALOG_BROWSER_PUBLIC_PORT ?? "4173",
  lan: process.env.CATALOG_BROWSER_LAN_PORT ?? "4174",
};
