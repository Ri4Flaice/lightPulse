import { NextResponse } from "next/server";
import { getBroadcastState } from "@/lib/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getBroadcastState();
  return NextResponse.json(state, {
    headers: { "cache-control": "no-store" },
  });
}
