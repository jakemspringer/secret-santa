import { DurableObject } from "cloudflare:workers";

// One Durable Object holds the whole drawing. Every request goes through it in
// order, so two people can never claim the same name or PIN at the same moment.

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const PIN_RE = /^\d{4}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);

const key = (name) => name.trim().toLowerCase();

async function sha256(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomInt(max) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle everyone into a single loop: each person gives to the next.
 * A single loop means nobody draws themselves and no two people draw each other.
 * Retries until no excluded pair (either direction) lands next to each other.
 */
function makePairs(names, exclusions) {
  const banned = new Set(exclusions.flatMap(([a, b]) => [`${key(a)}|${key(b)}`, `${key(b)}|${key(a)}`]));
  for (let attempt = 0; attempt < 20000; attempt++) {
    const order = shuffle(names);
    const pairs = {};
    let ok = true;
    for (let i = 0; i < order.length; i++) {
      const from = order[i];
      const to = order[(i + 1) % order.length];
      if (banned.has(`${key(from)}|${key(to)}`)) {
        ok = false;
        break;
      }
      pairs[key(from)] = to;
    }
    if (ok) return pairs;
  }
  return null;
}

function cleanConfig(body) {
  const names = [];
  const seen = new Set();
  for (const raw of Array.isArray(body?.names) ? body.names : []) {
    const name = String(raw).trim().slice(0, 40);
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    names.push(name);
  }
  const exclusions = [];
  for (const pair of Array.isArray(body?.exclusions) ? body.exclusions : []) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [a, b] = pair.map((n) => String(n).trim());
    if (!seen.has(key(a)) || !seen.has(key(b))) return { error: `Exclusion "${a}, ${b}" uses a name not on the list` };
    if (key(a) === key(b)) continue;
    exclusions.push([a, b]);
  }
  if (names.length > 100) return { error: "Too many names" };
  return { names, exclusions };
}

export class Drawing extends DurableObject {
  async load() {
    return (
      (await this.ctx.storage.get("state")) ?? {
        names: [],
        exclusions: [],
        pairs: null, // { nameKey: gifteeName } once locked
        salt: null,
        pins: {}, // { nameKey: sha256 }
        fails: {}, // { nameKey: { count, until } }
      }
    );
  }

  save(state) {
    return this.ctx.storage.put("state", state);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const state = await this.load();

    if (path === "/api/state" && request.method === "GET") {
      return json({
        names: state.names,
        locked: Boolean(state.pairs),
        claimed: state.names.filter((n) => state.pins[key(n)]),
      });
    }

    if (path === "/api/reveal" && request.method === "POST") {
      return this.reveal(state, await request.json().catch(() => null));
    }

    if (path.startsWith("/api/admin")) {
      return this.admin(state, path, request);
    }

    return fail(404, "Not found");
  }

  async reveal(state, body) {
    if (!state.pairs) return fail(409, "The drawing isn't open yet.");
    const name = state.names.find((n) => key(n) === key(String(body?.name ?? "")));
    if (!name) return fail(404, "That name isn't in the drawing.");
    const pin = String(body?.pin ?? "");
    if (!PIN_RE.test(pin)) return fail(400, "PIN must be 4 digits.");

    const k = key(name);
    const now = Date.now();
    const f = state.fails[k];
    if (f && f.until > now) {
      const mins = Math.ceil((f.until - now) / 60000);
      return fail(429, `Too many wrong PINs. Try again in ${mins} min.`);
    }

    const hash = await sha256(`${state.salt}:${k}:${pin}`);
    let first = false;
    if (!state.pins[k]) {
      state.pins[k] = hash;
      first = true;
    } else if (!timingSafeEqual(state.pins[k], hash)) {
      // An expired lockout (until > 0, now past) starts the count over.
      const count = (f && f.until === 0 ? f.count : 0) + 1;
      const locked = count >= MAX_FAILS;
      state.fails[k] = locked ? { count: 0, until: now + LOCK_MS } : { count, until: 0 };
      await this.save(state);
      return fail(403, locked ? "Too many wrong PINs. Locked for 15 min." : `Wrong PIN. ${MAX_FAILS - count} ${MAX_FAILS - count === 1 ? "try" : "tries"} left.`);
    }
    delete state.fails[k];
    await this.save(state);
    return json({ name, giftee: state.pairs[k], first });
  }

  async admin(state, path, request) {
    const expected = (this.env.ADMIN_KEY ?? "").trim();
    if (!expected) {
      return fail(401, "No admin key is set on the server. Add ADMIN_KEY as a runtime secret on the Worker.");
    }
    const given = (request.headers.get("x-admin-key") ?? "").trim();
    if (!timingSafeEqual(given, expected)) return fail(401, "Wrong admin key.");
    const body = request.method === "GET" ? null : await request.json().catch(() => ({}));
    const view = () =>
      json({
        names: state.names,
        exclusions: state.exclusions,
        locked: Boolean(state.pairs),
        claimed: state.names.filter((n) => state.pins[key(n)]),
      });

    if (path === "/api/admin" && request.method === "GET") return view();

    if (path === "/api/admin/config" && request.method === "PUT") {
      if (state.pairs) return fail(409, "Drawing is locked. Reset it to change the list.");
      const cfg = cleanConfig(body);
      if (cfg.error) return fail(400, cfg.error);
      state.names = cfg.names;
      state.exclusions = cfg.exclusions;
      await this.save(state);
      return view();
    }

    if (path === "/api/admin/lock" && request.method === "POST") {
      if (state.pairs) return fail(409, "Already locked.");
      if (state.names.length < 3) return fail(400, "Need at least 3 names.");
      const pairs = makePairs(state.names, state.exclusions);
      if (!pairs) return fail(400, "Those exclusions make a valid drawing impossible. Remove one and try again.");
      state.pairs = pairs;
      state.salt = crypto.randomUUID();
      state.pins = {};
      state.fails = {};
      await this.save(state);
      return view();
    }

    if (path === "/api/admin/reset" && request.method === "POST") {
      if (body?.confirm !== "RESET") return fail(400, 'Type RESET to confirm.');
      state.pairs = null;
      state.salt = null;
      state.pins = {};
      state.fails = {};
      await this.save(state);
      return view();
    }

    if (path === "/api/admin/clear-pin" && request.method === "POST") {
      const k = key(String(body?.name ?? ""));
      delete state.pins[k];
      delete state.fails[k];
      await this.save(state);
      return view();
    }

    return fail(404, "Not found");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const stub = env.DRAWING.get(env.DRAWING.idFromName("main"));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
