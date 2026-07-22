# automaton-site

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-read--only-003B57?logo=sqlite&logoColor=white)
![Status](https://img.shields.io/badge/status-demo-orange)

A small local website for keeping an eye on the "Karma" automaton AI agent
and letting people ask to hire it.

- **`/`** — Dashboard: a live "mission control" view of Karma's status,
  wallet, recent turns (thoughts/actions), SOUL.md identity file, metrics,
  and scheduled heartbeat tasks. Auto-refreshes every 5 seconds.
- **`/hire`** — Storefront: describes what Karma can do and has a form to
  submit a work request (saved locally to `requests.json`).

This site reads Karma's state from `~/.automaton/` (config, SQLite
database, SOUL.md, heartbeat.yml) but never writes to it, and never
exposes secret fields (API keys) to the browser. If Karma hasn't been set
up yet, every page shows a friendly "not awake yet" empty state instead of
crashing.

## Requirements

- Node.js 22+

## Run it

```bash
npm install
npm start
```

Then open http://127.0.0.1:4321/ in your browser.

The server only listens on `127.0.0.1` (localhost), so it's not reachable
from other devices on your network.

## Reviewing hire requests

Submitted requests are appended to `requests.json` in this folder (not
committed to git — see `.gitignore`). You can also view them as JSON at
http://127.0.0.1:4321/api/requests.
