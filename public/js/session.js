/**
 * Browser session. The token is what the server trusts; the cached user is
 * only for display. Never use currentUser() to make an authorization decision.
 */
const TOKEN_KEY = "ticketing.token";
const USER_KEY = "ticketing.user";

export function setSession({ token, user }) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function currentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn() {
  return Boolean(getToken() && currentUser());
}

export function requireLogin() {
  if (isLoggedIn()) return true;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/login.html?next=${encodeURIComponent(next)}`);
  return false;
}
