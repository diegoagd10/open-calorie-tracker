import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("./routes/home.tsx"),
  route("photo-analysis", "./routes/photo-analysis.ts"),
  route("login", "./routes/login.tsx"),
  route("logout", "./routes/logout.tsx"),
  route("register", "./routes/register.tsx"),
  route("setup", "./routes/setup.tsx"),
  route("settings/goals", "./routes/settings.goals.tsx"),
  route("settings/ai", "./routes/settings.ai.tsx"),
  route("settings/users", "./routes/settings.users.tsx"),
  route("account/password", "./routes/account.password.tsx"),
  route("health/live", "./routes/health.live.ts"),
  route("health/ready", "./routes/health.ready.ts"),
] satisfies RouteConfig;
