import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const LOG_DIR = path.join(process.cwd(), "data");
const LOG_FILE = path.join(LOG_DIR, "torch-log.jsonl");
const MAX_LINES = 1000;
export const MAX_RECORD_BYTES = 8 * 1024;

const MethodResultSchema = z.object({
  method: z.string().max(40),
  ok: z.boolean(),
  errorName: z.string().max(120).optional(),
  errorMessage: z.string().max(400).optional(),
  settingsTorchAfter: z.union([z.boolean(), z.literal("undefined")]).optional(),
});

const AttemptSchema = z.object({
  cameraLabel: z.string().max(200),
  cameraId: z.string().max(200),
  facingMode: z.string().max(40).optional(),
  capabilitiesTorch: z.union([z.boolean(), z.literal("undefined")]),
  capabilitiesJson: z.string().max(2000),
  settingsJson: z.string().max(2000),
  methods: z.array(MethodResultSchema).max(10),
});

const SecuritySchema = z.object({
  isSecureContext: z.boolean(),
  protocol: z.string().max(20),
  permissionsApiState: z.enum(["granted", "denied", "prompt", "unknown"]),
  permissionsPolicyCamera: z.union([z.boolean(), z.literal("unknown")]),
  displayMode: z.enum(["browser", "standalone", "minimal-ui", "fullscreen", "unknown"]),
  visibilityState: z.enum(["visible", "hidden"]),
  inIframe: z.boolean(),
});

export const TorchDiagnosticsSchema = z.object({
  ts: z.string().max(40),
  userAgent: z.string().max(500),
  platform: z.string().max(100),
  hasMediaDevices: z.boolean(),
  hasImageCapture: z.boolean(),
  security: SecuritySchema,
  outcome: z.enum(["success", "permission_denied", "no_torch", "no_camera", "error"]),
  successMethod: z.string().max(40).optional(),
  successCameraLabel: z.string().max(200).optional(),
  attempts: z.array(AttemptSchema).max(20),
  topLevelErrorName: z.string().max(120).optional(),
  topLevelErrorMessage: z.string().max(400).optional(),
  durationMs: z.number().int().nonnegative().max(60_000),
});

export type TorchLogEntry = z.infer<typeof TorchDiagnosticsSchema> & {
  serverTs: string;
  ipHash: string;
};

const ServerEntrySchema = TorchDiagnosticsSchema.extend({
  serverTs: z.string(),
  ipHash: z.string(),
});

async function ensureDir(): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

export async function appendTorchLog(entry: TorchLogEntry): Promise<void> {
  await ensureDir();
  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(LOG_FILE, line, "utf8");

  // Lazy rotation: every ~50 writes, check size and trim
  if (Math.random() < 0.02) {
    await rotateIfNeeded();
  }
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length > MAX_LINES) {
      const trimmed = lines.slice(-MAX_LINES).join("\n") + "\n";
      const tmp = LOG_FILE + ".tmp";
      await fs.writeFile(tmp, trimmed, "utf8");
      await fs.rename(tmp, LOG_FILE);
    }
  } catch {
    /* ignore */
  }
}

export async function readTorchLog(limit = 200): Promise<TorchLogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const tail = lines.slice(-limit);
    const out: TorchLogEntry[] = [];
    for (const line of tail) {
      try {
        const parsed = ServerEntrySchema.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* skip malformed line */
      }
    }
    return out.reverse(); // newest first
  } catch {
    return [];
  }
}

export async function readTorchLogRaw(): Promise<string> {
  try {
    return await fs.readFile(LOG_FILE, "utf8");
  } catch {
    return "";
  }
}

export async function clearTorchLog(): Promise<void> {
  try {
    await fs.writeFile(LOG_FILE, "", "utf8");
  } catch {
    /* ignore */
  }
}
