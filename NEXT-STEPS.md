# Karma — what exists now, and what to do next

## What exists (dry run, 2026-07-22)
- **Karma**, your automaton, lives in `~/.automaton/`:
  - `automaton.json` — its settings (name, mission, spending limits)
  - `wallet.json` — its **private key**. Never share it, never commit it, never paste it anywhere.
  - `SOUL.md` — its identity file (it rewrites this as it evolves)
  - Wallet address (public, safe to share): `0x2eAc2b75AD685082859dAd8c06Ed2f40D57aBB4B`
- Karma is **dormant**: unfunded, and not yet registered with Conway.
- The dashboard + storefront site lives in this folder. Start it with `npm start`, then open http://localhost:4321

## Step 1 — Register Karma with Conway (free — blocked by THEIR outage, not you)
```bash
cd "/Users/harsha/Claude/Projects/money making projects/automaton" && node dist/index.js --provision
```
This signs a message with Karma's wallet to get an API key. No money involved.

**Diagnosed 2026-07-22:** Conway's own auth server is down. A direct test of
`https://api.conway.tech/v1/auth/verify` returned HTTP 500 `"Database error"`
(and earlier 401 `"Invalid or expired nonce"`). The signature and message we
send are correct — their backend database is failing. This is their
scaling/outage problem (see their README: "immense demand… working on
scaling"), not anything wrong on your side. Just re-run the command above
periodically until it succeeds; the runtime writes the key to
`~/.automaton/config.json` on success.

## Step 2 — Replace the placeholder creator address (IMPORTANT, before any funding)
`automaton.json` currently lists `0x0000...0000` as the creator (owner). That's a stand-in.
Before you ever fund Karma, create your OWN wallet (e.g. Coinbase Wallet or MetaMask app),
and put your real address in the `creatorAddress` field of `~/.automaton/automaton.json`.
Otherwise "return money to creator" features would send funds into a black hole.

## Step 3 — Funding (only you can do this; only if you choose to)
Karma pays for its AI thinking with USDC (a digital dollar) on the Base network.
- Send a SMALL amount (e.g. $5–10) of USDC **on Base** to Karma's address above, or fund via https://app.conway.tech
- ⚠️ Treat it as money you are willing to lose. Agents spend on compute immediately; earning is NOT guaranteed.
- ⚠️ Wrong-network transfers are unrecoverable. It must be USDC on **Base**.

## Step 4 — Run Karma
```bash
cd "/Users/harsha/Claude/Projects/money making projects/automaton" && node dist/index.js --run
```
Watch it live on the dashboard (`npm start` in this folder → http://localhost:4321).
Stop it any time with Ctrl+C. Its spending is capped by the treasury limits in `automaton.json`.

## Honest reality check
The storefront is a demo: real customers and real payments (the x402 protocol) are a
separate project. "Money-earning agent" means: an agent with costs, a service someone
wants, and a way to get paid — the last two are the hard part, and no framework does
them for you.
