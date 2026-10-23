# NFL Weekly Picks — real multi-player pool app

One shared backend, one shared database: when this app is hosted, every
player uses the same data, and everything flows back to the admin.

**Text-only branding:** "Powered by ALMI". No logo graphics — the logo is
still undecided.

## The pool rules (as set by the admin)

- Picks open **Tuesday** each week and **lock Thursday at 12:00 PM Central
  Time**. The lock is enforced server-side: late picks are rejected.
- Each pick costs **$0.50** by default. The admin can change the per-pick
  amount and all amounts owed recalculate.
- **Ties split that week's pot** among the players tied for most wins.
- Each week, every player marks themselves **playing** or **not
  participating**. Everyone logged in can see three lists: who is playing,
  who decided not to participate, and who hasn't responded yet.
- The admin sees every player's picks, participation, and payments, and
  checkmarks who has paid. Regular players never see admin controls.

## Money: tracking only, no real payments

This app **does not process payments**. It only tracks what each player
owes and whether the admin marked them paid. Players settle outside the
app — Stripe, PayPal, Venmo, and Cash App prohibit gambling pools in
their terms, and routing pool money through them risks frozen accounts.
Check your state/local rules for private pools.

## Run locally

Requires Node.js 22.5+ (uses the built-in `node:sqlite` — no npm
dependencies to install).

```bash
cd nfl-pickem-app
node server.js
```

Open http://localhost:3000. Data lives in `pickem.db` in the same folder.

## Admin account — set the password on first run

An `admin` account is seeded with **no password**. Set it one of two ways:

1. **Environment variable (recommended for hosting):** start the server
   once with `ADMIN_PASSWORD` set. It is hashed with scrypt and stored;
   it is never written to any file in plain text.
   ```bash
   ADMIN_PASSWORD='your-strong-password' node server.js
   ```
2. **One-time setup screen:** sign in as `admin` with any password, and
   the sign-in page offers a one-time "Set admin password" form. It only
   works while the admin has no password set.

No password is hardcoded anywhere in this project. Players register their
own username + password from the sign-in screen (passwords are hashed
with scrypt; the `admin` username is reserved).

## Deploy to get a public shareable link

Any Node host works. Two simple options:

### Render (free tier)
1. Push this folder to a GitHub repo.
2. In Render: New → Web Service → connect the repo.
3. Build command: *(leave empty — no dependencies)*. Start command:
   `node server.js`.
4. Set environment variables: `ADMIN_PASSWORD` (your admin password),
   optionally `DB_PATH` (default `./pickem.db`).
5. Deploy. Render gives you a public URL — send that link to players.

### Railway
1. Push this folder to a GitHub repo.
2. In Railway: New Project → Deploy from GitHub → pick the repo.
3. Start command: `node server.js`. Add the `ADMIN_PASSWORD` variable.
4. Railway gives you a public domain — send that link to players.

**Persistence note:** on free tiers, the SQLite file may reset if the
service restarts or redeploys. For a season-long pool, attach a persistent
disk/volume (Render: Disks; Railway: Volumes) mounted where `pickem.db`
lives, or point `DB_PATH` at that volume. Check your host's docs for the
mount path.

## Current week seeded

**2026 season, Week 7** (14 games, Thu Oct 22 – Mon Oct 26, 2026; byes:
Bills, Chargers, Commanders, Jaguars). Picks open Tue Oct 20 and lock
Thu Oct 22 at 5:00 PM CT (extended one time from noon).

## Mini test week (current)

**Mini Test — Oct 25–26** (13 games, Sun Oct 25 – Mon Oct 26, 2026:
the Sunday and Monday games from Week 7's slate, no Thursday game).
Picks lock Sun Oct 25 at 8:00 AM CT, 30 minutes before the first
kickoff (Steelers at Saints, Paris). Full sheet = 13 picks = $6.50
at $0.50 per pick.

Weeks can carry a `label` and `note`, shown in place of "Week N" and
the standard Tuesday/Thursday note. The app always shows the highest
week number as current, so the mini week is current until a later
week is added.

To add a future week, insert a row into `weeks` and its games into
`games` (the app always treats the highest week number as current), or
ask for a small admin "add week" screen. To add full Week 8 after the
mini test, insert it with a higher week number and label 'Week 8'
with the full 14-game slate (Thu Oct 29 – Mon Nov 2); it becomes
current automatically. Admins enter game winners after
games finish via Admin → Game results, and standings/pot splits update
from those results.

## Project layout

- `server.js` — HTTP API + SQLite schema, seeding, auth, lock enforcement
- `public/index.html` — page structure
- `public/styles.css` — styling (dark, mobile-friendly)
- `public/app.js` — frontend logic
- `pickem.db` — created on first run (not committed; one shared database)
