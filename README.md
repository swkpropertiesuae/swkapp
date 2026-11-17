# SWK Daily

Offline-first PWA for SWK Properties staff, modelled on the SWK ONE staff portal (Attendance, Manual, utilities).

- **Home**: check in/out (optional GPS), task ring, week strip, daily work summary.
- **Tasks**: daily checklist plus repeat-daily routine.
- **Tools**: cost to close, mortgage, yield, commission split, RERA rent increase, short manual.
- **History**: monthly attendance, hours, CSV export.

Run: `python3 -m http.server 8080` then open http://localhost:8080 (service worker needs localhost or HTTPS).
Test: `node calc.test.mjs`.

Data lives in browser localStorage only. No server, no sync, no login. Calculators are indicative.
