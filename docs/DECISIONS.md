# FALCON – decisions

Every decision here is the owner's. The newest wins. Nothing is built that is not here or in the approved designs.

## 22-11-2026 – the brief ("FALCON – Complete Production Application Development")
* **Name:** FALCON – "Food & Site Operations", by Sketchline Industries. Not "LION Mess", not named as a LION module. The
  repository is `khandagalesuraj48-sys/Wolf`; the application is never called Wolf.
* **A complete working system**, not a demo: every button works; no made-up counts on a dashboard; no fake transaction.
* **Ten roles**, each with its own screens: Employee, Guest, Mess Owner, Mess Operator, Mess Supervisor, Driver, Site Admin,
  Accounts, Management, System Admin (`docs/PERMISSIONS.md`). A permission is checked by the database and the server, never by
  hiding a button only.
* **The stack:** React, Vite, TypeScript, Tailwind CSS; Supabase (Postgres, Auth, Storage, Realtime where needed); Vercel for the
  web; Capacitor for the Android / iPhone app. No second backend (no Laravel, no other database).
* **FALCON's own Supabase project** – he creates it and puts its values in Vercel himself. No key is asked in chat or written in
  a file.
* **SQL:** numbered migrations, then ONE master SQL file, tested on a clean database before he is asked to run it; seed / demo
  data kept apart from it.
* **The workflows are kept exactly:**
  * a meal: Request → Owner accepts → Preparing → Ready → Dispatched → Delivered → Confirmed → Verified → Day closed → Billed;
    breakfast, lunch, snacks, dinner, guest meals, parcels, delivery;
  * a group request: one order for the owner, one line per person (any circle / section); a person who already has that meal
    is shown his existing request – never a second one;
  * five kinds of confirmation, kept apart for ever: the person's code (OTP) · the person in his app · the group requester ·
    the owner's phone follow-up · the supervisor. A phone follow-up is never written as an OTP. Unconfirmed ones go to the
    owner's follow-up list;
  * a review is optional and never stops a delivery, the day's closing or a bill;
  * delivery: batches by circle / section, driver and vehicle, route, ETA, code, short given, failed (with reason); tracking only
    during the delivery;
  * complaints: food quality, taste, quantity, temperature, cleanliness, water, delay, missing meal, other – with severity,
    ticket, reply, action, closing and history;
  * contractors and work orders: documents, rates with dates (old ones kept), site work orders, terms, GST / TDS settings,
    advance, security deposit, retention, penalties, payments;
  * billing: verified consumption → month → invoice uploaded → reconciliation → Accounts → Management → ERP posting / payment;
    duplicate, unverified, undelivered and mismatched quantity / rate / tax are flagged; tax is never assumed – it is a dated
    setting Accounts checks;
  * daily closing: requested / accepted / prepared / delivered / confirmed, guests, parcels, cancelled, failed, short, complaints,
    attendance, the contractor's remarks; every correction kept.
* **People:** RCL ID looked up in HR; not found → still registers by a controlled path; the WhatsApp code proves the mobile only,
  never the job; states Pending HR verification · Temporary · Verified employee · Rejected · Suspended (and the finer ones of
  `docs/PERMISSIONS.md`); linking to HR later keeps all his meals. One guest profile for ever, a visit and its orders apart; a
  phone alone never proves who a guest is; a guest sees only his own.

## 23-11-2026
* **The designs:** "stitch che design nahi tu dilel mala design final aahet" – the screens made for him in the design canvas
  ("FALCON – app and web design", 71 boards) are the approved designs (`docs/DESIGN_INVENTORY.md`).
* **Sign-in – two ways** ("sign in 2 modual madhe asel jr to company employee verify zala tr tyala sign in ethe ya app la garaj
  nahi jr nahi zla krayla lagel … first rcl name … modual madhun zal tr ekach sign in"):
  * the **company first** (RCL), as in the ERP;
  * a **verified company employee** needs no FALCON sign-in: he comes with his ONE LION sign-in. FALCON trusts the Portal's
    ticket only after checking its ES256 signature (`/api/jwks`), its `aud` (`falcon`), `exp`, and that its `jti` is used once –
    the same rule as every ERP module;
  * **everybody else** (not verified yet, temporary, guest) signs in to FALCON itself with a WhatsApp code;
  * FALCON also runs on its own (its own address and app) – from inside LION it is one sign-in.
* `main` began with one commit (the README) on his yes; everything after it comes as a branch and a pull request.

## Not decided yet – asked before that part is built
1. **Portal side of the one sign-in:** adding the module `falcon` in the Portal (Super Admin → Modules) and what its ticket
   carries; where FALCON's finer roles (Mess Owner … System Admin) are given – in the Portal's Users & Access, as HR's are, or in
   FALCON. A change in `rcl-portal` is its own piece of work.
2. **HR look-up:** the RCL ID check and the "present today" count need a small read-only answer from HR's server (`rcl-hr`) –
   name, designation, category, site, and whether the mobile matches; never KYC, bank or pay. A change in `rcl-hr`.
3. **WhatsApp code for FALCON's own sign-in:** the same Meta number and the approved template `otp`, its token kept in FALCON's
   Vercel too.
4. **Maps:** Google Maps (his choice for LION) – FALCON's key.
5. **The FALCON logo:** not given yet (`docs/DESIGN_INVENTORY.md` → Missing).
6. **"Posted in the ERP":** which ledger a paid bill goes to.
