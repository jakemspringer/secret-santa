# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

About 12 members of one extended family, including older relatives. Each person gets the link by text and opens it alone on their own phone, wherever they are, sometime in the days after the drawing is locked. One family member (Jacob) runs the admin page.

## Product Purpose

Secret Santa Drawing lets the family pull names for the Christmas gift exchange without being in the same room. Each person taps their name, sets a PIN, takes an envelope, and sees who they are shopping for. Success: everyone draws once, nobody learns anyone else's match, and nobody needs help to do it.

## Positioning

A private family ritual, not a gift-exchange service. No accounts, no email, no wish lists, no ads. The drawing itself (taking an envelope and breaking the seal) is the product.

## Operating Context

- Used once a year, in a short window before Christmas.
- Budget, date, and other exchange details are shared alongside the texted link, not inside the app.
- Mostly phones; desktop is possible but secondary.
- Admin: edit the name list and never-draw-each-other pairs, lock, reset, clear one person's PIN.

## Capabilities and Constraints

- Cloudflare Worker + one Durable Object; static `public/` pages, no build step.
- Locking makes one gift loop; nobody, including the admin, can see the pairs.
- 4-digit PIN per person, 5 wrong tries locks that name for 15 minutes.
- Functionality is intentionally limited. Do not add features (wish lists, budgets, reminders, accounts).

## Brand Commitments

- Name: "Secret Santa Drawing".
- The envelope and wax-seal reveal is the core moment and stays. Its look may change.

## Product Principles

1. The reveal is the point; every screen before it should be quick and get out of the way.
2. Built for one family, not a category: it should feel handmade for them, not like a template.
3. Anyone in the family, at any age, can finish it alone on a phone without asking for help.
4. Keep the secret: nothing on screen gives away a match.
