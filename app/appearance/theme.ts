export type Theme = "light" | "dark";

export const themeColors = {
  dark: { background: "#0a0f14", surface: "#111820", text: "#edf2f7", link: "#64cb70", focus: "#a7f1ad" },
  light: { background: "#eef2f4", surface: "#fafbfd", text: "#17212b", link: "#206628", focus: "#287c30" },
} satisfies Record<Theme, Record<string, string>>;

export function readTheme(cookie: string | null | undefined): Theme {
  const value = cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("appearance="))?.slice("appearance=".length);
  return value === "light" ? "light" : "dark";
}
