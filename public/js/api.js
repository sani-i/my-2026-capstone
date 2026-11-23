import { getToken, clearSession } from "./session.js";

const API_BASE = "/api";

/**
 * The only place in the frontend that talks to the server.
 * Every protected call sends Authorization: Bearer <token>.
 */
async function request(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }

  if (!res.ok) {
    if (res.status === 401 && auth) clearSession();
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.code = data?.error?.code || "REQUEST_FAILED";
    err.status = res.status;
    throw err;
  }
  return data;
}

function queryString(params) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || String(value) === "") continue;
    qs.set(key, String(value));
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

// --- auth ---
export function signup(input) {
  return request("/auth/signup", { method: "POST", body: input });
}

export function login(input) {
  return request("/auth/login", { method: "POST", body: input });
}

export function me() {
  return request("/auth/me", { auth: true });
}

// --- public browsing ---
export async function listEvents(params = {}) {
  return request(`/events${queryString(params)}`);
}

export function getEvent(id) {
  return request(`/events/${encodeURIComponent(id)}`);
}

// --- attendee ---
export function createBooking(input) {
  return request("/bookings", { method: "POST", body: input, auth: true });
}

export async function listMyBookings() {
  return request("/bookings", { auth: true });
}

export function getBooking(reference) {
  return request(`/bookings/${encodeURIComponent(reference)}`, { auth: true });
}

export function pay({ reference, paymentToken }) {
  return request(`/bookings/${encodeURIComponent(reference)}/pay`, {
    method: "POST",
    body: { paymentToken },
    auth: true,
  });
}

export function cancelBooking(reference) {
  return request(`/bookings/${encodeURIComponent(reference)}/cancel`, {
    method: "POST",
    auth: true,
  });
}

export function getCancelQuote(reference) {
  return request(`/bookings/${encodeURIComponent(reference)}/cancel-quote`, { auth: true });
}

// --- Build 8 waitlist ---
export function joinWaitlist(input) {
  return request("/waitlist", { method: "POST", body: input, auth: true });
}

export async function listMyWaitlist() {
  return request("/waitlist", { auth: true });
}

export function acceptWaitlistOffer(entryId) {
  return request(`/waitlist/${encodeURIComponent(entryId)}/accept`, {
    method: "POST",
    auth: true,
  });
}

// --- organizer ---
export function createEvent(input) {
  return request("/events", { method: "POST", body: input, auth: true });
}

export async function listMyEvents() {
  return request("/events/mine", { auth: true });
}

export function addTier(eventId, input) {
  return request(`/events/${encodeURIComponent(eventId)}/tiers`, {
    method: "POST",
    body: input,
    auth: true,
  });
}

export function publishEvent(eventId) {
  return request(`/events/${encodeURIComponent(eventId)}/publish`, {
    method: "POST",
    auth: true,
  });
}

export function unpublishEvent(eventId) {
  return request(`/events/${encodeURIComponent(eventId)}/unpublish`, {
    method: "POST",
    auth: true,
  });
}
