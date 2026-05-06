import { NextResponse, type NextRequest } from "next/server";

const RAW_ADMIN_PATH = process.env.ADMIN_PATH || "/admin";

function normalize(p: string): string {
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

const ADMIN_PATH = normalize(RAW_ADMIN_PATH);
const INTERNAL_PATH = "/admin";
const IS_CUSTOM = ADMIN_PATH !== INTERNAL_PATH;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Custom admin path: rewrite to internal /admin
  if (IS_CUSTOM && (pathname === ADMIN_PATH || pathname.startsWith(ADMIN_PATH + "/"))) {
    const url = req.nextUrl.clone();
    url.pathname = INTERNAL_PATH + pathname.slice(ADMIN_PATH.length);
    return NextResponse.rewrite(url);
  }

  // 2. Block direct access to /admin when a custom path is configured
  if (IS_CUSTOM && (pathname === INTERNAL_PATH || pathname.startsWith(INTERNAL_PATH + "/"))) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
