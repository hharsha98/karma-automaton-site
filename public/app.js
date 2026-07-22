// app.js
// -----------------------------------------------------------------------
// Dashboard logic for index.html ("/"). Plain vanilla JS, no framework.
//
// What this does, in plain English:
//   1. Every 5 seconds, fetch() a handful of JSON endpoints from our own
//      server (/api/status, /api/turns, /api/metrics, /api/soul,
//      /api/heartbeat).
//   2. Take that data and update the page's DOM (the on-screen elements)
//      to show it.
//
// SECURITY NOTE: We build all DOM content with `textContent`, never
// `innerHTML`. That means even if Karma's data contains something that
// looks like an HTML tag (e.g. a turn's "thinking" text has "<script>" in
// it), the browser will just show it as plain text instead of running it.
// This is what "escaping" / "sanitizing" means in practice.
// -----------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 5000;

// Small helper: fetch JSON and return null on any failure (network error,
// bad JSON, non-2xx status) instead of throwing. Keeps the refresh loop
// resilient — one failing endpoint should never break the whole page.
async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Removes all children from an element (used before re-rendering a list).
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Format cents (an integer) as a "$X.XX" string.
function formatCents(cents) {
  if (cents === null || cents === undefined) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

// Format an ISO-ish timestamp string into something readable, falling
// back to the raw string if it doesn't parse.
function formatTimestamp(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

// Shorten a wallet address like "0x1234...abcd" for display.
function shortenAddress(address) {
  if (!address || typeof address !== "string") return "—";
  if (address.length <= 14) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

// -----------------------------------------------------------------------
// /api/status → header (name, status pill, wallet chip)
// -----------------------------------------------------------------------
async function refreshStatus() {
  const status = await fetchJsonSafe("/api/status");

  const nameEl = document.getElementById("agent-name");
  const pillEl = document.getElementById("status-pill");
  const pillLabel = pillEl.querySelector(".label");
  const walletChip = document.getElementById("wallet-chip");
  const walletAddrEl = walletChip.querySelector(".addr");

  if (!status || !status.agentAlive) {
    nameEl.textContent = "Karma";
    pillEl.className = "status-pill unset";
    pillLabel.textContent = "not set up yet";
    walletChip.style.display = "none";
    return status;
  }

  nameEl.textContent = status.name || "Karma";

  if (status.processRunning) {
    pillEl.className = "status-pill alive";
    pillLabel.textContent = "alive";
  } else if (status.setupComplete) {
    pillEl.className = "status-pill dormant";
    pillLabel.textContent = "dormant";
  } else {
    pillEl.className = "status-pill unset";
    pillLabel.textContent = "not set up yet";
  }

  if (status.walletAddress) {
    walletChip.style.display = "inline-flex";
    walletAddrEl.textContent = shortenAddress(status.walletAddress);
    walletChip.dataset.fullAddress = status.walletAddress;
  } else {
    walletChip.style.display = "none";
  }

  return status;
}

// Click-to-copy handler for the wallet chip.
function setupWalletCopy() {
  const walletChip = document.getElementById("wallet-chip");
  walletChip.addEventListener("click", async () => {
    const full = walletChip.dataset.fullAddress;
    if (!full) return;
    try {
      await navigator.clipboard.writeText(full);
      const hint = walletChip.querySelector(".copy-hint");
      const original = hint.textContent;
      hint.textContent = "copied!";
      setTimeout(() => {
        hint.textContent = original;
      }, 1500);
    } catch {
      // Clipboard API might be blocked (e.g. insecure context) — silently
      // ignore, the user can still select the text manually.
    }
  });
}

// -----------------------------------------------------------------------
// /api/metrics → balance card + metrics tiles
// -----------------------------------------------------------------------
async function refreshMetrics() {
  const metrics = await fetchJsonSafe("/api/metrics");

  const balanceValueEl = document.getElementById("balance-value");
  const balanceSubEl = document.getElementById("balance-sub");
  const dryRunBadge = document.getElementById("dry-run-badge");

  if (!metrics || metrics.latestBalanceCents === null || metrics.latestBalanceCents === undefined) {
    balanceValueEl.textContent = "$0.00";
    balanceSubEl.textContent = "no transactions recorded yet";
    dryRunBadge.style.display = "inline-block";
  } else {
    balanceValueEl.textContent = formatCents(metrics.latestBalanceCents);
    balanceSubEl.textContent = "last known balance";
    dryRunBadge.style.display = "none";
  }

  const tiles = [
    { label: "Total turns", value: metrics?.totalTurns ?? 0 },
    { label: "Tool executions", value: metrics?.totalToolExecutions ?? 0 },
    { label: "Total spend", value: formatCents(metrics?.totalCostCents ?? 0) },
    { label: "Inference cost", value: formatCents(metrics?.totalInferenceCostCents ?? 0) },
    { label: "DB size (KB)", value: Math.round((metrics?.dbFileSizeBytes ?? 0) / 1024) },
  ];

  const tilesEl = document.getElementById("metrics-tiles");
  clearChildren(tilesEl);
  for (const tile of tiles) {
    const tileEl = document.createElement("div");
    tileEl.className = "metric-tile";

    const valueEl = document.createElement("div");
    valueEl.className = "value";
    valueEl.textContent = String(tile.value);

    const labelEl = document.createElement("div");
    labelEl.className = "label";
    labelEl.textContent = tile.label;

    tileEl.appendChild(valueEl);
    tileEl.appendChild(labelEl);
    tilesEl.appendChild(tileEl);
  }

  const lastActivityEl = document.getElementById("last-activity");
  lastActivityEl.textContent = metrics?.lastActivityAt
    ? `Last activity: ${formatTimestamp(metrics.lastActivityAt)}`
    : "Last activity: —";
}

// -----------------------------------------------------------------------
// /api/turns → recent turns feed
// -----------------------------------------------------------------------
async function refreshTurns() {
  const turns = await fetchJsonSafe("/api/turns");
  const feedEl = document.getElementById("turns-feed");
  clearChildren(feedEl);

  if (!turns || turns.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Karma isn't awake yet — no turns recorded.";
    feedEl.appendChild(empty);
    return;
  }

  for (const turn of turns) {
    const item = document.createElement("div");
    item.className = "turn-item";

    const meta = document.createElement("div");
    meta.className = "turn-meta";

    const stateSpan = document.createElement("span");
    stateSpan.className = "turn-state";
    stateSpan.textContent = turn.state || "unknown";

    const timeSpan = document.createElement("span");
    timeSpan.textContent = formatTimestamp(turn.timestamp || turn.created_at);

    meta.appendChild(stateSpan);
    meta.appendChild(timeSpan);

    const thinking = document.createElement("div");
    thinking.className = "turn-thinking";
    // textContent (not innerHTML) — safe even if "thinking" contains
    // HTML-looking text.
    thinking.textContent = turn.thinking || "(no thinking recorded)";

    item.appendChild(meta);
    item.appendChild(thinking);
    feedEl.appendChild(item);
  }
}

// -----------------------------------------------------------------------
// /api/soul → SOUL.md viewer (rendered as plain preformatted text)
// -----------------------------------------------------------------------
async function refreshSoul() {
  const soul = await fetchJsonSafe("/api/soul");
  const soulEl = document.getElementById("soul-text");

  if (!soul || !soul.exists || !soul.markdown) {
    soulEl.textContent = "Karma isn't awake yet — no SOUL.md found.";
    return;
  }
  // Plain text rendering, on purpose — SOUL.md is markdown, but we don't
  // want to parse/render it as HTML (that would be an injection risk).
  soulEl.textContent = soul.markdown;
}

// -----------------------------------------------------------------------
// /api/heartbeat → scheduled tasks
// -----------------------------------------------------------------------
async function refreshHeartbeat() {
  const heartbeat = await fetchJsonSafe("/api/heartbeat");
  const el = document.getElementById("heartbeat-text");

  if (!heartbeat || !heartbeat.exists || !heartbeat.raw) {
    el.textContent = "Karma isn't awake yet — no heartbeat.yml found.";
    return;
  }
  el.textContent = heartbeat.raw;
}

// -----------------------------------------------------------------------
// Refresh loop
// -----------------------------------------------------------------------
async function refreshAll() {
  await Promise.all([
    refreshStatus(),
    refreshMetrics(),
    refreshTurns(),
    refreshSoul(),
    refreshHeartbeat(),
  ]);

  const lastUpdatedEl = document.getElementById("last-updated");
  lastUpdatedEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

function init() {
  setupWalletCopy();
  refreshAll();
  setInterval(refreshAll, REFRESH_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", init);
