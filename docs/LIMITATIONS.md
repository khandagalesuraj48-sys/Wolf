# FALCON – what is not there yet, and what he should confirm

## Waiting for his decision (docs/DECISIONS.md → "Not decided yet")

1. **FALCON is separate from the ERP for now** (his decision of 23-11-2026): the LION one sign-in stays off (no `PORTAL_URL`)
   and everybody uses FALCON's own WhatsApp code sign-in. The first System Admin is the mobile set in `FALCON_FIRST_ADMIN`.
2. **HR's list** comes only after `rcl-hr`'s pull request is merged, the secrets are set and the database update is run; until the
   first copy every RCL ID answers "not checked" (the person registers and waits for the Site Admin). A new HR site is made with
   its code as its name until the System Admin names it. "Present today" is not counted from HR's attendance yet.
3. **WhatsApp code** needs FALCON's own `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` and the approved template `otp`; without
   them no code is sent (the screen says so).
4. **Maps:** no Google Maps key – the road is drawn from each section's km (the sections, the van's last place on the drawn
   road). Route times are **suggested** from the dated settings "van speed" (30 km/h until set) and "minutes a stop" (4).
5. ~~**The FALCON logo**~~ – logo B is in use since 23-11-2026.
6. **"Posted in the ERP":** Accounts types the ERP entry's reference; nothing is posted to a ledger automatically.
7. **Another company's employees:** the company code works for any company in FALCON, but only RCL's HR list is copied; another
   company's people register and wait for their Site Admin (no HR look-up) until its HR is connected.
8. **The limits per internet address** count a whole site's Wi-Fi as one place: 60 look-ups in 10 minutes, 300 a day. A very busy
   shift start on one Wi-Fi could reach it (the screen says how long to wait).

## Made here – to be confirmed by him

* **Scorecard formulas** (the board shows the measures and weights, not the arithmetic): ratings = average ÷ 5 × weight; on
  time = share of stops reached by their time (+ the late minutes) × weight; complaints = weight − 5 for each complaint found true
  in 1,000 meals; billing accuracy = weight less a sixth for each 1 % the last checked invoice was over the system; documents =
  share of papers verified and in date × weight. A measure without data is left out. The weights are dated settings (25 · 25 ·
  20 · 15 · 15 until he sets them).
* **The seed's items:** the four meals, guest meal, parcel packing, water 1 L (as on the billing board). Other extras are added
  in Settings.
* **Values used until a setting is made:** a complaint answered within 60 minutes (serious) or 360 minutes (other); a van late after 30 minutes; route
  suggestions at 30 km/h and 4 minutes a stop; a new WhatsApp code on a new phone or after 30 days (from the boards).

## Not built in this piece of work

* **The Android / iPhone app (Capacitor)** – FALCON is a web app that works on a phone's browser; the store apps, their signing
  and push notifications are a next piece of work.
* **A one-time guest pass as a QR** that the mess scans (o12): the guest's meal is approved by his host and shown to the mess
  with his ticket; no QR is made for it.
* **The menu poster (e07)** is drawn from the published menu text – no AI picture.
* **A preview database:** Vercel previews get no Supabase values until a separate test project exists (so a preview never
  writes into the live data).
* **Reports** are Excel (CSV) and the browser's PDF (print) of each page; there is no scheduled e-mail of a report.

## Not verified (docs/TEST_REPORT.md)

The real Supabase project, Vercel, the Portal, Meta, HR, a real phone, and the screens end to end against a real database –
none could be reached from here.
