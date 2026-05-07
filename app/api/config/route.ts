import { NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/config";
import { isAuthed } from "@/lib/auth";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await readConfig();
  return NextResponse.json(cfg);
}

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const saved = await writeConfig(body);
    return NextResponse.json(saved);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "validation", issues: e.issues },
        { status: 400 }
      );
    }
    const msg = e instanceof Error ? e.message : "write failed";
    console.error("[/api/config] write failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
