import { promises as fs } from "node:fs";
import path from "node:path";
import { kv } from "@vercel/kv";
import { z } from "zod";

export const ConfigSchema = z.object({
  dotDuration: z.number().int().min(50).max(600),
  dashDuration: z.number().int().min(150).max(1500),
  symbolPause: z.number().int().min(50).max(1000),
  wordPause: z.number().int().min(100).max(2000),
  sequence: z
    .string()
    .min(1)
    .max(500)
    .regex(/^[.\-\s\/]+$/, "sequence may only contain '.', '-', '/' and spaces"),
  label: z.string().max(32),
  accent: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be hex color"),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  dotDuration: 200,
  dashDuration: 600,
  symbolPause: 300,
  wordPause: 700,
  sequence: "... --- ...",
  label: "SOS",
  accent: "#a6ff3d",
};

const CONFIG_FILE = path.join(process.cwd(), "config.json");
const KV_KEY = "lp:config";

function isKvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function readFromKv(): Promise<Config | null> {
  try {
    const raw = await kv.get<unknown>(KV_KEY);
    if (raw == null) return null;
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    const parsed = ConfigSchema.safeParse(obj);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readFromFile(): Promise<Config | null> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const parsed = ConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function readConfig(): Promise<Config> {
  if (isKvConfigured()) {
    const fromKv = await readFromKv();
    if (fromKv) return fromKv;
    // Bootstrap KV from bundled config.json on first read.
    const fromFile = await readFromFile();
    if (fromFile) {
      try {
        await kv.set(KV_KEY, JSON.stringify(fromFile));
      } catch {
        /* ignore */
      }
      return fromFile;
    }
    return DEFAULT_CONFIG;
  }
  return (await readFromFile()) ?? DEFAULT_CONFIG;
}

export async function writeConfig(cfg: unknown): Promise<Config> {
  const validated = ConfigSchema.parse(cfg);

  if (isKvConfigured()) {
    await kv.set(KV_KEY, JSON.stringify(validated));
    return validated;
  }

  // Local dev: persist to file.
  const tmp = CONFIG_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(validated, null, 2), "utf8");
  await fs.rename(tmp, CONFIG_FILE);
  return validated;
}
