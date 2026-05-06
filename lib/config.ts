import { promises as fs } from "node:fs";
import path from "node:path";
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

export async function readConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const parsed = ConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    return DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function writeConfig(cfg: unknown): Promise<Config> {
  const validated = ConfigSchema.parse(cfg);
  const tmp = CONFIG_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(validated, null, 2), "utf8");
  await fs.rename(tmp, CONFIG_FILE);
  return validated;
}
