import { currentUser, isLoggedIn, clearSession } from "./session.js";
import { clear, el } from "./ui.js";

/** Fills the right-hand side of the header with session-aware links. */
export function mountNav() {
  const slot = document.getElementById("nav-auth");
  if (!slot) return;
  clear(slot);

  const user = currentUser();
  if (isLoggedIn() && user) {
    slot.append(
      el("span", { className: "nav-user" }, [`${user.email} · ${user.role}`]),
      el(
        "a",
        {
          href: "#",
          onClick: (event) => {
            event.preventDefault();
            clearSession();
            window.location.href = "/index.html";
          },
        },
        ["Log out"],
      ),
    );
  } else {
    slot.append(el("a", { href: "/login.html" }, ["Log in / Sign up"]));
  }
}

mountNav();
