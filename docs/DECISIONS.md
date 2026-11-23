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
* **Everything together, then one pull request and one SQL** ("ho ata tu ek sath sagle baanaw nantr pr ani sql de mhanje ekdach
  sagle houn jail"): the whole application on one branch, one pull request, and one master SQL (`supabase/FALCON_MASTER.sql`,
  tested on a clean database) with the seed apart.

* **The database is in** (23-11-2026): he ran `FALCON_MASTER.sql` and the seed on FALCON's own new Supabase project; the check
  of tables without Row Level Security answered 0.
* **FALCON stays fully separate at the start** ("surwatila falcon he purn seprate asel erp madhe lagech nahi hodaych … mi sangel
  tewa jodu code banla asel tr thik ahe"): it is not joined to LION / the Portal / HR now – no `PORTAL_URL`, no HR look-up. The
  code for joining stays as it is and is switched on only when he says. Everybody signs in to FALCON with its own WhatsApp code.

* **FALCON's admin stays in FALCON, not in the Portal** ("salet adhi FALCON ch admin page banaw portal madhe he nko gheyla"):
  roles are given in FALCON's own web (People and roles).
* **The first System Admin:** the mobile he sets in Vercel (`FALCON_FIRST_ADMIN`) becomes System Admin at its first WhatsApp code –
  only while the company has none (he set it the same night: "admin number add krun redeploy keley").
* **HR's employees in FALCON** ("HR cha data base FALCON la connect kr … all RCL che je astil … new site … new employee HR madhe aala
  tri te yat yeyla hawa" – and his yes to the plan): HR gives FALCON's server only RCL ID, name, designation, category, site, mobile,
  status, left day (`rcl-hr` api/falcon-employees, its own secret); FALCON keeps that list and copies it every hour; HR stays the
  master and is never changed from FALCON. An HR employee is known by his mobile after a WhatsApp code (no form, no Site
  Admin check); a new HR site becomes a FALCON site; who left in HR is stopped; people not in HR register as before.
  (The first copy, 23-11-2026 03:19: 86 people, every one "pending" or "incomplete" in HR – so, by his word "all RCL employees … a new
  employee too", everybody in HR's list counts unless he LEFT; HR's own status is only shown.)
* **The phone app is Flutter** ("APK … flutter ni banawleli asawi proper"; repository `khandagalesuraj48-sys/FALCONAPK`): the app's
  own screens, not the web shown inside; package `si.sketchline.falcon`.
* **The company code first** (23-11-2026 – "I work for RCL as nko deus … ERP sarkhe banau – company code takaych ani tyache adhi
  mhanje app olkhel user kuthun aala, nantr tyacha employee code mag tyachi details yetil ani OTP … karan mi dusryla app dile tr te RCL
  name diste; RCL code format RCL000"; his answers: the full details before the code with the mobile masked; "I am a guest" under the
  employee code): the first screen asks only the company code (the app names no company before it); then the employee code (e.g.
  RCL296) → HR's details → the WhatsApp code. The code is kept on the phone. "RCL ID" is called "employee code" on every screen.
* **A mess contractor's own code** (23-11-2026 – "owner … tyala pn ek code asel … admin contractor add krel ani tyacha company code
  tharwel – toch code ala tr tyachya company cha owner aala"; his answer: the mobiles the Admin gave – owner and operators): the System
  Admin sets it on the contractor (one code in all of FALCON, never a company's); typed on the first screen, it asks the mobile – only a
  mobile with a live Mess owner / operator role at that contractor's mess gets a code.
* **Limits on codes** (23-11-2026 – "rate limit law nahi tr employee ughach OTP pathwat basel"): one mobile – 1 code a minute, 5 an
  hour, 10 a day; first-screen codes, employee codes and contractor mobiles – limited per internet address. Only fingerprints are kept,
  for a day.
* **The work order's BOQ** (23-11-2026 – "work contract madhe BOQ perfect de item wise ani rate name disaw"; his answer: item, unit,
  quantity, rate, amount, total): Accounts / the System Admin set each item's quantity; the rate is the dated, approved rate of that
  day; every change is in the audit log.
* **The logo is B** (23-11-2026 – asked "REAL WATAWA LOGO PREMIUM FEEL DE DARK MADEH NKO … APLE APP RELATED"; two options shown as
  pictures; his answer "B OK AAHE"): a real-looking peregrine falcon on a gold-rimmed plate, a fork and a knife crossed behind, on light
  ivory. Used for the web's browser tab and home-screen icon, the first screen, the office sidebar, and the Android app's icon and
  opening screen.

* **Where he is and the meal by the server's clock** (23-11-2026 – "app swata check krel user kuthe aahe – mess location madhe to asel tr
  mess ch auto yeil … lamb asel tr mess che direction kiti lamb te dakhwel ani auto parcel … day night auto select asel server time
  asel"; pictures N1, N2 approved): inside the mess's area (its metres) → "At the mess" and the counter QR; away → how far (a straight
  line), the way in Google Maps, "Parcel"; he can still switch. The meal of now follows the SERVER's clock (GET /api/start), never
  the phone's. The phone's location is not saved or sent.
* **Google Map** (23-11-2026 – "map lauya"; "erp chi key use kru"; pictures N2–N5): the ERP's own Google Maps key (`VITE_GOOGLE_MAPS_KEY`)
  – the mess home, live tracking, the driver's route, the owner's route and live vans, choosing a section, the Sites page. Only the
  Maps JavaScript API; no road time or route line along the road (that needs Google's Routes API – not on the key, his to decide).
  Without the key or a place: the drawn road of before.
* **Joined to HR, not to the ERP / Portal** (23-11-2026 – "falcon la erp madhe nahi hr madhe jodaych karan erp main aahe erp madhe hr
  aahe ani falcon hr madhe asel … erp sathi pn jas apan attendance sathi keley te ethe pn ek asel"; pictures N6–N8): the HR app's
  Home has a "Mess" card, the ERP app's Home a "Mess" strip under "Mark IN"; a tap opens FALCON signed in with a pass HR's server
  signs (2 minutes, once; RCL ID, name, mobile, site, designation, today's first punch-in) – no company code, no WhatsApp code.
  FALCON's own sign-in (company code → employee code → WhatsApp code) stays for everybody else.

## Not decided yet – asked before that part is built
1. **Portal side of the one sign-in** – 23-11-2026: FALCON is joined to HR instead (above); the Portal's module stays unbuilt: adding the module `falcon` in the Portal (Super Admin → Modules) and what its ticket
   carries; where FALCON's finer roles (Mess Owner … System Admin) are given – in the Portal's Users & Access, as HR's are, or in
   FALCON. A change in `rcl-portal` is its own piece of work.
2. ~~HR look-up~~ – decided 23-11-2026 (above). Still open: a "present today" count from HR's attendance.
3. **WhatsApp code for FALCON's own sign-in:** the same Meta number and the approved template `otp`, its token kept in FALCON's
   Vercel too.
4. ~~**Maps**~~ – decided 23-11-2026: Google Maps with the ERP's key (above). Still open: road time / route along the road (Routes API).
5. ~~**The FALCON logo**~~ – decided 23-11-2026: B (above).
6. **"Posted in the ERP":** which ledger a paid bill goes to.
