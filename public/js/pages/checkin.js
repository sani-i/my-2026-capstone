import { checkIn } from "../api.js";
import { currentUser, requireLogin } from "../session.js";
import { clear, el } from "../ui.js";

const gateEl = document.getElementById("gate");
const form = document.getElementById("checkin-form");
const codeEl = document.getElementById("code");
const eventIdEl = document.getElementById("event-id");
const resultEl = document.getElementById("result");
const button = document.getElementById("scan-btn");

function setGate(message, type = "") {
  clear(gateEl);
  gateEl.className = `status ${type}`.trim();
  if (message) gateEl.append(document.createTextNode(message));
}

function showResult({ title, lines = [], type = "" }) {
  clear(resultEl);
  resultEl.className = `card checkin-result ${type}`.trim();
  resultEl.append(el("h2", {}, [title]));
  for (const line of lines) resultEl.append(el("p", { className: "meta" }, [line]));
}

if (requireLogin()) {
  const user = currentUser();
  if (user?.role !== "staff") {
    form.classList.add("hidden");
    setGate("This page is restricted to staff accounts. The server also checks your role.", "error");
  } else {
    setGate("Ready for check-in.");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = codeEl.value.trim();
      const eventId = eventIdEl.value.trim();
      if (!code) {
        showResult({ title: "Enter a ticket code", type: "error" });
        return;
      }

      button.disabled = true;
      clear(resultEl);
      try {
        const scanned = await checkIn({ code, eventId: eventId || undefined });
        showResult({
          title: "Admitted",
          type: "success",
          lines: [
            `Reference: ${scanned.reference}`,
            `Event: ${scanned.eventId}`,
            `Checked in at: ${scanned.checkedInAt}`,
          ],
        });
        codeEl.value = "";
      } catch (err) {
        if (err?.code === "DUPLICATE_CHECKIN") {
          showResult({
            title: "Duplicate scan - do not admit",
            type: "error",
            lines: [
              err.message,
              err.checkedInAt ? `First used at: ${err.checkedInAt}` : "",
            ].filter(Boolean),
          });
        } else {
          showResult({
            title: "Ticket rejected - do not admit",
            type: "error",
            lines: [err?.message || "Could not check in this ticket."],
          });
        }
      } finally {
        button.disabled = false;
      }
    });
  }
}
