export type TorchSupport = { ok: boolean; reason: string };

/**
 * Pre-flight check before requesting camera.
 * Deliberately permissive — actual torch capability is verified in TorchController.acquire()
 * via track.getCapabilities(). Removed ImageCapture and Android-only restrictions since
 * many non-Chrome Android browsers still support the torch constraint.
 */
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

export class TorchError extends Error {
  constructor(
    message: string,
    public readonly code: "PERMISSION_DENIED" | "NOT_SUPPORTED" | "UNKNOWN"
  ) {
    super(message);
    this.name = "TorchError";
  }
}

export class TorchController {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;

  async acquire(): Promise<void> {
    if (this.stream) return;

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
      throw new TorchError("Не удалось открыть камеру: " + err.message, "UNKNOWN");
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new TorchError("Видеотрек недоступен", "UNKNOWN");
    }

    // Check real torch capability via getCapabilities()
    const capabilities = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    if (capabilities && capabilities.torch === false) {
      stream.getTracks().forEach((t) => t.stop());
      throw new TorchError("Фонарик не поддерживается на этом устройстве", "NOT_SUPPORTED");
    }

    // Verify torch actually works with a test applyConstraints
    if (capabilities?.torch !== true) {
      // Capabilities might not have torch listed — try anyway
      try {
        await track.applyConstraints({ advanced: [{ torch: false } as TorchConstraints] });
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        throw new TorchError("Фонарик не поддерживается на этом устройстве", "NOT_SUPPORTED");
      }
    }

    this.stream = stream;
    this.track = track;
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
      } catch {
        /* noop */
      }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
  }

  get acquired(): boolean {
    return this.stream !== null;
  }
}
