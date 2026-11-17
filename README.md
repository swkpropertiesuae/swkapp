# SWK Daily

Offline-first PWA for SWK Properties staff, modelled on the SWK ONE staff portal (Attendance, Manual, utilities).

- **Today**: check in/out (optional GPS), task checklist (with repeat-daily template), daily work summary.
- **Log**: monthly attendance, hours, CSV export.
- **Tools**: cost to close (DLD 4%), mortgage, yield, commission split, RERA rent increase.
- **Manual**: short SOP.

Run: `python3 -m http.server 8080` then open http://localhost:8080 (service worker needs localhost or HTTPS).
Test: `node calc.test.mjs`.

Data lives in browser localStorage only. No server, no sync, no login. Calculators are indicative.
