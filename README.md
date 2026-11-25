# The Drawing

Family Christmas gift exchange. Tap your name, set a PIN, take an envelope, see who you're shopping for.

Cloudflare Worker + one Durable Object for state. Static page in `public/`, API in `src/index.js`.

## How it works
- Admin (`/admin.html`) edits the name list and "never draw each other" pairs, then locks the drawing.
- Locking shuffles everyone into one loop (A gives to B gives to C ... back to A). Nobody draws themselves, no two people draw each other, exclusions are respected. Pairs live only in the Durable Object; nobody, including the admin, can see them.
- First time someone opens their name they set a 4-digit PIN. After that only their PIN shows their envelope. 5 wrong tries locks that name for 15 min.
- Admin can clear one person's PIN (match stays the same) or reset the whole drawing (everyone redraws; use this to add or remove people after locking).

## Setup
1. `npm install`
2. Local: copy `.dev.vars.example` to `.dev.vars`, set `ADMIN_KEY`, run `npm run dev`.
3. Deploy: `npx wrangler secret put ADMIN_KEY`, then `npm run deploy`. Or connect this repo in the Cloudflare dashboard (Workers & Pages > Create > Import a repository) and add `ADMIN_KEY` as a secret there.
4. Custom domain: Worker > Settings > Domains & Routes > add e.g. `santa.<your-domain>`.
