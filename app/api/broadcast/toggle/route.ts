import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { toggleBroadcast } from "@/lib/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const next = await toggleBroadcast();
    return NextResponse.json(next);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "broadcast failed";
    console.error("[/api/broadcast/toggle] failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
