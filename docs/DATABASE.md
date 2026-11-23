# FALCON – the database (one master SQL)

## What there is

* `supabase/migrations/0001…0014_*.sql` – the source, part by part (each safe to run again):

| Part | What it makes |
|---|---|
| 0001 foundation | companies, sites, circles, sections, people, guest profiles, dated role grants, phones, dated settings, the append-only audit log; `me()`, `has_role()` … |
| 0002 mess and contracts | contractors (bank details apart), their papers, messes, items, work orders, rates with dates (one approved rate a day), penalties, GST / TDS rules, meal times, menus |
| 0003 orders | orders and their lines (one main meal a person a meal a day), guests' visits, the five kinds of confirmation, delivery codes, reviews |
| 0004 delivery | vans, batches by section, stops with ETAs, the van's place only while on the way, hand-over with the code, short, failed |
| 0005 complaints and closing | complaints (reply time, action, found true, penalty), the day's closing and lock, corrections kept |
| 0006 billing | the month's bill from confirmed lines of locked days × that day's rate; GST / TDS from Accounts' rules; retention, advance, penalties; the invoice checked line by line; approvals by different people; ERP posting; payment with its UTR |
| 0007 registration | registrations and the Site Admin's decisions; the LION sign-in's tickets used once; the RCL-ID start; linking without a second record |
| 0008 notifications | the in-app notices and the daily alerts |
| 0009 storage | the five private buckets and who may put / read a file |
| 0010 realtime | the live tables |
| 0011 app helpers | the screens' read functions (my van, the kitchen's list, the follow-up calls, the office's numbers …) |
| 0012 admin | a dated setting changed by the System Admin (`set_setting`) |
| 0014 Start codes | a contractor's own sign-in code (System Admin only, one code in all of FALCON, never a company's); what a first-screen code is (company / contractor – the server only); the contractor's mobiles (a live Mess owner / operator role at one of its messes); limits – a mobile 1 code a minute, 5 an hour, 10 a day; look-ups per internet address (fingerprints only, kept one day); the work order's BOQ (quantity per item, Accounts / System Admin, audited) |
| 0013 HR's people | HR's list kept (RCL ID, name, designation, category, site, mobile, status – nothing else), copied every hour; a new HR site made; who left stopped; an HR employee known by his mobile after a WhatsApp code; the first System Admin (`FALCON_FIRST_ADMIN`) |
| 0017 only Sections | a section's area (`sections.radius_m`, the metres around its point); no circle asked (`circle_id` may be empty – the circles of before stay); a van order to a section OR to a location outside every section (`orders.to_lat / to_lng`, kept only then); `section_at` – the section whose area holds a point (the nearest); a van stop is a section or one such location (`batch_stops.order_id`), nearest to the mess first; `request_order` takes the phone's point (`p_lat`, `p_lng`); `reach_stop` a location (`p_order`); the Km in the order of the codes |
| 0018 server reads | the server role (`service_role`) may READ `companies`, `sites`, `messes`, `meal_windows`, `menus` – the five tables of HR's Mess card (`api/hr.js`); his Supabase gives that role no reading of a new table by itself (23-11-2026: "42501 permission denied for table companies"). Nothing else, no writing. |

* `supabase/FALCON_MASTER.sql` – **the one script to run**, built from the parts by `supabase/build_master.sh` (never edited by
  hand), inside one transaction: all or nothing.
* `supabase/seed/seed.sql` – apart from the master: the company RCL and the items of a bill (the four meals, guest meal, parcel
  packing, water 1 L). No person, rate, tax rule, site or money.

* `supabase/updates/<date>_*.sql` – a later part alone, for a database that already has the master (one transaction).

## Updates after the first run

| Date | File | What |
|---|---|---|
| 23-11-2026 | `supabase/updates/2026-11-23_hr_people.sql` | HR's employees in FALCON and the first System Admin (part 0013). Tested on a copy with the master of 23-11-2026 and the seed: run twice, then every test (162 checks) |
| 23-11-2026 | `supabase/updates/2026-11-23c_start_codes.sql` | The company code first, a contractor's sign-in code, the limits on codes and look-ups, the BOQ (part 0014). **Run it before the web update of the same day is merged.** Tested on a copy with parts 0001–0013 and the seed: run twice (no error, no table without RLS, no contractor changed), then every test (194 checks) |
| 23-11-2026 | `supabase/updates/2026-11-23b_hr_not_left.sql` | Every employee in HR's list who has NOT LEFT counts (the first copy: all 86 were "pending" / "incomplete" in HR). Part 0013's functions again. Tested on a copy with the first master, the seed and the first update: run twice, then every test (163 checks) |

## Running it (his step)

1. Supabase → the `falcon` project → **SQL Editor → New query**.
2. Paste the whole of `supabase/FALCON_MASTER.sql` → **Run**. It ends with `commit`. If it stops with an error, nothing of it
   stays – send the error (no key is in it) and run it again after the fix.
3. A new query: paste `supabase/seed/seed.sql` → **Run**. Its last lines show the seven items.
4. Check (read only): `select count(*) from pg_tables where schemaname = 'public' and not rowsecurity;` → **0** (every table has
   Row Level Security).

It deletes nothing, changes no row that is there, and may be run again (a second run changes nothing).

## How it was tested (before he is asked to run it)

`supabase/test/run_master.sh` on a new, clean, throwaway Postgres 16 with a stand-in of Supabase's `auth`, `storage`, roles and
Realtime publication (`supabase/test/00_supabase_stub.sql`): the master run once, run again, the seed run twice, then every test
file against that database – see `docs/TEST_REPORT.md`. The stand-in is not Supabase itself: the first run on the real project is
his, and the checks above confirm it.

## Rules the database keeps by itself

* Row Level Security on every table; the browser's key may read only what the person's roles allow, and changes go through
  checked functions (`security definer`, `search_path = ''`). Nothing is deleted through the API.
* Every change is in `audit_log` (who, when, before, after, how, reason); nobody changes or deletes a line of it.
* A locked day is not changed – a correction is a new row, kept with its reason.
* Money is counted from confirmed lines only; a rate, a meal time, a setting and a tax rule each have their dates, and a day is
  always counted with the version of that day. No GST / TDS number is in the code.
