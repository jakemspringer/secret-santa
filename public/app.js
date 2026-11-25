"use strict";

const app = document.getElementById("app");
const TILTS = [-7, 4, -3, 6, -5, 3, -2, 5, -4];
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = { names: [], locked: false, claimed: [] };
let you = null; // name
let giftee = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function envelope({ stage = false, open = false, name = null, tilt = 0 } = {}) {
  const cls = ["env", stage ? "env--stage" : "", open ? "is-open" : ""].join(" ");
  const style = tilt ? ` style="transform: rotate(${tilt}deg)"` : "";
  const letter = stage && name
    ? `<span class="env-kicker">Shopping for</span><span class="env-name">${esc(name)}</span>`
    : "";
  return `<span class="${cls}"${style}><span class="env-body"></span><span class="env-letter">${letter}</span><span class="env-flap"></span><span class="env-seal"></span></span>`;
}

function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function load() {
  try {
    const res = await fetch("/api/state");
    state = await res.json();
  } catch {
    app.innerHTML = `<p class="muted">Couldn't reach the table. Refresh to try again.</p>`;
    return;
  }
  showNames();
}

function showNames(error = "") {
  you = null;
  giftee = null;
  if (!state.locked) {
    app.innerHTML = `<h2>Not yet</h2><p class="muted">The drawing isn't open yet. Check back once everyone's on the list.</p>`;
    return;
  }
  const claimed = new Set(state.claimed.map((n) => n.toLowerCase()));
  app.innerHTML = `
    <p class="muted">Tap your name, then take an envelope from the table.</p>
    <p class="error" role="alert">${esc(error)}</p>
    <ul class="names">
      ${state.names.map((n) => `<li><button class="name-btn" data-name="${esc(n)}">${esc(n)}${claimed.has(n.toLowerCase()) ? "<small>Opened</small>" : ""}</button></li>`).join("")}
    </ul>`;
  app.querySelectorAll(".name-btn").forEach((b) => b.addEventListener("click", () => showPin(b.dataset.name)));
}

function showPin(name) {
  you = name;
  const first = !state.claimed.some((n) => n.toLowerCase() === name.toLowerCase());
  app.innerHTML = `
    <h2>${esc(name)}</h2>
    <p class="muted">${first
      ? "Pick a 4-digit PIN. You'll need it to see your envelope again, and it stops anyone else opening yours."
      : "Enter your PIN to see your envelope again."}</p>
    <form class="pin-form" novalidate>
      <label for="pin">${first ? "New PIN" : "PIN"}</label>
      <input id="pin" class="pin" inputmode="numeric" autocomplete="off" maxlength="4" pattern="\\d{4}" required>
      ${first ? `<label for="pin2">Type it again</label><input id="pin2" class="pin" inputmode="numeric" autocomplete="off" maxlength="4" required>` : ""}
      <p class="error" role="alert"></p>
      <button class="primary" type="submit">${first ? "Set PIN" : "Open"}</button>
    </form>
    <div class="actions"><button class="link" data-back>Not ${esc(name)}?</button></div>`;
  const form = app.querySelector("form");
  const err = app.querySelector(".error");
  const pinEl = app.querySelector("#pin");
  pinEl.focus();
  app.querySelector("[data-back]").addEventListener("click", () => showNames());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = pinEl.value.trim();
    if (!/^\d{4}$/.test(pin)) return (err.textContent = "PIN must be 4 digits.");
    if (first && app.querySelector("#pin2").value.trim() !== pin) return (err.textContent = "Those PINs don't match.");
    const btn = form.querySelector("button");
    btn.disabled = true;
    err.textContent = "";
    try {
      const res = await fetch("/api/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        err.textContent = data.error || "Something went wrong.";
        btn.disabled = false;
        if (res.status === 409 || res.status === 404) load();
        return;
      }
      giftee = data.giftee;
      if (data.first) {
        state.claimed.push(name);
        showTable();
      } else {
        showReveal({ kept: true });
      }
    } catch {
      err.textContent = "The table didn't answer. Try again.";
      btn.disabled = false;
    }
  });
}

function showTable() {
  const order = shuffle(state.names.map((_, i) => i));
  app.innerHTML = `
    <h2>${esc(you)}</h2>
    <p class="muted">${state.names.length} envelopes. Take whichever one you want.</p>
    <div class="draw-grid">
      ${order.map((i, pos) => `<button class="env-btn" aria-label="Envelope ${pos + 1}">${envelope({ tilt: TILTS[i % TILTS.length] })}</button>`).join("")}
    </div>`;
  app.querySelectorAll(".env-btn").forEach((b) => b.addEventListener("click", () => showReveal({ kept: false }), { once: true }));
}

async function showReveal({ kept }) {
  app.innerHTML = `
    <h2>${kept ? "You already opened yours" : esc(you)}</h2>
    <p class="muted" id="sub">${kept ? "Same envelope. Same person." : "The seal is breaking."}</p>
    <div class="stage">${envelope({ stage: true, open: false, name: giftee })}</div>
    <p class="sr-only" id="sr"></p>
    <div class="actions" id="acts" hidden>
      <button class="link" data-again>Watch it open again</button>
      <button class="link" data-leave>Someone else is drawing</button>
    </div>`;
  await sleep(reduced() ? 180 : kept ? 400 : 1150);
  app.querySelector(".env").classList.add("is-open");
  if (!kept) app.querySelector("#sub").textContent = "Don't say it out loud.";
  app.querySelector("#sr").textContent = `${you}, you are shopping for ${giftee}.`;
  app.querySelector("#acts").hidden = false;
  app.querySelector("[data-again]").addEventListener("click", () => showReveal({ kept }));
  app.querySelector("[data-leave]").addEventListener("click", () => showNames());
}

load();
