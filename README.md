# SWK Daily

Staff attendance, daily tasks and UAE deal calculators for SWK Properties, with login and a manager dashboard.

## Features
- **Staff:** check in/out (server clock, optional GPS), task list with repeat-daily routine, work summary, monthly history, calculators (cost to close, mortgage, yield, commission split, RERA rent increase).
- **Manager:** live "who is in today" board with tasks and summaries, monthly report per person, team CSV export, add staff, deactivate, reset passwords.
- **Security:** scrypt password hashing, HttpOnly SameSite=Strict session cookie (tokens stored hashed), login throttling (5 failures = 15 min lock), forced password change for temporary passwords, JSON-only and same-origin checks on writes, CSV formula-injection guard, strict CSP.

## Run locally
Needs Node 22.13+ and a Postgres database.

```bash
npm ci
cp .env.example .env     # set DATABASE_URL, SWK_ADMIN_EMAIL, SWK_ADMIN_PASSWORD (min 10 chars)
npm start                # http://localhost:8080
TEST_DATABASE_URL=postgres://... npm test   # API tests run in a throwaway schema; skipped if unset
```
The first start creates the schema and the manager. Create staff in the Team tab; they must change their temporary password at first sign-in.

## Deploy on Vercel
`public/` is served by the CDN and `api/[...path].js` runs the API as a function. Add a Neon Postgres from the Vercel Marketplace (sets `DATABASE_URL`), and set `SWK_ADMIN_EMAIL` and `SWK_ADMIN_PASSWORD` as environment variables before the first request. Cookies are marked Secure automatically on Vercel.
Days roll over at midnight Asia/Dubai. Calculator rates (4% DLD, 2% agency, RERA bands) are indicative.
