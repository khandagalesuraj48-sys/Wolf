# FALCON – test report (23-11-2026)

What was run, on what, and what was **not** run. Every command had a time limit.

## Run – and passed

| What | How | Result |
|---|---|---|
| The database, part by part | `supabase/test/run.sh` – a new throwaway Postgres 16 database with a stand-in of Supabase (`auth`, `storage`, roles, the Realtime publication); every migration run **twice**; then the test files | migrations ran twice with no error; **126 checks passed** (0001: 35 · 0002: 30 · 0003: 53 · 0012: 8) |
| The master SQL as he will run it | `supabase/test/run_master.sh` – a new clean database; `FALCON_MASTER.sql` run once, then again; `seed.sql` twice; then every test file against that database | first run and second run with no error; seed twice with no error (7 items); **45 tables, 0 without Row Level Security**; **126 checks passed** |
| The server's own steps | `npm test` (vitest): the Portal ticket check (signature, `aud`, `exp`, issuer), the Supabase hook signature, the WhatsApp code message, the HR answer kept server-side, the browser's settings check | **18 passed** |
| Types | `npx tsc --noEmit` | no error |
| The build | `npm run build` | built; the phone's part 485 KB (135 KB compressed); the office's pages load only when opened (5 parts, 20–50 KB each) |
| Server files | `node --check` on `api/*.js`, `api/_lib/*.js` | all parse |
| Every screen opens | `test/smoke.cjs` – the built app in Chromium (Playwright) with a **mocked** database: signed in with every role, each of the 65 routes opened | **65 of 65** rendered with no uncaught error |
| No secret in the repository | a search of every tracked file for keys, tokens, private keys, database addresses with a password | none found (the test files use made-up numbers like 9800000000) |

### What the database checks cover (examples)

* Who sees what: a worker sees only himself; a Site Admin only his site; a guest only his own visits and orders; a mess owner
  only his mess; bank details only Accounts / System Admin / the contractor's own owner; nobody changes a person directly.
* A meal's whole life: request → host approval (guest) → kitchen accepts (locked) → preparing → ready → batch → driver and van →
  route → dispatch → the van's place only while on the way → handed over with the person's code (wrong code refused, counted) →
  short given → failed with the reason → the five kinds of confirmation kept apart → review optional → day submitted, present
  count, locked → a correction kept with its reason → the month's bill from confirmed lines of locked days × that day's rate →
  GST / TDS only from Accounts' dated rules → invoice checked line by line (more than served, rate above contract, duplicate) →
  Site Admin → Accounts → Management (each a different person; send back and hold need the reason) → ERP reference → payment
  with its UTR (net payable 326 in the test).
* One main meal a person a meal a day, whoever asks it; a group request never makes a second one.
* Registration: not found in HR → waits, no RCL ID made up; the Site Admin's alert; reject needs the reason; temporary user –
  meals at his mess only; HR's ID linked later – his meals stay his; the Portal's Super Admin is FALCON's System Admin; only the
  server can say "found in HR".
* A dated setting: only the System Admin; never backwards; the old value ends the day before and stays; the complaint answer
  times (serious / other) count from their day.
* Every step is in the audit log; nobody can change or delete a line of it.

## Not run – not verified

* **FALCON's own Supabase project** – not made yet (his step). The master SQL ran on Postgres 16 with a stand-in of Supabase,
  not on Supabase itself; the first real run and its checks are in `docs/DATABASE.md`.
* **The screens against a real database.** The smoke test uses a mocked database with almost no data: it proves the screens
  open, not that each button works end to end. A local copy of Supabase's API (PostgREST) could not be set up here. The first
  real use is on his project, role by role (`docs/DEPLOYMENT.md` → 3).
* **Supabase Auth** (the phone code, the Send SMS hook, the LION one-time link), **Meta WhatsApp** (the template `otp`),
  **the Portal's ticket** (module `falcon` not there yet), **HR's look-up** (not there yet), **Vercel** (project, timer,
  headers) – none was reached from here.
* **A real phone** (camera QR reading, GPS of the van, the photo / voice of a complaint), **iPhone / Android app builds**
  (Capacitor – not made in this piece of work).
* The look against each of the 71 boards was compared by eye on a few web pages only (`docs/DESIGN_INVENTORY.md` → "Checked
  live" stays "not yet").
