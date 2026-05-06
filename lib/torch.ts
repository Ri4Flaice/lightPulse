export type TorchSupport = { ok: boolean; reason: string };

export function detectTorchSupport(): TorchSupport {
  if (typeof navigator === "undefined") return { ok: false, reason: "SSR" };
  if (!navigator.mediaDevices) return { ok: false, reason: "Нет MediaDevices" };
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return { ok: false, reason: "iOS Safari" };
  if (typeof window === "undefined" || !("ImageCapture" in window)) {
    return { ok: false, reason: "Нет ImageCapture API" };
  }
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isTouch = navigator.maxTouchPoints > 0 && "ontouchstart" in window;
  if (!isAndroid || !isTouch) return { ok: false, reason: "Не мобильное устройство" };
  return { ok: true, reason: "Фонарик доступен" };
}

type TorchTrackConstraints = MediaTrackConstraintSet & { torch?: boolean };

export class TorchController {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;

  async acquire(): Promise<void> {
    if (this.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Нет видеотрека");
    }
    this.stream = stream;
    this.track = track;
  }

  async setOn(on: boolean): Promise<void> {
    if (!this.track) return;
    try {
      await this.track.applyConstraints({
        advanced: [{ torch: on } as TorchTrackConstraints],
      });
    } catch {
      // ignore — some Android devices throw on rapid toggling
    }
  }

  release(): void {
    if (this.track) {
      try {
        this.track.applyConstraints({ advanced: [{ torch: false } as TorchTrackConstraints] });
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
