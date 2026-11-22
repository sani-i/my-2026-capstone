function normalizePath(pathname) {
  if (!pathname) return "/";
  const clean = pathname.split("?")[0];
  if (clean.length > 1 && clean.endsWith("/")) return clean.slice(0, -1);
  return clean;
}

function compilePath(path) {
  const parts = normalizePath(path).split("/").filter(Boolean);
  const keys = [];
  const pattern = parts
    .map((part) => {
      if (part.startsWith(":")) {
        keys.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  const regex = new RegExp(`^/${pattern}$`);
  return { regex, keys };
}

export function createRouter() {
  const routes = [];

  function add(method, path, handler) {
    const m = String(method).toUpperCase();
    const { regex, keys } = compilePath(path);
    routes.push({ method: m, path: normalizePath(path), regex, keys, handler });
  }

  function match(method, pathname) {
    const m = String(method).toUpperCase();
    const p = normalizePath(pathname);
    for (const route of routes) {
      if (route.method !== m) continue;
      const matchResult = p.match(route.regex);
      if (!matchResult) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(matchResult[i + 1]);
      });
      return { handler: route.handler, params, route };
    }
    return null;
  }

  return { add, match, routes };
}
