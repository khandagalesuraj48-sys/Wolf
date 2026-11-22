# CLAUDE.md – FALCON (Food & Site Operations)

Read this first, then `README.md` and `docs/DECISIONS.md`. The same owner and rules as the ERP repositories (`rclerp`,
`rcl-portal`, `rcl-hr` …); the short version:

## The owner and how to talk to him
* Sujit Mule, MD of Rachana Construction Limited (RCL).
* **Reply in Marathi (Devanagari).** Answer first. Simple. One step at a time.
* "adhi charcha kar" = discuss first, no code. "fkt check kr" = only check, change nothing.

## Rules
1. **Exactly what he asks, nothing extra.** He decides each step.
2. **The approved designs are the source of truth** (`docs/DESIGN_INVENTORY.md`): build them as they are – no redesign, no
   stock pictures, no screen left out. A missing asset is written down and asked for, never invented.
3. **Live and business-critical:** never delete, reset or overwrite live data; no destructive SQL; no push to `main` / deploy
   without his yes; a database change is justified and approved separately and **he runs the SQL himself** (the master SQL,
   only after it was tested on a clean database). Existing features and permissions keep working.
4. **Evidence, not claims:** read the code, run the tests, say plainly what was not run or not verified.
5. **Every shell / test / network command has a `timeout`.** A hang: run the one test alone, find the case, fix it. Never just re-run.
6. **Fix a thing everywhere it is used** – web, phone and the server's checks.
7. **The repository is PUBLIC** for now: no secret, key, password or personal data in any file – no real person's name, number
   or photo, not in a test either. Keys live only in Vercel → Environment Variables and are never pasted in chat.
8. Work arrives as a branch + pull request; he merges; Vercel deploys.

## Name
* The application is **FALCON** – "Food & Site Operations", by Sketchline Industries. It is **not** "LION Mess" and not a part
  of LION by name. The repository may stay "Wolf"; the application is never called Wolf.
