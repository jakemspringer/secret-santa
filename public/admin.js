"use strict";

const root = document.getElementById("admin");
const KEY = "drawing:admin-key";
let adminKey = "";
try { adminKey = sessionStorage.getItem(KEY) || ""; } catch {}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: { "x-admin-key": adminKey, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    try { sessionStorage.removeItem(KEY); } catch {}
    adminKey = "";
    showLogin("Wrong admin key.");
    throw new Error("auth");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function showLogin(error = "") {
  root.innerHTML = `
    <form class="pin-form" style="max-width:22rem">
      <label for="k">Admin key</label>
      <input id="k" class="text" type="password" autocomplete="current-password" required>
      <p class="error">${esc(error)}</p>
      <button class="primary">Sign in</button>
    </form>`;
  root.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    adminKey = root.querySelector("#k").value;
    try { sessionStorage.setItem(KEY, adminKey); } catch {}
    refresh();
  });
}

async function refresh() {
  try {
    render(await api("/api/admin"));
  } catch (e) {
    if (e.message !== "auth") root.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

function render(s, msg = "") {
  const claimed = new Set(s.claimed.map((n) => n.toLowerCase()));
  root.innerHTML = `
    <p class="error" role="alert">${esc(msg)}</p>
    <section class="card">
      <h2>${s.locked ? "Drawing is open" : "Setup"}</h2>
      ${s.locked
        ? `<p class="small">${s.claimed.length} of ${s.names.length} have opened their envelope. Pairs are hidden, even from you.</p>
           <ul class="chips">${s.names.map((n) => `<li class="${claimed.has(n.toLowerCase()) ? "on" : ""}">${esc(n)}</li>`).join("")}</ul>`
        : `<p class="small">Edit the list, save, then lock to shuffle and open the drawing.</p>`}
    </section>

    <section class="card">
      <h2>Names</h2>
      <p class="small">One per line.</p>
      <textarea id="names" ${s.locked ? "disabled" : ""}>${esc(s.names.join("\n"))}</textarea>
      <h2 style="margin-top:1rem">Never draw each other</h2>
      <p class="small">One pair per line, comma separated. Example: Jon, Diane</p>
      <textarea id="excl" ${s.locked ? "disabled" : ""}>${esc(s.exclusions.map((p) => p.join(", ")).join("\n"))}</textarea>
      ${s.locked ? `<p class="small">Locked. Reset below to change the list (everyone redraws).</p>` : `
      <div class="row">
        <button class="ghost" data-save>Save list</button>
        <button class="primary" data-lock style="padding:0 1.25rem">Lock and open drawing</button>
      </div>`}
    </section>

    ${s.locked ? `
    <section class="card">
      <h2>Forgot PIN</h2>
      <p class="small">Clears one person's PIN so they can set a new one. Their match stays the same.</p>
      <div class="row">
        <select id="who" class="text" style="max-width:14rem">${s.claimed.map((n) => `<option>${esc(n)}</option>`).join("")}</select>
        <button class="ghost" data-clear ${s.claimed.length ? "" : "disabled"}>Clear PIN</button>
      </div>
    </section>
    <section class="card">
      <h2>Reset</h2>
      <p class="small">Throws away the pairs and every PIN. Use this to add or remove people. Everyone has to draw again.</p>
      <div class="row">
        <input id="confirm" class="text" placeholder="Type RESET" style="max-width:10rem">
        <button class="ghost danger" data-reset>Reset drawing</button>
      </div>
    </section>` : ""}

    <button class="link" data-out>Sign out</button>`;

  const run = async (fn) => {
    try { render(await fn()); } catch (e) { if (e.message !== "auth") render(s, e.message); }
  };
  const readList = () => ({
    names: root.querySelector("#names").value.split("\n").map((x) => x.trim()).filter(Boolean),
    exclusions: root.querySelector("#excl").value.split("\n").map((l) => l.split(",").map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]),
  });

  root.querySelector("[data-save]")?.addEventListener("click", () => run(() => api("/api/admin/config", "PUT", readList())));
  root.querySelector("[data-lock]")?.addEventListener("click", () => {
    if (!confirm("Lock the list and shuffle? Changing names after this means everyone redraws.")) return;
    run(async () => {
      await api("/api/admin/config", "PUT", readList());
      return api("/api/admin/lock", "POST", {});
    });
  });
  root.querySelector("[data-clear]")?.addEventListener("click", () =>
    run(() => api("/api/admin/clear-pin", "POST", { name: root.querySelector("#who").value })));
  root.querySelector("[data-reset]")?.addEventListener("click", () =>
    run(() => api("/api/admin/reset", "POST", { confirm: root.querySelector("#confirm").value.trim() })));
  root.querySelector("[data-out]").addEventListener("click", () => {
    try { sessionStorage.removeItem(KEY); } catch {}
    adminKey = "";
    showLogin();
  });
}

adminKey ? refresh() : showLogin();
