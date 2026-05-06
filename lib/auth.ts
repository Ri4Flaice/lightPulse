import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "lp_admin";
const TTL_SECONDS = 60 * 60 * 24;

function getSecret(): string {
  const s = process.env.ADMIN_COOKIE_SECRET;
  if (!s || s.length < 16) {
    throw new Error("ADMIN_COOKIE_SECRET is not set or too short");
  }
  return s;
}

function getPassword(): string {
  const p = process.env.ADMIN_PASSWORD;
  if (!p) throw new Error("ADMIN_PASSWORD is not set");
  return p;
}

export function verifyPassword(input: string): boolean {
  const expected = Buffer.from(getPassword());
  const actual = Buffer.from(input ?? "");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function sign(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function makeToken(): string {
  const expires = Date.now() + TTL_SECONDS * 1000;
  const payload = `v1.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [v, expStr, sig] = parts;
  if (v !== "v1") return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = sign(`${v}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  return verifyToken(c.get(COOKIE_NAME)?.value);
}

export const COOKIE = {
  NAME: COOKIE_NAME,
  TTL: TTL_SECONDS,
};
