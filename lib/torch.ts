export type TorchSupport = { ok: boolean; reason: string };

export function detectTorchSupport(): TorchSupport {
  if (typeof navigator === "undefined") return { ok: false, reason: "SSR" };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "Нет доступа к камере" };
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return { ok: false, reason: "iOS — экранный режим" };
  }
  const isTouch = navigator.maxTouchPoints > 0;
  if (!isTouch) return { ok: false, reason: "Десктоп — экранный режим" };
  return { ok: true, reason: "Проверка фонарика…" };
}

// ── Types ──────────────────────────────────────────────────────────────────

type TorchConstraints = MediaTrackConstraintSet & { torch?: boolean };
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

// ImageCapture.setOptions is non-standard but supported on some Android/Chrome
interface ImageCaptureWithTorch extends ImageCapture {
  setOptions?: (opts: Record<string, unknown>) => Promise<void>;
}
declare let ImageCapture: {
  new (track: MediaStreamTrack): ImageCaptureWithTorch;
} | undefined;

export class TorchError extends Error {
  constructor(
    message: string,
    public readonly code: "PERMISSION_DENIED" | "NOT_SUPPORTED" | "UNKNOWN",
    public readonly debug?: string
  ) {
    super(message);
    this.name = "TorchError";
  }
}

// ── Torch methods ──────────────────────────────────────────────────────────

type TorchMethod = "applyConstraints" | "imageCapture";

/**
 * Try to turn torch ON using both available methods.
 * Returns which method worked, or null if both failed.
 */
async function probeTorch(
  track: MediaStreamTrack
): Promise<{ method: TorchMethod; err: null } | { method: null; err: string }> {
  // Method 1: standard applyConstraints (works on most Android Chrome)
  try {
    await track.applyConstraints({ advanced: [{ torch: true } as TorchConstraints] });
    return { method: "applyConstraints", err: null };
  } catch (e1) {
    const applyErr = e1 instanceof Error ? `${e1.name}: ${e1.message}` : String(e1);

    // Method 2: ImageCapture.setOptions (fallback for Samsung S-series Android 14+)
    if (typeof ImageCapture !== "undefined") {
      try {
        const ic = new ImageCapture(track);
        await ic.setOptions?.({ torch: true });
        return { method: "imageCapture", err: null };
      } catch (e2) {
        const icErr = e2 instanceof Error ? `${e2.name}: ${e2.message}` : String(e2);
        return {
          method: null,
          err: `applyConstraints: ${applyErr}; ImageCapture: ${icErr}`,
        };
      }
    }

    return { method: null, err: `applyConstraints: ${applyErr}; ImageCapture: недоступен` };
  }
}

async function turnOff(track: MediaStreamTrack, method: TorchMethod): Promise<void> {
  if (method === "applyConstraints") {
    await track.applyConstraints({ advanced: [{ torch: false } as TorchConstraints] }).catch(() => {});
  } else {
    if (typeof ImageCapture !== "undefined") {
      try {
        const ic = new ImageCapture(track);
        await ic.setOptions?.({ torch: false });
      } catch { /* noop */ }
    }
  }
}

async function getStream(constraints: MediaTrackConstraints): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  } catch {
    return null;
  }
}

// ── TorchController ────────────────────────────────────────────────────────

export class TorchController {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private method: TorchMethod = "applyConstraints";

  async acquire(): Promise<void> {
    if (this.stream) return;

    // 1. Request camera with preferred facing
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (e) {
      const err = e as DOMException;
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        throw new TorchError("Доступ к камере отклонён", "PERMISSION_DENIED");
      }
      throw new TorchError("Не удалось открыть камеру: " + err.message, "UNKNOWN", err.name);
    }

    // 2. Try the default camera first
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new TorchError("Видеотрек недоступен", "UNKNOWN");
    }

    const caps = track.getCapabilities?.() as TorchCapabilities | undefined;
    const torchInCaps = caps?.torch;

    const probe = await probeTorch(track);
    if (probe.method !== null) {
      // Turn back off immediately — user hasn't pressed the button yet
      await turnOff(track, probe.method);
      this.stream = stream;
      this.track = track;
      this.method = probe.method;
      return;
    }

    // 3. Default camera failed — try all other cameras (multi-camera phones)
    stream.getTracks().forEach((t) => t.stop());
    const firstErr = probe.err;

    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch { /* ignore */ }

    const cameras = devices.filter((d) => d.kind === "videoinput");
    for (const cam of cameras) {
      const s = await getStream({ deviceId: { exact: cam.deviceId } });
      if (!s) continue;
      const t = s.getVideoTracks()[0];
      if (!t) { s.getTracks().forEach((x) => x.stop()); continue; }

      const p2 = await probeTorch(t);
      if (p2.method !== null) {
        await turnOff(t, p2.method);
        this.stream = s;
        this.track = t;
        this.method = p2.method;
        return;
      }
      s.getTracks().forEach((x) => x.stop());
    }

    // 4. Nothing worked
    const debug = [
      `getCapabilities().torch=${torchInCaps ?? "undefined"}`,
      `first camera: ${firstErr}`,
      `cameras found: ${cameras.length}`,
      `ImageCapture available: ${typeof ImageCapture !== "undefined"}`,
    ].join("; ");

    throw new TorchError(
      `Фонарик не поддерживается (камер: ${cameras.length}, torch в API: ${torchInCaps ?? "нет"})`,
      "NOT_SUPPORTED",
      debug
    );
  }

  async setOn(on: boolean): Promise<void> {
    if (!this.track) return;
    if (this.method === "imageCapture") {
      if (typeof ImageCapture !== "undefined") {
        try {
          const ic = new ImageCapture(this.track);
          await ic.setOptions?.({ torch: on });
        } catch { /* ignore rapid-toggling errors */ }
      }
    } else {
      try {
        await this.track.applyConstraints({
          advanced: [{ torch: on } as TorchConstraints],
        });
      } catch { /* ignore */ }
    }
  }

  release(): void {
    if (this.track) {
      turnOff(this.track, this.method).catch(() => {});
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
  }

  get acquired(): boolean {
    return this.stream !== null;
  }
}
