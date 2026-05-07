import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import {
  appendTorchLog,
  clearTorchLog,
  MAX_RECORD_BYTES,
  readTorchLog,
  readTorchLogRaw,
  TorchDiagnosticsSchema,
  type TorchLogEntry,
} from "@/lib/torchLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// In-memory rate limit: ipHash → last accepted timestamp (ms)
const RATE_LIMIT_MS = 2000;
const lastByIp = new Map<string, number>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function hashIp(ip: string): string {
  const secret = process.env.ADMIN_COOKIE_SECRET ?? "lp-fallback";
  return crypto.createHmac("sha256", secret).update(ip).digest("hex").slice(0, 12);
}

export async function POST(req: Request) {
  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (body.length > MAX_RECORD_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const ip = clientIp(req);
  const ipHash = hashIp(ip);
  const now = Date.now();
  const last = lastByIp.get(ipHash) ?? 0;
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const validated = TorchDiagnosticsSchema.safeParse(parsedJson);
  if (!validated.success) {
    return NextResponse.json({ error: "validation failed" }, { status: 400 });
  }

  const entry: TorchLogEntry = {
    ...validated.data,
    serverTs: new Date().toISOString(),
    ipHash,
  };

  try {
    await appendTorchLog(entry);
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
  lastByIp.set(ipHash, now);

  // Periodic cleanup of stale rate-limit entries
  if (lastByIp.size > 5000) {
    const cutoff = now - 60 * 1000;
    for (const [k, v] of lastByIp) if (v < cutoff) lastByIp.delete(k);
  }

  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get("format") === "raw") {
    const raw = await readTorchLogRaw();
    return new NextResponse(raw, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": 'attachment; filename="torch-log.jsonl"',
      },
    });
  }
  const limitStr = url.searchParams.get("limit");
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 200, 1), 1000) : 200;
  const entries = await readTorchLog(limit);
  return NextResponse.json({ entries });
}

export async function DELETE() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await clearTorchLog();
  return NextResponse.json({ ok: true });
}
