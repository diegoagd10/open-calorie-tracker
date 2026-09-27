export type Theme = "light" | "dark";

export const themeColors = {
  dark: { background: "#12110e", surface: "#12110e", text: "#f3efe7", link: "#a6d08f", focus: "#c3e3b1" },
  light: { background: "#f5f1e8", surface: "#f5f1e8", text: "#1d1a15", link: "#2f5e2a", focus: "#2f5e2a" },
} satisfies Record<Theme, Record<string, string>>;

export function readTheme(cookie: string | null | undefined): Theme {
  const value = cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("appearance="))?.slice("appearance=".length);
  return value === "light" ? "light" : "dark";
}
