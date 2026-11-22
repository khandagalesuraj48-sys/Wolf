# FALCON – going live (Supabase, Vercel, the Portal, WhatsApp)

Every step here is **his** – the owner makes the projects, sets the values and runs the SQL. Nothing below asks for a key in chat
or puts one in a file. Nothing of the ERP (LION, its Portal, HR, Mechanical …) is changed by these steps; the two steps that
need a change in another repository (the Portal's module, HR's look-up) are open decisions (docs/DECISIONS.md) and their own
piece of work.

## 1 · FALCON's own Supabase project

1. supabase.com → **New project** – name `falcon`, region **Mumbai (ap-south-1)**, a strong database password kept by him.
2. **The database:** run `supabase/FALCON_MASTER.sql`, then `supabase/seed/seed.sql` – see `docs/DATABASE.md`.
3. **Authentication → Sign In / Providers**
   * **Phone: on.** The SMS provider is not used: the code goes by WhatsApp through the hook below. OTP length **6** (the screens
     have six boxes), expiry 600 seconds.
   * **Email: on** – the LION sign-in uses a one-time link Supabase makes on the server (no mail is ever sent: the address is
     `…@falcon.invalid`). "Confirm email" may stay on.
   * **Allow new users to sign up: on.** A WhatsApp code makes only the sign-in; FALCON's own database decides what a person may
     see – nothing at all until he has registered and the Site Admin (or HR) has verified him.
4. **Authentication → Hooks → Send SMS hook → HTTPS**: URL `https://<FALCON's address>/api/sms-hook`; press **Generate secret**
   and put that secret (it starts `v1,whsec_`) in Vercel as `SEND_SMS_HOOK_SECRET`.
5. **Authentication → URL Configuration**: Site URL = FALCON's address; Redirect URLs = the same address.
6. **Realtime and Storage:** nothing to do – the master SQL adds the live tables to Realtime and makes the five private buckets
   (complaint-media, contractor-papers, invoices, menu-posters, registration-photos) with their rules.
7. **Project Settings → API**: the Project URL, the publishable (anon) key and the service-role key go to Vercel (step 2). The
   service-role key is **never** given a `VITE_` name and never leaves Vercel.

## 2 · The Vercel project

1. vercel.com → **Add New → Project** → import `khandagalesuraj48-sys/Wolf`. Its own project – never the ERP's. The settings come
   from `vercel.json` (build `npm run build`, output `dist`, the security headers, the daily timer).
2. **Settings → Environment Variables** (names in `.env.example`):

| Name | Production | Preview | Where it comes from |
|---|---|---|---|
| `VITE_SUPABASE_URL` | yes | **no** (see below) | Supabase → API → Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | no | Supabase → API → publishable / anon key |
| `VITE_FALCON_COMPANY_CODE`, `FALCON_COMPANY_CODE` | `RCL` | `RCL` | the company of the seed |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | no | Supabase → API → service_role (server only) |
| `SEND_SMS_HOOK_SECRET` | yes | no | Supabase → Hooks (step 1.4) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | yes | no | Meta → WhatsApp → the same number as the ERP's (decision 3) |
| `WHATSAPP_OTP_TEMPLATE`, `WHATSAPP_OTP_LANG` | `otp`, `en` | – | the approved authentication template (body code + copy-code button) |
| `PORTAL_URL` | the Portal's address | – | only when the Portal's module `falcon` is there (decision 1) |
| `HR_LOOKUP_URL`, `HR_LOOKUP_SECRET` | – | – | only when HR's look-up is there (decision 2); until then "not checked" |
| `CRON_SECRET` | a long random value | – | made by him; Vercel's timer sends it by itself |
| `VITE_GOOGLE_MAPS_KEY` | – | – | not used yet (decision 4) |

   **Preview gets no Supabase value** until a separate test Supabase project exists: a preview of a branch must never write into
   the live database. Without the values a preview opens the "not connected yet" page.
3. **Deploy.** After any change of a variable: Deployments → the newest → **Redeploy** (the `VITE_` values are built into the page).
4. **Domain:** the address he chooses (Settings → Domains). The DNS record is his to set.
5. **The daily timer:** `vercel.json` → `/api/daily` at 00:30 UTC (06:00 India) – papers ending, temporary access ending, days
   not closed, complaints not answered. Vercel Hobby runs a timer once a day, which is all FALCON needs.

## 3 · The first sign-in

* With the Portal connected (decision 1): the Portal's Super Admin opens FALCON from the Portal – the ticket is checked
  (ES256 signature by `PORTAL_URL/api/jwks`, `aud` = `falcon`, `exp`, its `jti` used once) and he is FALCON's **System Admin**.
* Then, from the web (`/admin`): Sites and sections (sites, circles, sections with their km and drop points) → Mess and
  contractors (the mess, its meal times, its counter QR codes to print; the contractor, his bank details, his papers) → Work
  orders and rates (Accounts: the work order, each rate from a date, penalties) → Settings (Accounts: the GST and TDS rules with
  the CA's check) → People and roles (who is Mess Owner, Operator, Supervisor, Driver, Site Admin, Accounts, Management; the vans).
* People register themselves (WhatsApp code; RCL ID looked up in HR when it is connected); the Site Admin verifies them in
  Registrations.

## 4 · What the Portal's module needs (decision 1 – a change in `rcl-portal`, not made here)

* A module with the key **`falcon`** and FALCON's address. Opening it sends the person to `https://<FALCON>/#sso=<ticket>`.
* The ticket (ES256, the Portal's own key, like every module's): `aud: "falcon"`, `sub` (his user ID), `name`, `jti`, `exp`
  (a few minutes), `iss` (the Portal's address), optionally `site` (the site code) and `super: true` for the Super Admin.

## 5 · What HR's look-up needs (decision 2 – a change in `rcl-hr`, not made here)

* `POST HR_LOOKUP_URL` with `Authorization: Bearer HR_LOOKUP_SECRET` and `{ "rcl_id": "VTR-0457", "mobile": "+91…" | null }`.
* Answer: `{ result: "found" | "not_found" | "maybe", name, designation, department, category, site, ref, mobile, mobile_matches }`
  – never KYC, bank or pay. HR's mobile stays on FALCON's server (the code is sent to it); the browser sees it masked.

## Going back

* The page and the server: Vercel → Deployments → the previous one → **Instant Rollback**.
* The database: the master SQL deletes nothing and is safe to run again; a later version is a new numbered part.
