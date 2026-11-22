# FALCON – what is not there yet, and what he should confirm

## Waiting for his decision (docs/DECISIONS.md → "Not decided yet")

1. **The LION one sign-in** works only after the Portal has the module `falcon` (a change in `rcl-portal`) and `PORTAL_URL` is
   set. Until then everybody uses FALCON's own WhatsApp code sign-in, and the first System Admin can only be made by the Portal's
   Super Admin – so **the Portal's module is needed before FALCON can be set up**.
2. **HR look-up** is not connected (a change in `rcl-hr`): every RCL ID answers "not checked", the person registers as new and
   waits for the Site Admin; "present today" is not counted from HR.
3. **WhatsApp code** needs FALCON's own `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` and the approved template `otp`; without
   them no code is sent (the screen says so).
4. **Maps:** no Google Maps key – the road is drawn from each section's km (circles, sections, the van's last place on the drawn
   road). Route times are **suggested** from the dated settings "van speed" (30 km/h until set) and "minutes a stop" (4).
5. **The FALCON logo** is missing – the utensils tile of the boards is shown.
6. **"Posted in the ERP":** Accounts types the ERP entry's reference; nothing is posted to a ledger automatically.

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
