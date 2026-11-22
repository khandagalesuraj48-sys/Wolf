# FALCON – design inventory and screen map

The approved designs (his word of 23-11-2026: "tu dilel mala design final aahet") are the 71 boards of the design canvas
**"FALCON – app and web design"** (a private claude.ai artifact of the owner). Each board is one screen at its real size: a phone
390 × 844, the web 1440 wide. The names and numbers on them are made-up samples – the designs stay in the private canvas and are
not copied into this public repository.

"Implemented" is ticked only when the screen works against the database and was checked against its board.

## Employee app – 16 screens

Role: Employee

| Board | Screen | Size | Route (planned) | Approved | Implemented |
|---|---|---|---|---|---|
| `Main` | 1 · Mess home | 390 × 844 | `/app` | yes | no |
| `e02-qr` | 2 · Scan the mess QR | 390 × 844 | `/app/scan` | yes | no |
| `e03-meal` | 3 · Meal request | 390 × 844 | `/app/meal` | yes | no |
| `e04-parcel` | 4 · Parcel request | 390 × 844 | `/app/parcel` | yes | no |
| `e05-section` | 5 · Circle / section | 390 × 844 | `/app/section` | yes | no |
| `e06-menu` | 6 · Today's menu | 390 × 844 | `/app/menu` | yes | no |
| `e07-poster` | 7 · AI menu poster | 390 × 844 | `/app/menu/poster` | yes | no |
| `e08-status` | 8 · Order status | 390 × 844 | `/app/orders/:id` | yes | no |
| `e09-track` | 9–11 · Live tracking, map, ETA | 390 × 844 | `/app/orders/:id/track` | yes | no |
| `e10-driver` | 12 · Driver details | 390 × 844 | `/app/orders/:id/driver` | yes | no |
| `e11-confirm` | 13 · Delivery confirmation | 390 × 844 | `/app/orders/:id/confirm` | yes | no |
| `e12-qty` | 14 · Quantity received | 390 × 844 | `/app/orders/:id/quantity` | yes | no |
| `e13-review` | 15 · Review | 390 × 844 | `/app/orders/:id/review` | yes | no |
| `e14-complaint` | 16 · Complaint – photo, voice | 390 × 844 | `/app/complaints/new` | yes | no |
| `e15-guest` | 17 · Guest request | 390 × 844 | `/app/guest-request` | yes | no |
| `e16-group` | 18 · Group request | 390 × 844 | `/app/group` | yes | no |

## Mess owner app – 16 screens

Role: Mess Owner (Operator: kitchen and dispatch screens)

| Board | Screen | Size | Route (planned) | Approved | Implemented |
|---|---|---|---|---|---|
| `o01-dash` | 1 · Owner dashboard | 390 × 844 | `/owner` | yes | no |
| `o02-new` | 2 · New requests | 390 × 844 | `/owner/requests` | yes | no |
| `o03-detail` | 3–4 · Request – accept and lock | 390 × 844 | `/owner/requests/:id` | yes | no |
| `o04-kitchen` | 5–6 · Preparing · Ready | 390 × 844 | `/owner/kitchen` | yes | no |
| `o05-group` | 7 · Parcels by section | 390 × 844 | `/owner/parcels` | yes | no |
| `o06-batch` | 8 · Create delivery batch | 390 × 844 | `/owner/batches/new` | yes | no |
| `o07-driver` | 9–10 · Driver and vehicle | 390 × 844 | `/owner/batches/:id/driver` | yes | no |
| `o08-route` | 11 · Route optimisation | 390 × 844 | `/owner/batches/:id/route` | yes | no |
| `o09-dispatch` | 12 · Dispatch | 390 × 844 | `/owner/batches/:id/dispatch` | yes | no |
| `o10-live` | 13 · Live deliveries | 390 × 844 | `/owner/live` | yes | no |
| `o11-menu` | 14 · Publish today's menu | 390 × 844 | `/owner/menu` | yes | no |
| `o12-guests` | 15 · Guest meals | 390 × 844 | `/owner/guests` | yes | no |
| `o13-closing` | 16 · Daily closing | 390 × 844 | `/owner/closing` | yes | no |
| `o14-complaints` | 17 · Complaints | 390 × 844 | `/owner/complaints` | yes | no |
| `o15-billing` | 18 · Contractor billing | 390 × 844 | `/owner/billing` | yes | no |
| `o16-followup` | 19 · Confirmation follow-up | 390 × 844 | `/owner/follow-up` | yes | no |

## Driver app – 11 screens

Role: Driver

| Board | Screen | Size | Route (planned) | Approved | Implemented |
|---|---|---|---|---|---|
| `d01-home` | 1 · Driver home | 390 × 844 | `/driver` | yes | no |
| `d02-assign` | 2–3 · New delivery – accept | 390 × 844 | `/driver/assignments/:id` | yes | no |
| `d03-vehicle` | 4 · Vehicle | 390 × 844 | `/driver/vehicle` | yes | no |
| `d04-batch` | 5 · Delivery batch | 390 × 844 | `/driver/batches/:id` | yes | no |
| `d05-route` | 6–7 · Route and navigation | 390 × 844 | `/driver/batches/:id/route` | yes | no |
| `d06-stops` | 8 · Section stops | 390 × 844 | `/driver/batches/:id/stops` | yes | no |
| `d07-people` | 9 · Employee-wise delivery | 390 × 844 | `/driver/batches/:id/stops/:stop` | yes | no |
| `d08-otp` | 10 · OTP confirmation | 390 × 844 | `/driver/deliveries/:id/code` | yes | no |
| `d09-done` | 11 · Delivered | 390 × 844 | `/driver/deliveries/:id/done` | yes | no |
| `d10-failed` | 12 · Failed delivery | 390 × 844 | `/driver/deliveries/:id/failed` | yes | no |
| `d11-summary` | 13 · Delivery summary | 390 × 844 | `/driver/summary` | yes | no |

## Web – 17 screens

Role: Site Admin · Supervisor · Accounts · Management · System Admin (see PERMISSIONS)

| Board | Screen | Size | Route (planned) | Approved | Implemented |
|---|---|---|---|---|---|
| `w01-dash` | 1 · Admin dashboard | 1440 × 1100 | `/admin` | yes | no |
| `w02-sections` | 2 · Sites, circles, sections | 1440 × 1100 | `/admin/sites` | yes | no |
| `w03-mess` | 3 · Mess master | 1440 × 1100 | `/admin/mess` | yes | no |
| `w04-contractor` | 4 · Contractor master | 1440 × 1100 | `/admin/contractors/:id` | yes | no |
| `w05-docs` | 5 · Documents and compliance | 1440 × 1100 | `/admin/contractors/:id/documents` | yes | no |
| `w06-rates` | 6–7 · Work order and rates | 1440 × 1100 | `/admin/work-orders/:id` | yes | no |
| `w07-consumption` | 8 · Daily consumption | 1440 × 1100 | `/admin/consumption` | yes | no |
| `w08-billing` | 9, 11 · Monthly billing, GST / TDS | 1440 × 1100 | `/admin/billing/:id` | yes | no |
| `w09-recon` | 10 · Invoice reconciliation | 1440 × 1100 | `/admin/billing/:id/reconciliation` | yes | no |
| `w10-approvals` | 12–13 · Approvals and payments | 1440 × 1100 | `/admin/approvals` | yes | no |
| `w11-reports` | 14 · Reports | 1440 × 1100 | `/admin/reports` | yes | no |
| `w12-analytics` | 15 · Analytics | 1440 × 1100 | `/admin/analytics` | yes | no |
| `w13-scorecard` | 16 · Contractor scorecard | 1440 × 1100 | `/admin/scorecard` | yes | no |
| `w14-complaints` | 17 · Complaint dashboard | 1440 × 1100 | `/admin/complaints` | yes | no |
| `w15-audit` | 18 · Audit log | 1440 × 1100 | `/admin/audit` | yes | no |
| `w16-registrations` | 19 · New / unregistered registrations | 1440 × 1100 | `/admin/registrations` | yes | no |
| `w17-guest` | 20 · Guest profile and visits | 1440 × 1100 | `/admin/guests/:id` | yes | no |

## Registration and guests – 11 screens

Role: Employee (first time) · Guest

| Board | Screen | Size | Route (planned) | Approved | Implemented |
|---|---|---|---|---|---|
| `r01-who` | R1 · First time – who are you? | 390 × 844 | `/start` | yes | no |
| `r02-rclid` | R2 · RCL ID | 390 × 844 | `/start/rcl-id` | yes | no |
| `r03-found` | R3 · Found in HR – auto-filled | 390 × 844 | `/start/found` | yes | no |
| `r04-otp` | R4 · WhatsApp code | 390 × 844 | `/start/code` | yes | no |
| `r05-done` | R5 · Registered – verified employee | 390 × 844 | `/start/done` | yes | no |
| `r06-notfound` | R6 · Employee record not found | 390 × 844 | `/start/not-found` | yes | no |
| `r07-newreg` | R7 · New registration | 390 × 844 | `/start/new` | yes | no |
| `r08-temp` | R8 · Temporary – waiting for check | 390 × 844 | `/start/temporary` | yes | no |
| `g01-welcome` | G1 · Welcome back, guest | 390 × 844 | `/guest/welcome` | yes | no |
| `g02-home` | G2 · Guest home | 390 × 844 | `/guest` | yes | no |
| `g03-history` | G3 · My visits and orders | 390 × 844 | `/guest/history` | yes | no |

## Assets

| Asset | Used on | Format / size | Approved | Implemented | Note |
|---|---|---|---|---|---|
| The look – colours, type sizes, cards, chips, buttons, tab bar, timeline, tables | every screen | the design's stylesheet → Tailwind tokens | yes | no | cream #FAF8F2, ink #18221C, leaf #2F7A45, saffron #C2560E (buttons), navy #0E1B33 (hero, driver app, web sidebar), gold #D99E39, plum #5B2BA0 (guests), WhatsApp green only for WhatsApp |
| Font – Schibsted Grotesk | every screen | woff2, variable 400–800, Latin | yes | no | SIL Open Font License 1.1 – served by FALCON itself |
| Icons – Lucide | every screen | SVG, 24 grid, 2 px stroke | yes | no | ISC licence; the same icon names in the app |
| Road maps (circles A–C, sections, van, pins) | e09, o08, o10, d05, w01, w02 | 5 drawn SVGs | yes – as the layout | no | stand-ins for the live map (Google Maps, decision 4); the pins, van and route line keep the design |
| Photo areas (complaint photos, selfie, menu poster) | e07, e14, o14, w14, r07 | the person's own photo | yes | no | the real photo the person takes – no stock picture |
| FALCON mark in the header and sidebar | every screen | – | **missing** | no | the design shows the word FALCON with the utensils mark in a navy tile until he gives the logo |

## Missing – to be given by him

* The FALCON logo (app icon, splash, sidebar, browser tab, notifications).

Total: 71 screens.
