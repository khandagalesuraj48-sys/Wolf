# FALCON – design inventory and screen map

The approved designs (his word of 23-11-2026: "tu dilel mala design final aahet"; 8 more approved the same day: "ho banaw"; 8 more for the
masters: "tu dilel pages images approved aahe") are the 87 boards of the design canvas
**"FALCON – app and web design"** (a private claude.ai artifact of the owner). Each board is one screen at its real size: a phone
390 × 844, the web 1440 wide. The names and numbers on them are made-up samples – the designs stay in the private canvas and are
not copied into this public repository.

"Built" = the screen is in the code, compiles, and calls the database functions that the database tests check (23-11-2026).
"Checked live" is ticked only after the screen was used against FALCON's own Supabase project and compared with its board –
not done yet: the project and its settings are his to make (docs/DEPLOYMENT.md).

## Employee app – 16 screens

Role: Employee

| Board | Screen | Size | Route | Approved | Built | Checked live |
|---|---|---|---|---|---|---|
| `Main` | 1 · Mess home | 390 × 844 | `/app` | yes | yes | not yet |
| `e02-qr` | 2 · Scan the mess QR | 390 × 844 | `/app/scan` | yes | yes | not yet |
| `e03-meal` | 3 · Meal request | 390 × 844 | `/app/meal` | yes | yes | not yet |
| `e04-parcel` | 4 · Parcel request | 390 × 844 | `/app/parcel` | yes | yes | not yet |
| `e05-section` | 5 · Circle / section | 390 × 844 | `/app/section` | yes | yes | not yet |
| `e06-menu` | 6 · Today's menu | 390 × 844 | `/app/menu` | yes | yes | not yet |
| `e07-poster` | 7 · AI menu poster | 390 × 844 | `/app/menu/poster` | yes | yes | not yet |
| `e08-status` | 8 · Order status | 390 × 844 | `/app/orders/:id` | yes | yes | not yet |
| `e09-track` | 9–11 · Live tracking, map, ETA | 390 × 844 | `/app/orders/:id/track` | yes | yes | not yet |
| `e10-driver` | 12 · Driver details | 390 × 844 | `/app/orders/:id/driver` | yes | yes | not yet |
| `e11-confirm` | 13 · Delivery confirmation | 390 × 844 | `/app/orders/:id/confirm` | yes | yes | not yet |
| `e12-qty` | 14 · Quantity received | 390 × 844 | `/app/orders/:id/quantity` | yes | yes | not yet |
| `e13-review` | 15 · Review | 390 × 844 | `/app/orders/:id/review` | yes | yes | not yet |
| `e14-complaint` | 16 · Complaint – photo, voice | 390 × 844 | `/app/complaints/new · /app/complaints/:id` | yes | yes | not yet |
| `e15-guest` | 17 · Guest request | 390 × 844 | `/app/guest` | yes | yes | not yet |
| `e16-group` | 18 · Group request | 390 × 844 | `/app/group` | yes | yes | not yet |

## Mess owner app – 16 screens

Role: Mess Owner (Operator: kitchen and dispatch screens)

| Board | Screen | Size | Route | Approved | Built | Checked live |
|---|---|---|---|---|---|---|
| `o01-dash` | 1 · Owner dashboard | 390 × 844 | `/owner` | yes | yes | not yet |
| `o02-new` | 2 · New requests | 390 × 844 | `/owner/requests` | yes | yes | not yet |
| `o03-detail` | 3–4 · Request – accept and lock | 390 × 844 | `/owner/requests/:id` | yes | yes | not yet |
| `o04-kitchen` | 5–6 · Preparing · Ready | 390 × 844 | `/owner/kitchen` | yes | yes | not yet |
| `o05-group` | 7 · Parcels by section | 390 × 844 | `/owner/parcels` | yes | yes | not yet |
| `o06-batch` | 8 · Create delivery batch | 390 × 844 | `/owner/parcels (Make the batch)` | yes | yes | not yet |
| `o07-driver` | 9–10 · Driver and vehicle | 390 × 844 | `/owner/batches/:id/driver` | yes | yes | not yet |
| `o08-route` | 11 · Route optimisation | 390 × 844 | `/owner/batches/:id/route` | yes | yes | not yet |
| `o09-dispatch` | 12 · Dispatch | 390 × 844 | `/owner/batches/:id/dispatch` | yes | yes | not yet |
| `o10-live` | 13 · Live deliveries | 390 × 844 | `/owner/live` | yes | yes | not yet |
| `o11-menu` | 14 · Publish today's menu | 390 × 844 | `/owner/menu` | yes | yes | not yet |
| `o12-guests` | 15 · Guest meals | 390 × 844 | `/owner/guests` | yes | yes | not yet |
| `o13-closing` | 16 · Daily closing | 390 × 844 | `/owner/closing` | yes | yes | not yet |
| `o14-complaints` | 17 · Complaints | 390 × 844 | `/owner/complaints` | yes | yes | not yet |
| `o15-billing` | 18 · Contractor billing | 390 × 844 | `/owner/billing` | yes | yes | not yet |
| `o16-followup` | 19 · Confirmation follow-up | 390 × 844 | `/owner/follow-up` | yes | yes | not yet |

## Driver app – 11 screens

Role: Driver

| Board | Screen | Size | Route | Approved | Built | Checked live |
|---|---|---|---|---|---|---|
| `d01-home` | 1 · Driver home | 390 × 844 | `/driver` | yes | yes | not yet |
| `d02-assign` | 2–3 · New delivery – accept | 390 × 844 | `/driver/assignments/:id` | yes | yes | not yet |
| `d03-vehicle` | 4 · Vehicle | 390 × 844 | `/driver/vehicle` | yes | yes | not yet |
| `d04-batch` | 5 · Delivery batch | 390 × 844 | `/driver/trip` | yes | yes | not yet |
| `d05-route` | 6–7 · Route and navigation | 390 × 844 | `/driver/route/:section` | yes | yes | not yet |
| `d06-stops` | 8 · Section stops | 390 × 844 | `/driver/trip` | yes | yes | not yet |
| `d07-people` | 9 · Employee-wise delivery | 390 × 844 | `/driver/stops/:section` | yes | yes | not yet |
| `d08-otp` | 10 · OTP confirmation | 390 × 844 | `/driver/hand/:order/:person` | yes | yes | not yet |
| `d09-done` | 11 · Delivered | 390 × 844 | `/driver/hand/:order/:person (done)` | yes | yes | not yet |
| `d10-failed` | 12 · Failed delivery | 390 × 844 | `/driver/hand/:order/:person (not delivered)` | yes | yes | not yet |
| `d11-summary` | 13 · Delivery summary | 390 × 844 | `/driver/summary/:id` | yes | yes | not yet |

## Web – 17 screens

Role: Site Admin · Supervisor · Accounts · Management · System Admin (see PERMISSIONS)

| Board | Screen | Size | Route | Approved | Built | Checked live |
|---|---|---|---|---|---|---|
| `w01-dash` | 1 · Admin dashboard | 1440 × 1100 | `/admin` | yes | yes | not yet |
| `w02-sections` | 2 · Sites, circles, sections | 1440 × 1100 | `/admin/sites` | yes | yes | not yet |
| `w03-mess` | 3 · Mess master | 1440 × 1100 | `/admin/mess` | yes | yes | not yet |
| `w04-contractor` | 4 · Contractor master | 1440 × 1100 | `/admin/mess (Contractor)` | yes | yes | not yet |
| `w05-docs` | 5 · Documents and compliance | 1440 × 1100 | `/admin/mess (Contractor → papers)` | yes | yes | not yet |
| `w06-rates` | 6–7 · Work order and rates | 1440 × 1100 | `/admin/work-orders` | yes | yes | not yet |
| `w07-consumption` | 8 · Daily consumption | 1440 × 1100 | `/admin/consumption` | yes | yes | not yet |
| `w08-billing` | 9, 11 · Monthly billing, GST / TDS | 1440 × 1100 | `/admin/billing` | yes | yes | not yet |
| `w09-recon` | 10 · Invoice reconciliation | 1440 × 1100 | `/admin/reconciliation` | yes | yes | not yet |
| `w10-approvals` | 12–13 · Approvals and payments | 1440 × 1100 | `/admin/approvals` | yes | yes | not yet |
| `w11-reports` | 14 · Reports | 1440 × 1100 | `/admin/reports` | yes | yes | not yet |
| `w12-analytics` | 15 · Analytics | 1440 × 1100 | `/admin/analytics` | yes | yes | not yet |
| `w13-scorecard` | 16 · Contractor scorecard | 1440 × 1100 | `/admin/scorecard` | yes | yes | not yet |
| `w14-complaints` | 17 · Complaint dashboard | 1440 × 1100 | `/admin/complaints` | yes | yes | not yet |
| `w15-audit` | 18 · Audit log | 1440 × 1100 | `/admin/audit` | yes | yes | not yet |
| `w16-registrations` | 19 · New / unregistered registrations | 1440 × 1100 | `/admin/registrations` | yes | yes | not yet |
| `w17-guest` | 20 · Guest profile and visits | 1440 × 1100 | `/admin/guests` | yes | yes | not yet |

## Registration and guests – 11 screens

Role: Employee (first time) · Guest

| Board | Screen | Size | Route | Approved | Built | Checked live |
|---|---|---|---|---|---|---|
| `r01-who` | R1 · First time – who are you? | 390 × 844 | `/start` | yes | yes | not yet |
| `r02-rclid` | R2 · RCL ID | 390 × 844 | `/start/rcl-id` | yes | yes | not yet |
| `r03-found` | R3 · Found in HR – auto-filled | 390 × 844 | `/start/found` | yes | yes | not yet |
| `r04-otp` | R4 · WhatsApp code | 390 × 844 | `/start/code` | yes | yes | not yet |
| `r05-done` | R5 · Registered – verified employee | 390 × 844 | `/start/done` | yes | yes | not yet |
| `r06-notfound` | R6 · Employee record not found | 390 × 844 | `/start/not-found` | yes | yes | not yet |
| `r07-newreg` | R7 · New registration | 390 × 844 | `/start/new` | yes | yes | not yet |
| `r08-temp` | R8 · Temporary – waiting for check | 390 × 844 | `/start/temporary` | yes | yes | not yet |
| `g01-welcome` | G1 · Welcome back, guest | 390 × 844 | `/guest/welcome` | yes | yes | not yet |
| `g02-home` | G2 · Guest home | 390 × 844 | `/guest` | yes | yes | not yet |
| `g03-history` | G3 · My visits and orders | 390 × 844 | `/guest/history` | yes | yes | not yet |

## Next – where he is, Google Map, joined to HR – 8 screens (approved 23-11-2026: "ho banaw")

Page "Next – for approval" of the same canvas. N6 and N7 are screens of the ERP phone app (`rcl-mobile`), not of FALCON.

| Board | Screen | Size | Where | Approved | Built | Checked live |
|---|---|---|---|---|---|---|
| `n01-home-at-mess` | N1 · Home – at the mess (by itself) | 390 × 844 | `/app` (web + app) | yes | yes | not yet |
| `n02-home-away` | N2 · Home – away from the mess (by itself) | 390 × 844 | `/app` (web + app) | yes | yes – the distance is a straight line, no road minutes (Routes API not on the key) | not yet |
| `n03-track-gmap` | N3 · Live tracking – Google Map | 390 × 844 | `/app/orders/:id/track` | yes | yes | not yet |
| `n04-driver-gmap` | N4 · Driver route – Google Map | 390 × 844 | `/driver/route/:section` | yes | yes – the line is straight between the stops | not yet |
| `n05-owner-gmap` | N5 · Live deliveries – Google Map | 390 × 844 | `/owner/live` | yes | yes | not yet |
| `n06-hr-home` | N6 · HR app Home – Mess card | 390 × 844 | rcl-mobile – HR Home | yes | rcl-mobile | not yet |
| `n07-erp-home` | N7 · ERP app Home – Mess strip | 390 × 844 | rcl-mobile – ERP Home | yes | rcl-mobile | not yet |
| `n08-from-hr` | N8 · FALCON opened from HR – no second sign-in | 390 × 844 | `/app` after the HR pass (web `#hrpass=`, the app's `falcon://hr`) | yes | yes | not yet |

## Masters – Edit, Remove, From date – 8 screens (approved 23-11-2026: "tu dilel pages images approved aahe sagle ek sath banwayla ghe")

Page "Masters – edit, remove, from date" of the same canvas. The web's pages of before keep their routes; these boards replace w02–w06 for
what each row can do.

| Board | Screen | Size | Where | Approved | Built | Checked live |
|---|---|---|---|---|---|---|
| `m01-messes` | M1 · Every mess – Edit · History · Remove, meal times with dates | 1440 wide | `/admin/mess` (Messes) | yes | yes | not yet |
| `m02-edit-mess` | M2 · Edit a mess – site, contractor, place on the map, from date | 1440 wide | `/admin/mess` → Edit | yes | yes | not yet |
| `m03-edit-times` | M3 · Edit meal times – from a date, or correct a mistake | 1440 wide | `/admin/mess` → meal times → Edit | yes | yes | not yet |
| `m04-remove` | M4 · Remove – from a date, with the reason; stays in the record | 1440 wide | every Remove | yes | yes | not yet |
| `m05-contractors` | M5 · Contractors – business, tax, bank, code, papers | 1440 wide | `/admin/mess` (Contractors) | yes | yes | not yet |
| `m06-sites` | M6 · Sites, circles, sections | 1440 wide | `/admin/sites` | yes | yes – the Km column comes by itself (his later word) | not yet |
| `m07-work-orders` | M7 · Work orders, rates, penalties, BOQ | 1440 wide | `/admin/work-orders` | yes | yes | not yet |
| `m08-history` | M8 · History – who, when, before → after | 1440 wide | every History | yes | yes | not yet |

## Assets

| Asset | Used on | Format / size | Approved | Built | Note |
|---|---|---|---|---|---|---|
| The look – colours, type sizes, cards, chips, buttons, tab bar, timeline, tables | every screen | the design's stylesheet (`src/styles/design.css`) | yes | yes | cream #FAF8F2, ink #18221C, leaf #2F7A45, saffron #C2560E (buttons), navy #0E1B33 (hero, driver app, web sidebar), gold #D99E39, plum #5B2BA0 (guests), WhatsApp green only for WhatsApp |
| Font – Schibsted Grotesk | every screen | woff2, variable 400–800, Latin | yes | yes (`public/fonts`) | SIL Open Font License 1.1 – served by FALCON itself |
| Icons – Lucide | every screen | SVG, 24 grid, 2 px stroke | yes | yes (`src/styles/icons.css`, from lucide-static) | ISC licence; the same icon names in the app |
| Road maps (circles A–C, sections, van, pins) | e09, o08, o10, d05, w01, w02 | 5 drawn SVGs | yes – as the layout | yes – drawn from the sections' km (`src/ui/RoadMap.tsx`) | stand-ins for the live map (Google Maps, decision 4); the pins, van and route line keep the design |
| Photo areas (complaint photos, selfie, menu poster) | e07, e14, o14, w14, r07 | the person's own photo | yes | yes – the camera / file, kept in private storage | the real photo the person takes – no stock picture |
| FALCON logo – B: a peregrine falcon on a gold-rimmed plate, a fork and a knife crossed behind | browser tab, phone home screen (web), r01 header, office sidebar; the Android app's icon and opening screen | SVG + PNG (`public/brand/`; the app: FALCONAPK `android/…/res`, `assets/brand/`) | yes – his pick "B OK AAHE", 23-11-2026 (options A and B shown as pictures) | yes | drawn for FALCON (no stock picture); light ivory ground – his word "dark madhe nko" |

## Missing – to be given by him

* Nothing at present (the logo: given 23-11-2026 – B).

Total: 79 screens (71 + the 8 of 23-11-2026).
