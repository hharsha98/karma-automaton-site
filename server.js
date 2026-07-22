// server.js
// -----------------------------------------------------------------------
// This is the backend for "automaton-site" — a small local website that
// shows what our AI agent "Karma" is doing (the dashboard at "/") and lets
// people ask to hire Karma (the storefront at "/hire").
//
// It is a plain Node.js + Express server. No frameworks, no build step.
// Everything the browser needs lives in the public/ folder as plain
// HTML/CSS/JS files, and this file just serves them plus a small JSON API
// that the browser pages call with fetch().
//
// SECURITY NOTE (read this before touching the code):
// Karma's config file can contain secret API keys. This server must NEVER
// send those secrets to the browser. Every place that reads Karma's data
// picks out only the specific fields we want to show (an "allowlist"),
// instead of just forwarding the whole file. See buildStatusPayload() below.
// -----------------------------------------------------------------------

import express from "express";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

// __dirname doesn't exist automatically in ES modules (the "type": "module"
// setting in package.json), so we rebuild it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -----------------------------------------------------------------------
// Where Karma's files live. All of this is READ-ONLY from this server's
// point of view — we never write into ~/.automaton.
// -----------------------------------------------------------------------
const AUTOMATON_DIR = path.join(os.homedir(), ".automaton");
const CONFIG_PATH = path.join(AUTOMATON_DIR, "automaton.json");
const DB_PATH = path.join(AUTOMATON_DIR, "state.db");
const SOUL_PATH = path.join(AUTOMATON_DIR, "SOUL.md");
const HEARTBEAT_PATH = path.join(AUTOMATON_DIR, "heartbeat.yml");

// Files we are explicitly told NEVER to open, because they hold secrets
// (private key / API key material). Listed here just as documentation —
// nothing in this file ever builds a path to these on purpose.
//   ~/.automaton/wallet.json
//   ~/.automaton/config.json

// Where we store storefront requests submitted through the "Hire Karma"
// form. Lives in the project root (NOT inside ~/.automaton).
const REQUESTS_PATH = path.join(__dirname, "requests.json");

// -----------------------------------------------------------------------
// Tiny helper: read a JSON file safely. Returns `fallback` if the file is
// missing, unreadable, or not valid JSON — this is how we "degrade
// gracefully" instead of crashing when Karma hasn't been set up yet.
// -----------------------------------------------------------------------
function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readTextSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return fallback;
  }
}

// -----------------------------------------------------------------------
// SQLite access.
//
// Karma stores its memory (turns, tool calls, spend, heartbeat schedule,
// etc.) in a SQLite database file. We want to READ that file but never
// write to it — this server should never be able to corrupt Karma's brain.
//
// We try the "better-sqlite3" npm package first (fast, well supported).
// If it isn't installed or fails to compile (it's a "native" package that
// needs a C++ compiler), we fall back to Node 22's built-in "node:sqlite"
// module, which ships with Node itself and needs no compilation.
// -----------------------------------------------------------------------
let BetterSqlite3 = null;
try {
  const mod = await import("better-sqlite3");
  BetterSqlite3 = mod.default;
} catch {
  BetterSqlite3 = null;
}

let NodeSqliteDatabaseSync = null;
if (!BetterSqlite3) {
  try {
    const mod = await import("node:sqlite");
    NodeSqliteDatabaseSync = mod.DatabaseSync;
  } catch {
    NodeSqliteDatabaseSync = null;
  }
}

// A tiny wrapper so the rest of the code doesn't care which SQLite
// implementation is actually in use. Both libraries expose slightly
// different APIs, so we normalize to `.all(sql, params)` (returns an
// array of row objects) and `.close()`.
function openDbReadOnly() {
  if (!fs.existsSync(DB_PATH)) {
    // Karma hasn't run yet — no database file. This is expected, not an
    // error, during/right-after setup.
    return null;
  }

  try {
    if (BetterSqlite3) {
      const db = new BetterSqlite3(DB_PATH, { readonly: true, fileMustExist: true });
      return {
        all: (sql, params = []) => db.prepare(sql).all(...params),
        get: (sql, params = []) => db.prepare(sql).get(...params),
        close: () => db.close(),
      };
    }
    if (NodeSqliteDatabaseSync) {
      const db = new NodeSqliteDatabaseSync(DB_PATH, { readOnly: true });
      return {
        all: (sql, params = []) => db.prepare(sql).all(...params),
        get: (sql, params = []) => db.prepare(sql).get(...params),
        close: () => db.close(),
      };
    }
  } catch {
    // File exists but couldn't be opened (locked, corrupt, mid-write, etc.)
    return null;
  }
  return null;
}

// -----------------------------------------------------------------------
// Config loading (automaton.json). This file can contain secret fields
// like apiKey / openaiApiKey / anthropicApiKey. We read the whole file
// here (because we need some non-secret fields out of it), but nothing
// downstream is allowed to spread this object into an API response —
// every response builder below picks fields by name.
// -----------------------------------------------------------------------
function loadRawConfig() {
  return readJsonSafe(CONFIG_PATH, null);
}

// -----------------------------------------------------------------------
// Is Karma's Node process currently running? We look for the compiled
// entry point ("dist/index.js --run") in the process list with `pgrep`.
// Wrapped in try/catch (and execFile's callback error) so a missing
// `pgrep` binary or a permissions hiccup never crashes the server.
// -----------------------------------------------------------------------
function checkProcessRunning() {
  return new Promise((resolve) => {
    try {
      execFile("pgrep", ["-f", "dist/index.js --run"], (error, stdout) => {
        if (error) {
          // pgrep exits with status 1 (and calls back with an error) when
          // no matching process is found — that's a normal "not running",
          // not a real error.
          resolve(false);
          return;
        }
        resolve(stdout.trim().length > 0);
      });
    } catch {
      resolve(false);
    }
  });
}

// -----------------------------------------------------------------------
// Build the /api/status payload using an explicit allowlist of fields.
// This is the single most important function for security in this file:
// we never do `{ ...config }` anywhere near an HTTP response.
// -----------------------------------------------------------------------
function buildStatusPayload(config, processRunning) {
  const agentAlive = config !== null;

  // "setupComplete" is a slightly stronger check than "agentAlive": the
  // config file exists AND has the minimum fields a fully-set-up agent
  // needs (a name and a wallet address).
  const setupComplete = agentAlive && Boolean(config.name) && Boolean(config.walletAddress);

  // Treasury policy: numeric spending LIMITS only. We deliberately leave
  // out things like x402AllowedDomains (a list, not a limit) to keep this
  // to exactly what the spec asked for — "limits only".
  let treasuryPolicy = null;
  if (agentAlive && config.treasuryPolicy && typeof config.treasuryPolicy === "object") {
    const tp = config.treasuryPolicy;
    treasuryPolicy = {
      maxSingleTransferCents: tp.maxSingleTransferCents ?? null,
      maxHourlyTransferCents: tp.maxHourlyTransferCents ?? null,
      maxDailyTransferCents: tp.maxDailyTransferCents ?? null,
      minimumReserveCents: tp.minimumReserveCents ?? null,
      maxX402PaymentCents: tp.maxX402PaymentCents ?? null,
      maxInferenceDailyCents: tp.maxInferenceDailyCents ?? null,
      requireConfirmationAboveCents: tp.requireConfirmationAboveCents ?? null,
      maxTransfersPerTurn: tp.maxTransfersPerTurn ?? null,
      transferCooldownMs: tp.transferCooldownMs ?? null,
    };
  }

  return {
    agentAlive,
    name: agentAlive ? config.name ?? null : null,
    walletAddress: agentAlive ? config.walletAddress ?? null : null,
    creatorAddress: agentAlive ? config.creatorAddress ?? null : null,
    chainType: agentAlive ? config.chainType ?? "evm" : null,
    registeredWithConway: agentAlive ? Boolean(config.registeredWithConway) : false,
    treasuryPolicy,
    setupComplete,
    processRunning,
  };
}

// -----------------------------------------------------------------------
// In-memory rate limiter for POST /api/requests: max 10 requests per
// minute per IP address. This resets naturally because we just keep a
// rolling list of timestamps per IP and drop anything older than 60s.
// Being in-memory means it resets if the server restarts — that's fine
// for a small local tool like this.
// -----------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const requestTimestampsByIp = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestTimestampsByIp.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  timestamps.push(now);
  requestTimestampsByIp.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

// -----------------------------------------------------------------------
// requests.json helpers (storefront submissions).
// -----------------------------------------------------------------------
function readRequests() {
  const data = readJsonSafe(REQUESTS_PATH, []);
  return Array.isArray(data) ? data : [];
}

function appendRequest(entry) {
  const all = readRequests();
  all.push(entry);
  fs.writeFileSync(REQUESTS_PATH, JSON.stringify(all, null, 2), "utf-8");
}

// A very small validator: field must be a non-empty string under a
// reasonable length. Keeps garbage/huge payloads out of requests.json.
function isReasonableString(value, maxLen) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLen;
}

// -----------------------------------------------------------------------
// Express app setup.
// -----------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "20kb" })); // parses JSON request bodies
app.use(express.static(path.join(__dirname, "public"))); // serves index.html, style.css, etc.

// GET /api/status — high-level "is Karma alive" summary for the dashboard.
app.get("/api/status", async (req, res) => {
  const config = loadRawConfig();
  const processRunning = await checkProcessRunning();
  res.json(buildStatusPayload(config, processRunning));
});

// GET /api/turns — last 50 reasoning turns, newest first.
app.get("/api/turns", (req, res) => {
  const db = openDbReadOnly();
  if (!db) {
    res.json([]); // no DB yet = empty feed, not an error
    return;
  }
  try {
    const rows = db.all(
      `SELECT id, timestamp, state, input, input_source, thinking,
              tool_calls, token_usage, cost_cents, created_at
       FROM turns
       ORDER BY timestamp DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch {
    // Table might not exist yet on a brand new DB, or a read raced a write.
    res.json([]);
  } finally {
    db.close();
  }
});

// GET /api/metrics — a handful of simple aggregate numbers.
app.get("/api/metrics", (req, res) => {
  const empty = {
    totalTurns: 0,
    totalToolExecutions: 0,
    totalCostCents: 0,
    totalInferenceCostCents: 0,
    latestBalanceCents: null,
    dbFileSizeBytes: 0,
    lastActivityAt: null,
  };

  const db = openDbReadOnly();
  if (!db) {
    res.json(empty);
    return;
  }

  try {
    const totalTurns = db.get(`SELECT COUNT(*) AS c FROM turns`)?.c ?? 0;
    const totalToolExecutions = db.get(`SELECT COUNT(*) AS c FROM tool_calls`)?.c ?? 0;
    const totalCostCents = db.get(`SELECT COALESCE(SUM(cost_cents), 0) AS s FROM turns`)?.s ?? 0;

    // inference_costs table was added in a later schema migration; guard
    // it separately in case an older DB doesn't have it yet.
    let totalInferenceCostCents = 0;
    try {
      totalInferenceCostCents =
        db.get(`SELECT COALESCE(SUM(cost_cents), 0) AS s FROM inference_costs`)?.s ?? 0;
    } catch {
      totalInferenceCostCents = 0;
    }

    // Most recent transaction tells us Karma's last known balance.
    let latestBalanceCents = null;
    try {
      const lastTx = db.get(
        `SELECT balance_after_cents FROM transactions ORDER BY created_at DESC LIMIT 1`
      );
      latestBalanceCents = lastTx?.balance_after_cents ?? null;
    } catch {
      latestBalanceCents = null;
    }

    const lastActivityAt = db.get(`SELECT MAX(timestamp) AS t FROM turns`)?.t ?? null;

    let dbFileSizeBytes = 0;
    try {
      dbFileSizeBytes = fs.statSync(DB_PATH).size;
    } catch {
      dbFileSizeBytes = 0;
    }

    res.json({
      totalTurns,
      totalToolExecutions,
      totalCostCents,
      totalInferenceCostCents,
      latestBalanceCents,
      dbFileSizeBytes,
      lastActivityAt,
    });
  } catch {
    res.json(empty);
  } finally {
    db.close();
  }
});

// GET /api/soul — Karma's SOUL.md identity file, as plain markdown text.
// The frontend renders this as PREFORMATTED TEXT, never as HTML, so there
// is no injection risk even if Karma writes something odd into it.
app.get("/api/soul", (req, res) => {
  const markdown = readTextSafe(SOUL_PATH, "");
  res.json({ markdown, exists: fs.existsSync(SOUL_PATH) });
});

// GET /api/heartbeat — heartbeat.yml, returned as raw text. We keep this
// simple (no YAML parsing dependency) per the "keep it simple" stack rule.
app.get("/api/heartbeat", (req, res) => {
  const raw = readTextSafe(HEARTBEAT_PATH, "");
  res.json({ raw, exists: fs.existsSync(HEARTBEAT_PATH) });
});

// POST /api/requests — someone filled out the "Hire Karma" form.
app.post("/api/requests", (req, res) => {
  const ip = req.ip || "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ ok: false, error: "Too many requests. Please try again in a minute." });
    return;
  }

  const { name, contact, task_description } = req.body || {};

  if (!isReasonableString(name, 200)) {
    res.status(400).json({ ok: false, error: "Please provide a valid name." });
    return;
  }
  if (!isReasonableString(contact, 200)) {
    res.status(400).json({ ok: false, error: "Please provide a valid contact (email, etc)." });
    return;
  }
  if (!isReasonableString(task_description, 4000)) {
    res.status(400).json({ ok: false, error: "Please describe the task (up to 4000 characters)." });
    return;
  }

  const entry = {
    id: crypto.randomUUID(),
    name: name.trim(),
    contact: contact.trim(),
    task_description: task_description.trim(),
    created_at: new Date().toISOString(),
  };

  try {
    appendRequest(entry);
  } catch (err) {
    res.status(500).json({ ok: false, error: "Could not save your request. Please try again." });
    return;
  }

  res.json({ ok: true, id: entry.id });
});

// GET /api/requests — for the owner to review what's come in.
app.get("/api/requests", (req, res) => {
  res.json(readRequests());
});

// The "/hire" page is a real HTML file at public/hire.html. Because
// express.static already serves public/, this route is mostly here for
// clarity/robustness (works even if a request comes in as "/hire" with no
// trailing slash and static resolution has any hiccup).
app.get("/hire", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hire.html"));
});

// -----------------------------------------------------------------------
// Start the server. We bind to 127.0.0.1 ONLY (not 0.0.0.0) so this is
// reachable from this machine alone, never from the network.
// -----------------------------------------------------------------------
const PORT = 4321;
const HOST = "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`automaton-site running at http://${HOST}:${PORT}`);
  console.log(`  dashboard:  http://${HOST}:${PORT}/`);
  console.log(`  storefront: http://${HOST}:${PORT}/hire`);
});
