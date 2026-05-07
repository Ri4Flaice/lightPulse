import { kv } from "@vercel/kv";
import { z } from "zod";

const LIST_KEY = "torch:log";
const MAX_ENTRIES = 1000;
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

export type TorchDiagnostics = z.infer<typeof TorchDiagnosticsSchema>;

export type TorchLogEntry = TorchDiagnostics & {
  serverTs: string;
  ipHash: string;
};

const ServerEntrySchema = TorchDiagnosticsSchema.extend({
  serverTs: z.string(),
  ipHash: z.string(),
});

function isKvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export function kvStatus(): { configured: boolean } {
  return { configured: isKvConfigured() };
}

export async function appendTorchLog(entry: TorchLogEntry): Promise<void> {
  if (!isKvConfigured()) {
    // No-op locally without Vercel KV configured. Logs simply won't persist.
    return;
  }
  // LPUSH puts newest at index 0; LTRIM keeps the first N (= newest N).
  await kv.lpush(LIST_KEY, JSON.stringify(entry));
  await kv.ltrim(LIST_KEY, 0, MAX_ENTRIES - 1);
}

export async function readTorchLog(limit = 200): Promise<TorchLogEntry[]> {
  if (!isKvConfigured()) return [];
  const cap = Math.min(Math.max(limit, 1), MAX_ENTRIES);
  // Newest-first because LPUSH inserts at head.
  const items = (await kv.lrange(LIST_KEY, 0, cap - 1)) as unknown[];
  const out: TorchLogEntry[] = [];
  for (const item of items) {
    try {
      const obj = typeof item === "string" ? JSON.parse(item) : item;
      const parsed = ServerEntrySchema.safeParse(obj);
      if (parsed.success) out.push(parsed.data);
    } catch {
      /* skip malformed entry */
    }
  }
  return out;
}

export async function readTorchLogRaw(): Promise<string> {
  const entries = await readTorchLog(MAX_ENTRIES);
  // Output as JSONL, oldest-first (more natural for log files).
  return entries
    .slice()
    .reverse()
    .map((e) => JSON.stringify(e))
    .join("\n");
}

export async function clearTorchLog(): Promise<void> {
  if (!isKvConfigured()) return;
  await kv.del(LIST_KEY);
}
