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

type TorchConstraints = MediaTrackConstraintSet & { torch?: boolean };
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

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

/** Try to turn torch ON via applyConstraints. Returns null on success, error string on fail. */
async function tryTorchOn(track: MediaStreamTrack): Promise<string | null> {
  try {
    await track.applyConstraints({ advanced: [{ torch: true } as TorchConstraints] });
    return null;
  } catch (e) {
    return e instanceof Error ? e.name + ": " + e.message : String(e);
  }
}

/** Get camera stream with given constraints, return null if fails. */
async function getStream(constraints: MediaTrackConstraints): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  } catch {
    return null;
  }
}

export class TorchController {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;

  async acquire(): Promise<void> {
    if (this.stream) return;

    // 1. Request camera permission first with ideal environment facing
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

    // 2. Try this camera first
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new TorchError("Видеотрек недоступен", "UNKNOWN");
    }

    const caps = track.getCapabilities?.() as TorchCapabilities | undefined;
    const torchInCaps = caps?.torch;
    const applyErr = await tryTorchOn(track);

    // 3. If this camera works — turn it back off and save
    if (applyErr === null) {
      await track.applyConstraints({ advanced: [{ torch: false } as TorchConstraints] }).catch(() => {});
      this.stream = stream;
      this.track = track;
      return;
    }

    // 4. This camera failed — try other rear cameras (multi-camera phones)
    stream.getTracks().forEach((t) => t.stop());

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
      const err2 = await tryTorchOn(t);
      if (err2 === null) {
        await t.applyConstraints({ advanced: [{ torch: false } as TorchConstraints] }).catch(() => {});
        this.stream = s;
        this.track = t;
        return;
      }
      s.getTracks().forEach((x) => x.stop());
    }

    // 5. No camera with working torch found — build diagnostic message
    const camCount = cameras.length;
    const debug = [
      `getCapabilities().torch=${torchInCaps ?? "undefined"}`,
      `applyConstraints error: ${applyErr}`,
      `cameras found: ${camCount}`,
    ].join("; ");

    throw new TorchError(
      `Фонарик не поддерживается (камер: ${camCount}, torch в API: ${torchInCaps ?? "нет"})`,
      "NOT_SUPPORTED",
      debug
    );
  }

  async setOn(on: boolean): Promise<void> {
    if (!this.track) return;
    try {
      await this.track.applyConstraints({
        advanced: [{ torch: on } as TorchConstraints],
      });
    } catch {
      // Ignore rapid-toggling errors on some devices
    }
  }

  release(): void {
    if (this.track) {
      try {
        this.track.applyConstraints({ advanced: [{ torch: false } as TorchConstraints] });
      } catch { /* noop */ }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
  }

  get acquired(): boolean {
    return this.stream !== null;
  }
}
