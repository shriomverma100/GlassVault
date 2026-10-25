# Demo

The judges' demo — logins for every role, the upload kit, and the 14-act sequence (with the
5-minute cut) — is in **[demo/DEMO-RUNBOOK.md](demo/DEMO-RUNBOOK.md)**.

```bash
npm run stop && npm run start:prod     # fresh platform on http://localhost:5173
node demo/make-kit.mjs                 # receipt photos to upload (demo/kit/)
node e2e/demo-rehearsal.js             # replays all 14 acts through the UI (needs the stack running)
```
