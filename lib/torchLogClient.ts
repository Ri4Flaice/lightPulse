import type { TorchDiagnostics } from "./torch";

const ENDPOINT = "/api/torch-log";
const LOCAL_KEY = "torch-log-pending";
const MAX_LOCAL = 5;

function loadPending(): TorchDiagnostics[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_LOCAL) : [];
  } catch {
    return [];
  }
}

function savePending(items: TorchDiagnostics[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items.slice(-MAX_LOCAL)));
  } catch {
    /* quota / disabled — ignore */
  }
}

async function postOne(diag: TorchDiagnostics): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(diag),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTorchLog(diag: TorchDiagnostics): Promise<void> {
  // Try to flush any previously failed sends first.
  const pending = loadPending();
  const stillPending: TorchDiagnostics[] = [];
  for (const p of pending) {
    const ok = await postOne(p);
    if (!ok) stillPending.push(p);
  }

  const ok = await postOne(diag);
  if (!ok) stillPending.push(diag);

  if (stillPending.length) savePending(stillPending);
  else if (pending.length) savePending([]);
}
