import { login, signup } from "../api.js";
import { setSession } from "../session.js";
import { clear, el } from "../ui.js";

const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const loginStatus = document.getElementById("login-status");
const signupStatus = document.getElementById("signup-status");
const loginPanel = document.getElementById("login-panel");
const signupPanel = document.getElementById("signup-panel");
const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
const loginBtn = document.getElementById("login-btn");
const signupBtn = document.getElementById("signup-btn");

function setStatus(node, message, type = "") {
  clear(node);
  node.className = `status ${type}`.trim();
  if (message) node.append(document.createTextNode(message));
}

function showPanel(which) {
  const isLogin = which === "login";
  loginPanel.classList.toggle("hidden", !isLogin);
  signupPanel.classList.toggle("hidden", isLogin);
  tabLogin.classList.toggle("active", isLogin);
  tabSignup.classList.toggle("active", !isLogin);
  tabLogin.setAttribute("aria-selected", String(isLogin));
  tabSignup.setAttribute("aria-selected", String(!isLogin));
  setStatus(loginStatus, "");
  setStatus(signupStatus, "");
}

function destination(user) {
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return user.role === "organizer" ? "/organizer.html" : "/tickets.html";
}

function finish(result) {
  setSession({ token: result.token, user: result.user });
  window.location.href = destination(result.user);
}

tabLogin.addEventListener("click", () => showPanel("login"));
tabSignup.addEventListener("click", () => showPanel("signup"));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!email || !password) {
    setStatus(loginStatus, "Enter your email and password.", "error");
    return;
  }
  loginBtn.disabled = true;
  setStatus(loginStatus, "Logging in...");
  try {
    finish(await login({ email, password }));
  } catch (err) {
    setStatus(loginStatus, err?.message || "Could not log in.", "error");
    loginBtn.disabled = false;
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const role = document.getElementById("signup-role").value;
  if (!email || password.length < 8) {
    setStatus(signupStatus, "Use a valid email and a password of at least 8 characters.", "error");
    return;
  }
  signupBtn.disabled = true;
  setStatus(signupStatus, "Creating your account...");
  try {
    finish(await signup({ name, email, password, role }));
  } catch (err) {
    setStatus(signupStatus, err?.message || "Could not sign up.", "error");
    signupBtn.disabled = false;
  }
});
