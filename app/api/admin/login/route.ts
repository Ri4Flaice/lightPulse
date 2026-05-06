import { NextResponse } from "next/server";
import { COOKIE, makeToken, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    if (!body.password || !verifyPassword(body.password)) {
      return NextResponse.json({ error: "invalid password" }, { status: 401 });
    }
    const token = makeToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE.NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE.TTL,
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server error" },
      { status: 500 }
    );
  }
}
