import { requireUser } from "../http/guards.js";

export function registerAuthRoutes(router, { authService }) {
  if (!authService) throw new Error("registerAuthRoutes requires authService");

  // POST /api/auth/signup - public
  router.add("POST", "/api/auth/signup", async (_req, _res, ctx) => {
    const result = await authService.signup(ctx.body ?? {});
    ctx.sendJson(201, result);
  });

  // POST /api/auth/login - public
  router.add("POST", "/api/auth/login", async (_req, _res, ctx) => {
    const result = await authService.login(ctx.body ?? {});
    ctx.sendJson(200, result);
  });

  // GET /api/auth/me - protected
  router.add("GET", "/api/auth/me", async (req, _res, ctx) => {
    const user = requireUser(req);
    ctx.sendJson(200, await authService.me(user));
  });
}
