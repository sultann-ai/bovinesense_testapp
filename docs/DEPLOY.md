# Deploying BovineSense to Vercel

The app is a Next.js project (`npm run build`); the backend is one hosted Supabase project. Nothing else runs anywhere. Do the Supabase part first, then Vercel, then lock the Google Maps key to the Vercel address.

## 1. Environment variables

Set these in Vercel: **Project → Settings → Environment Variables**. Names only here; never put values in git.

| Variable | Public? | Where the value comes from | Needed for |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase → Project Settings → API → Project URL | everything |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase → Project Settings → API → anon / publishable key | sign-in, every page and API route |
| `SUPABASE_SERVICE_ROLE_KEY` | **SECRET, server only** | Supabase → Project Settings → API → service_role / secret key | `/api/ingest/fix` and the server-side access check only |
| `NEXT_PUBLIC_SITE_URL` | public | your production address, e.g. `https://your-app.vercel.app`, no trailing slash | password-reset and invitation links |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | public (ships to the browser) | Google Cloud Console → Credentials | the map |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | public | Google Cloud Console → Map Management (see [MAP_STYLE.md](MAP_STYLE.md)) | the cream map style |
| `INGEST_RATE_LIMIT_PER_MIN` | optional | a number; default 3000 | fixes one device key may send per minute |

Rules:

- Set `SUPABASE_SERVICE_ROLE_KEY` for **Production** and **Preview** only if you need it there, and **never** give it a `NEXT_PUBLIC_` prefix. Mark it *Sensitive* in Vercel.
- Scripts that run on your own machine (`seed`, `simulate`, `invite`, `device-key`, `seed:real-tag`) read the same names from your local `.env.local`. They are not part of the deployment. `REAL_TAG_SERIAL` is a local-script variable only.
- The simulator and the real tag authenticate to `/api/ingest/fix` with a **device key** (header `x-api-key`), created per organization on the Devices screen or with `npm run device-key`. There is no shared ingest secret.

## 2. Supabase, once

1. Create the project. Apply every file in `supabase/migrations/` in order: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
2. **Database → Extensions**: make sure `postgis` and `pg_cron` are enabled. If `pg_cron` was enabled after the migrations ran, run `select public.schedule_background_jobs();` once in the SQL Editor.
3. Load data: `npm run import:boundaries`, then run `supabase/seed.sql` in the SQL Editor, then `npm run seed:accounts` for the demo logins (see [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md)). Real customers: use `supabase/scripts/onboard_org.sql` and `npm run invite` instead, and **never** run `seed:accounts` on a project that holds real data.
4. **Authentication → URL Configuration**: set **Site URL** to the Vercel address, and add `https://<your-app>.vercel.app/**` (and your custom domain, if any) under **Redirect URLs**.
5. **Authentication → Sign In / Providers**: *Allow new users to sign up* off; minimum password length 10.
6. Regenerate the types after migrations: `npm run types:gen`.

## 3. Vercel, step by step

1. Push the repository to GitHub (or GitLab / Bitbucket). Check `git status` first: `.env*` must not be staged.
2. In Vercel: **Add New → Project**, import the repository. Framework preset **Next.js** is detected; leave the build command (`npm run build`) and output as they are.
3. Before the first deploy, add the variables from the table above (Production; add Preview too if you use preview URLs, remembering the Maps key and Supabase redirects must then allow those addresses).
4. **Deploy**. Note the production address (`https://<your-app>.vercel.app`).
5. Set `NEXT_PUBLIC_SITE_URL` to that address if you used a placeholder, and **Redeploy** (public variables are baked in at build time, so a change needs a new build).
6. Open `/api/health` while signed out: it should answer. Then open `/login` and sign in with a demo account.
7. Send one test fix with a device key to confirm ingestion works from the internet:

```powershell
npm run device-key -- create --org bank-of-punjab --label "Demo laptop"
$env:INGEST_URL = "https://<your-app>.vercel.app/api/ingest/fix"
npm run simulate -- --org bank-of-punjab --key <the key printed above>
```

## 4. Restrict the Google Maps key to the Vercel address

The browser key is visible to anyone who opens the site, so it must only work from your own addresses. Do this **before** you share the link.

1. Google Cloud Console → **APIs & Services → Credentials** → click the Maps browser key.
2. **Application restrictions**: choose **Websites (HTTP referrers)** and add one line per address:
   - `https://<your-app>.vercel.app/*`
   - your custom domain, if you have one: `https://app.example.com/*`
   - for local work only, in a *separate* development key: `http://localhost:3000/*`
3. **API restrictions**: choose **Restrict key** and tick **Maps JavaScript API** only.
4. Save. Changes take up to about five minutes.
5. **Billing**: Billing → Budgets & alerts → add a budget alert; APIs & Services → Maps JavaScript API → Quotas → set a daily map-load limit.
6. Check: open the deployed site and load the Overview (the map draws). Then, in a private window, open a plain page on another domain that loads the same key; Google should refuse it (`RefererNotAllowedMapError` in the browser console).

Preview deployments get a different address each time; either add `https://*-<team>.vercel.app/*` to the referrer list or test on production only.

## 5. Security checks before sharing the link

- **Service-role key never in the browser.** After a build, run `npm run build` then `npm run check:bundle`. It scans every file under `.next/static` (what browsers download) for the variable name, the key's value (when set in your environment or `.env.local`) and any token whose role is `service_role`, and fails if it finds one.
- **Headers.** `next.config.ts` sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` on every route. Check with `curl -I https://<your-app>.vercel.app/login`.
- **Rate limit.** `/api/ingest/fix` answers `429` after 30 rejected keys a minute from one address, and after `INGEST_RATE_LIMIT_PER_MIN` fixes a minute for one key.
- **Demo accounts.** They share one published password. Delete them (`npm run seed:accounts:remove`) before real data goes into the project.

## 6. Known gaps

- **No Content-Security-Policy yet.** It has to allow Google Maps scripts, tiles and fonts plus Supabase (HTTPS and WebSocket); write and test it against the deployed site, then add it to `next.config.ts`.
- **The rate limiter is per server instance.** On Vercel each warm instance counts separately, so the real ceiling is the limit times the number of instances. It stops guessing and runaway devices; it is not a global quota.
- Nothing in this document has been run against a real Vercel project from this repository yet. The first deploy may need the environment variables adjusted.
