// hire.js
// -----------------------------------------------------------------------
// Storefront form logic for hire.html ("/hire"). Plain vanilla JS.
//
// What this does: when the "Hire Karma" form is submitted, we send the
// values as JSON to POST /api/requests using fetch(), then show either a
// success message or an error message — without reloading the page.
// -----------------------------------------------------------------------

function showMessage(el, text, kind) {
  el.textContent = text; // textContent, not innerHTML — safe by default
  el.className = `form-message ${kind}`; // kind is "success" or "error"
}

function hideMessage(el) {
  el.textContent = "";
  el.className = "form-message";
}

async function handleSubmit(event) {
  event.preventDefault(); // stop the browser's default full-page form submit

  const form = event.target;
  const submitBtn = document.getElementById("submit-btn");
  const messageEl = document.getElementById("form-message");
  hideMessage(messageEl);

  const payload = {
    name: form.elements["name"].value,
    contact: form.elements["contact"].value,
    task_description: form.elements["task_description"].value,
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  try {
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data && data.ok) {
      showMessage(
        messageEl,
        "Thanks! Your request has been sent to Karma's owner for review. (This is a demo — no payment was taken.)",
        "success"
      );
      form.reset();
    } else {
      const errorText = (data && data.error) || "Something went wrong. Please try again.";
      showMessage(messageEl, errorText, "error");
    }
  } catch {
    showMessage(messageEl, "Could not reach the server. Please try again.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Send request";
  }
}

function init() {
  const form = document.getElementById("hire-form");
  form.addEventListener("submit", handleSubmit);
}

document.addEventListener("DOMContentLoaded", init);
