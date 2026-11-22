# FALCON

Food & Site Operations – Sketchline Industries.

Meals, parcels and deliveries at RCL's sites: the employee's and guest's app, the mess owner's app, the driver's app and the web
for the site, Accounts and Management – with daily closing, contractor work orders, billing and reconciliation.

* `CLAUDE.md` – the owner's rules for this repository.
* `docs/DECISIONS.md` – every decision, with its date.
* `docs/DESIGN_INVENTORY.md` – the 71 approved screens and the assets, with the route of each screen.
* `docs/PERMISSIONS.md` – the ten roles, the registration states, guests and alerts.
* `docs/DEPLOYMENT.md` – going live: FALCON's Supabase project, the Vercel project and its settings, the Portal, WhatsApp, HR.
* `docs/DATABASE.md` – the one master SQL (`supabase/FALCON_MASTER.sql`), the seed, and how they were tested.
* `docs/TEST_REPORT.md` – what was run and what was not.
* `docs/LIMITATIONS.md` – what is not there yet, and what he should confirm.

## How it is made

| Part | Where |
|---|---|
| The app and the web (React, Vite, TypeScript; the approved look in `src/styles/design.css`) | `src/` – `screens/` (employee, guest, owner, driver, start, `admin/` for the web) |
| The server's own steps (Vercel functions): the LION ticket, the WhatsApp code hook, registration, the HR look-up, the phone check, the daily alerts, a guest's code | `api/` |
| The database: numbered parts → one master SQL; the seed apart; the tests | `supabase/migrations/`, `supabase/FALCON_MASTER.sql`, `supabase/seed/`, `supabase/test/` |

## Checks (each with a time limit)

```
timeout 180 npx tsc --noEmit
timeout 180 npm test
timeout 300 npm run build
timeout 60  supabase/build_master.sh
PGHOST=127.0.0.1 PGPORT=5441 PGUSER=postgres timeout 600 supabase/test/run_master.sh   # a throwaway Postgres only – never Supabase
```
