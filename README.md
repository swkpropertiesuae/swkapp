# SWK Daily

Staff attendance, daily tasks and UAE deal calculators for SWK Properties, with login and a manager dashboard.

## Features
- **Staff:** check in/out (server clock, optional GPS), task list with repeat-daily routine, work summary, monthly history, calculators (cost to close, mortgage, yield, commission split, RERA rent increase).
- **Manager:** live "who is in today" board with tasks and summaries, monthly report per person, team CSV export, add staff, deactivate, reset passwords.
- **Security:** scrypt password hashing, HttpOnly SameSite=Strict session cookie (tokens stored hashed), login throttling (5 failures = 15 min lock), forced password change for temporary passwords, JSON-only and same-origin checks on writes, CSV formula-injection guard, strict CSP.

## Run
Needs Node 22.13+. No npm dependencies.

```bash
cp .env.example .env     # set SWK_ADMIN_EMAIL and SWK_ADMIN_PASSWORD (min 10 chars)
npm start                # http://localhost:8080
npm test
```
The first start creates the manager from those variables. Create staff in the Team tab; they must change their temporary password at first sign-in.

## Deploy notes
Serve over HTTPS and set `SECURE_COOKIES=1`. Data is one SQLite file (`DB_PATH`, default `data/swk.db`): back it up. Days roll over at midnight Asia/Dubai.
Calculator rates (4% DLD, 2% agency, RERA bands) are indicative.
