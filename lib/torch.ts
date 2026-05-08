export type TorchSupport = { ok: boolean; reason: string };

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ Safari spoofs UA as macOS — distinguish by touch points
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export function detectTorchSupport(): TorchSupport {
  if (typeof navigator === "undefined") return { ok: false, reason: "SSR" };
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return { ok: false, reason: "Требуется HTTPS — экранный режим" };
  }
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "Нет доступа к камере" };
  if (!isIOS() && navigator.maxTouchPoints === 0) {
    return { ok: false, reason: "Десктоп — экранный режим" };
  }
  return { ok: true, reason: "Проверка фонарика…" };
}

// ── Types ──────────────────────────────────────────────────────────────────

type TorchConstraints = MediaTrackConstraintSet & { torch?: boolean };
type TorchSettings = MediaTrackSettings & { torch?: boolean };
type TorchCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  focusMode?: string[];
  exposureMode?: string[];
};

interface ImageCaptureExt extends ImageCapture {
  setOptions?: (opts: Record<string, unknown>) => Promise<void>;
}
declare let ImageCapture: { new (track: MediaStreamTrack): ImageCaptureExt } | undefined;

export type TorchMethod =
  | "gumTorch"
  | "applyConstraints"
  | "applyConstraintsFlat"
  | "applyConstraintsRetry"
  | "imageCapture";

export type MethodResult = {
  method: TorchMethod;
  ok: boolean;
  errorName?: string;
  errorMessage?: string;
  settingsTorchAfter?: boolean | "undefined";
};

export type TorchAttempt = {
  cameraLabel: string;
  cameraId: string;
  facingMode?: string;
  capabilitiesTorch: boolean | "undefined";
  capabilitiesJson: string;
  settingsJson: string;
  methods: MethodResult[];
};

export type SecurityInfo = {
  isSecureContext: boolean;
  protocol: string;
  permissionsApiState: "granted" | "denied" | "prompt" | "unknown";
  permissionsPolicyCamera: boolean | "unknown";
  displayMode: "browser" | "standalone" | "minimal-ui" | "fullscreen" | "unknown";
  visibilityState: "visible" | "hidden";
  inIframe: boolean;
};

export type TorchOutcome =
  | "success"
  | "permission_denied"
  | "no_torch"
  | "no_camera"
  | "error";

export type TorchDiagnostics = {
  ts: string;
  userAgent: string;
  platform: string;
  hasMediaDevices: boolean;
  hasImageCapture: boolean;
  security: SecurityInfo;
  outcome: TorchOutcome;
  successMethod?: TorchMethod;
  successCameraLabel?: string;
  attempts: TorchAttempt[];
  topLevelErrorName?: string;
  topLevelErrorMessage?: string;
  durationMs: number;
};

export class TorchError extends Error {
  constructor(
    message: string,
    public readonly code: "PERMISSION_DENIED" | "NOT_SUPPORTED" | "UNKNOWN",
    public readonly diagnostics: TorchDiagnostics
  ) {
    super(message);
    this.name = "TorchError";
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "{}";
  }
}

function readSettingsTorch(track: MediaStreamTrack): boolean | "undefined" {
  try {
    const s = track.getSettings() as TorchSettings;
    return typeof s.torch === "boolean" ? s.torch : "undefined";
  } catch {
    return "undefined";
  }
}

async function gatherSecurityInfo(): Promise<SecurityInfo> {
  const protocol = typeof location !== "undefined" ? location.protocol : "";
  let permState: SecurityInfo["permissionsApiState"] = "unknown";
  try {
    const p = await navigator.permissions?.query?.({ name: "camera" as PermissionName });
    if (p?.state === "granted" || p?.state === "denied" || p?.state === "prompt") {
      permState = p.state;
    }
  } catch {
    /* not supported */
  }

  let policyCamera: boolean | "unknown" = "unknown";
  try {
    const fp = (document as unknown as { featurePolicy?: { allowsFeature: (s: string) => boolean } })
      .featurePolicy;
    if (fp?.allowsFeature) policyCamera = fp.allowsFeature("camera");
  } catch {
    /* ignore */
  }

  let displayMode: SecurityInfo["displayMode"] = "unknown";
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) displayMode = "standalone";
    else if (window.matchMedia("(display-mode: fullscreen)").matches) displayMode = "fullscreen";
    else if (window.matchMedia("(display-mode: minimal-ui)").matches) displayMode = "minimal-ui";
    else displayMode = "browser";
  } catch {
    /* ignore */
  }

  let inIframe = false;
  try {
    inIframe = window.top !== window.self;
  } catch {
    inIframe = true; // cross-origin frame access throws
  }

  return {
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
    protocol,
    permissionsApiState: permState,
    permissionsPolicyCamera: policyCamera,
    displayMode,
    visibilityState: typeof document !== "undefined" ? (document.visibilityState as "visible" | "hidden") : "visible",
    inIframe,
  };
}

// ── UA-based method ordering ───────────────────────────────────────────────

function pickMethodOrder(ua: string): TorchMethod[] {
  // Safari/iOS supports only advanced applyConstraints; ImageCapture, flat torch
  // and gumTorch are not implemented in WebKit.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile|Touch/i.test(ua))) {
    return ["applyConstraints", "applyConstraintsRetry"];
  }
  if (/SamsungBrowser\//i.test(ua)) {
    return ["applyConstraintsFlat", "applyConstraints", "applyConstraintsRetry", "imageCapture"];
  }
  // Chrome/Chromium on Android (CameraX path) ≥ 115
  const chromeMatch = ua.match(/Chrom(?:e|ium)\/(\d+)/i);
  const isAndroid = /Android/i.test(ua);
  if (isAndroid && chromeMatch && Number(chromeMatch[1]) >= 115) {
    return ["applyConstraints", "applyConstraintsRetry", "applyConstraintsFlat", "imageCapture", "gumTorch"];
  }
  return ["gumTorch", "applyConstraints", "applyConstraintsFlat", "applyConstraintsRetry", "imageCapture"];
}

// ── Method probing ─────────────────────────────────────────────────────────

async function tryMethod(track: MediaStreamTrack, method: TorchMethod): Promise<MethodResult> {
  try {
    if (method === "applyConstraints") {
      await track.applyConstraints({ advanced: [{ torch: true } as TorchConstraints] });
      await new Promise<void>((r) => setTimeout(r, 80));
      const settingsTorchAfter = readSettingsTorch(track);
      return { method, ok: settingsTorchAfter === true, settingsTorchAfter };
    }

    if (method === "applyConstraintsFlat") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (track.applyConstraints as (c: any) => Promise<void>)({ torch: true });
      await new Promise<void>((r) => setTimeout(r, 80));
      const settingsTorchAfter = readSettingsTorch(track);
      return { method, ok: settingsTorchAfter === true, settingsTorchAfter };
    }

    if (method === "applyConstraintsRetry") {
      // Pixel/S24 workaround: lock focus/exposure first, then enable torch
      const caps = (track.getCapabilities?.() ?? {}) as TorchCapabilities;
      const advancedPre: MediaTrackConstraintSet[] = [];
      if (caps.focusMode?.includes("manual")) {
        advancedPre.push({ focusMode: "manual" } as MediaTrackConstraintSet);
      } else if (caps.focusMode?.includes("continuous")) {
        advancedPre.push({ focusMode: "continuous" } as MediaTrackConstraintSet);
      }
      if (caps.exposureMode?.includes("manual")) {
        advancedPre.push({ exposureMode: "manual" } as MediaTrackConstraintSet);
      } else if (caps.exposureMode?.includes("continuous")) {
        advancedPre.push({ exposureMode: "continuous" } as MediaTrackConstraintSet);
      }
      if (advancedPre.length) {
        try {
          await track.applyConstraints({ advanced: advancedPre });
        } catch {
          /* not fatal */
        }
      }
      await track.applyConstraints({ advanced: [{ torch: true } as TorchConstraints] });
      await new Promise<void>((r) => setTimeout(r, 150));
      const settingsTorchAfter = readSettingsTorch(track);
      return { method, ok: settingsTorchAfter === true, settingsTorchAfter };
    }

    if (method === "imageCapture") {
      if (typeof ImageCapture === "undefined") {
        return { method, ok: false, errorName: "ImageCaptureUnavailable" };
      }
      const ic = new ImageCapture(track);
      if (!ic.setOptions) return { method, ok: false, errorName: "SetOptionsUnavailable" };
      await ic.setOptions({ torch: true });
      await new Promise<void>((r) => setTimeout(r, 250));
      const settingsTorchAfter = readSettingsTorch(track);
      return { method, ok: settingsTorchAfter === true, settingsTorchAfter };
    }

    return { method, ok: false, errorName: "UnknownMethod" };
  } catch (e) {
    const err = e as DOMException & { name?: string; message?: string };
    return {
      method,
      ok: false,
      errorName: err?.name ?? "Error",
      errorMessage: err?.message ?? String(e),
      settingsTorchAfter: readSettingsTorch(track),
    };
  }
}

async function setTrackTorch(track: MediaStreamTrack, method: TorchMethod, on: boolean): Promise<void> {
  try {
    if (method === "applyConstraints" || method === "applyConstraintsRetry") {
      await track.applyConstraints({ advanced: [{ torch: on } as TorchConstraints] });
    } else if (method === "applyConstraintsFlat") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (track.applyConstraints as (c: any) => Promise<void>)({ torch: on });
    } else if (method === "imageCapture" && typeof ImageCapture !== "undefined") {
      const ic = new ImageCapture(track);
      await ic.setOptions?.({ torch: on });
    } else if (method === "gumTorch") {
      // gumTorch sets torch via initial getUserMedia constraints; subsequent toggles
      // use applyConstraints on the same track.
      await track.applyConstraints({ advanced: [{ torch: on } as TorchConstraints] });
    }
  } catch {
    /* ignore rapid-toggle errors */
  }
}

async function probeTrack(
  track: MediaStreamTrack,
  order: TorchMethod[]
): Promise<{ winning: TorchMethod | null; results: MethodResult[] }> {
  const results: MethodResult[] = [];
  for (const method of order) {
    if (method === "gumTorch") continue; // gumTorch is a getUserMedia strategy, handled separately
    const r = await tryMethod(track, method);
    results.push(r);
    if (r.ok) {
      return { winning: method, results };
    }
  }
  return { winning: null, results };
}

// ── Live preview helper (CameraX needs active preview to apply torch) ──────

function attachPreview(stream: MediaStream): { video: HTMLVideoElement; ready: Promise<void> } {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "");
  video.style.cssText =
    "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px";
  document.body.appendChild(video);

  const ready = new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const t = setTimeout(finish, 2000);
    video.onloadedmetadata = () => {
      video.play().then(finish, finish);
      clearTimeout(t);
      // small extra wait so CameraX pipeline is fully running
      setTimeout(finish, 250);
    };
    video.onerror = () => finish();
  });

  return { video, ready };
}

function detachPreview(video: HTMLVideoElement | null): void {
  if (!video) return;
  try {
    video.pause();
    video.srcObject = null;
    video.remove();
  } catch {
    /* ignore */
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

const EMPTY_DIAG: TorchDiagnostics = {
  ts: "",
  userAgent: "",
  platform: "",
  hasMediaDevices: false,
  hasImageCapture: false,
  security: {
    isSecureContext: false,
    protocol: "",
    permissionsApiState: "unknown",
    permissionsPolicyCamera: "unknown",
    displayMode: "unknown",
    visibilityState: "visible",
    inIframe: false,
  },
  outcome: "error",
  attempts: [],
  durationMs: 0,
};

export class TorchController {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private method: TorchMethod = "applyConstraints";
  private previewVideo: HTMLVideoElement | null = null;
  private _diagnostics: TorchDiagnostics = { ...EMPTY_DIAG };

  get diagnostics(): TorchDiagnostics {
    return this._diagnostics;
  }

  get acquired(): boolean {
    return this.stream !== null;
  }

  async acquire(): Promise<void> {
    if (this.stream) return;

    const t0 = Date.now();
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const security = await gatherSecurityInfo();

    const diag: TorchDiagnostics = {
      ts: new Date().toISOString(),
      userAgent: ua,
      platform: typeof navigator !== "undefined" ? navigator.platform : "",
      hasMediaDevices: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
      hasImageCapture: typeof ImageCapture !== "undefined",
      security,
      outcome: "error",
      attempts: [],
      durationMs: 0,
    };
    this._diagnostics = diag;

    // Pre-flight bail-outs
    if (!security.isSecureContext) {
      diag.outcome = "no_camera";
      diag.topLevelErrorName = "InsecureContext";
      diag.topLevelErrorMessage = "Требуется HTTPS";
      diag.durationMs = Date.now() - t0;
      throw new TorchError("Требуется HTTPS", "NOT_SUPPORTED", diag);
    }
    if (security.permissionsApiState === "denied") {
      diag.outcome = "permission_denied";
      diag.topLevelErrorName = "PermissionsAPIDenied";
      diag.durationMs = Date.now() - t0;
      throw new TorchError("Доступ к камере отклонён", "PERMISSION_DENIED", diag);
    }
    if (security.inIframe && security.permissionsPolicyCamera === false) {
      diag.outcome = "no_camera";
      diag.topLevelErrorName = "PermissionsPolicyBlocked";
      diag.topLevelErrorMessage = "Камера заблокирована политикой";
      diag.durationMs = Date.now() - t0;
      throw new TorchError("Камера заблокирована политикой страницы", "NOT_SUPPORTED", diag);
    }
    if (!diag.hasMediaDevices) {
      diag.outcome = "no_camera";
      diag.topLevelErrorName = "NoMediaDevices";
      diag.durationMs = Date.now() - t0;
      throw new TorchError("Нет доступа к камере", "NOT_SUPPORTED", diag);
    }

    const order = pickMethodOrder(ua);

    // 1. Try gumTorch first if it's in the order before any other method
    if (order[0] === "gumTorch") {
      const r = await this.tryGumTorch(diag);
      if (r) {
        diag.outcome = "success";
        diag.successMethod = "gumTorch";
        diag.successCameraLabel = this.track?.label ?? "";
        diag.durationMs = Date.now() - t0;
        return;
      }
    }

    // 2. Standard path: getUserMedia(environment) → live preview → probe
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (e) {
      const err = e as DOMException;
      diag.topLevelErrorName = err.name;
      diag.topLevelErrorMessage = err.message;
      diag.durationMs = Date.now() - t0;
      const code = mapErrorToCode(err.name);
      diag.outcome =
        code === "PERMISSION_DENIED" ? "permission_denied" : code === "NOT_SUPPORTED" ? "no_camera" : "error";
      throw new TorchError(humanError(err.name, err.message), code, diag);
    }

    const winning = await this.probeStream(stream, order, diag);
    if (winning) {
      // Preview stays attached; torch confirmed; turn off until user starts
      await setTrackTorch(this.track!, this.method, false);
      diag.outcome = "success";
      diag.successMethod = this.method;
      diag.successCameraLabel = this.track?.label ?? "";
      diag.durationMs = Date.now() - t0;
      return;
    }

    // 3. Fallback: enumerate other cameras
    const enumerated = await this.tryAllCameras(order, diag);
    if (enumerated) {
      await setTrackTorch(this.track!, this.method, false);
      diag.outcome = "success";
      diag.successMethod = this.method;
      diag.successCameraLabel = this.track?.label ?? "";
      diag.durationMs = Date.now() - t0;
      return;
    }

    // 4. Last resort: gumTorch if not tried
    if (!order.slice(0, 1).includes("gumTorch") && order.includes("gumTorch")) {
      const r = await this.tryGumTorch(diag);
      if (r) {
        diag.outcome = "success";
        diag.successMethod = "gumTorch";
        diag.successCameraLabel = this.track?.label ?? "";
        diag.durationMs = Date.now() - t0;
        return;
      }
    }

    diag.outcome = "no_torch";
    diag.durationMs = Date.now() - t0;
    throw new TorchError(
      `Фонарик недоступен (попыток: ${diag.attempts.length})`,
      "NOT_SUPPORTED",
      diag
    );
  }

  /** Try getUserMedia with torch:true in advanced constraints (works on some old Android). */
  private async tryGumTorch(diag: TorchDiagnostics): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          advanced: [{ torch: true } as TorchConstraints],
        },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      const preview = attachPreview(stream);
      await preview.ready;
      const settingsTorchAfter = readSettingsTorch(track);
      const caps = (track.getCapabilities?.() ?? {}) as TorchCapabilities;
      diag.attempts.push({
        cameraLabel: track.label,
        cameraId: track.getSettings().deviceId ?? "",
        facingMode: (track.getSettings() as MediaTrackSettings).facingMode,
        capabilitiesTorch: typeof caps.torch === "boolean" ? caps.torch : "undefined",
        capabilitiesJson: safeJson(caps),
        settingsJson: safeJson(track.getSettings()),
        methods: [{ method: "gumTorch", ok: settingsTorchAfter === true, settingsTorchAfter }],
      });
      if (settingsTorchAfter === true) {
        this.stream = stream;
        this.track = track;
        this.method = "gumTorch";
        this.previewVideo = preview.video;
        // Turn off until user starts
        await setTrackTorch(track, "gumTorch", false);
        return true;
      }
      detachPreview(preview.video);
      stream.getTracks().forEach((t) => t.stop());
      return false;
    } catch (e) {
      const err = e as DOMException;
      diag.attempts.push({
        cameraLabel: "(gumTorch)",
        cameraId: "",
        capabilitiesTorch: "undefined",
        capabilitiesJson: "{}",
        settingsJson: "{}",
        methods: [
          {
            method: "gumTorch",
            ok: false,
            errorName: err?.name,
            errorMessage: err?.message,
          },
        ],
      });
      return false;
    }
  }

  private async probeStream(
    stream: MediaStream,
    order: TorchMethod[],
    diag: TorchDiagnostics
  ): Promise<boolean> {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }

    // Live preview is critical for CameraX (Android 13+)
    const preview = attachPreview(stream);
    await preview.ready;

    const caps = (track.getCapabilities?.() ?? {}) as TorchCapabilities;
    const probe = await probeTrack(track, order);

    diag.attempts.push({
      cameraLabel: track.label,
      cameraId: track.getSettings().deviceId ?? "",
      facingMode: (track.getSettings() as MediaTrackSettings).facingMode,
      capabilitiesTorch: typeof caps.torch === "boolean" ? caps.torch : "undefined",
      capabilitiesJson: safeJson(caps),
      settingsJson: safeJson(track.getSettings()),
      methods: probe.results,
    });

    if (probe.winning !== null) {
      this.stream = stream;
      this.track = track;
      this.method = probe.winning;
      this.previewVideo = preview.video;
      return true;
    }

    detachPreview(preview.video);
    stream.getTracks().forEach((t) => t.stop());
    return false;
  }

  private async tryAllCameras(order: TorchMethod[], diag: TorchDiagnostics): Promise<boolean> {
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      /* ignore */
    }
    const cameras = devices.filter((d) => d.kind === "videoinput");
    for (const cam of cameras) {
      const s = await getStream({ deviceId: { exact: cam.deviceId } });
      if (!s) continue;
      const ok = await this.probeStream(s, order, diag);
      if (ok) return true;
    }
    return false;
  }

  async setOn(on: boolean): Promise<void> {
    if (!this.track) return;
    await setTrackTorch(this.track, this.method, on);
  }

  release(): void {
    if (this.track) setTrackTorch(this.track, this.method, false).catch(() => {});
    this.stream?.getTracks().forEach((t) => t.stop());
    detachPreview(this.previewVideo);
    this.stream = null;
    this.track = null;
    this.previewVideo = null;
  }
}

// ── Error mapping ──────────────────────────────────────────────────────────

function mapErrorToCode(name: string): "PERMISSION_DENIED" | "NOT_SUPPORTED" | "UNKNOWN" {
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "PERMISSION_DENIED";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "SecurityError":
      return "NOT_SUPPORTED";
    default:
      return "UNKNOWN";
  }
}

function humanError(name: string, fallback: string): string {
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Доступ к камере отклонён";
    case "NotReadableError":
    case "TrackStartError":
      return "Камера используется другим приложением";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Камера не найдена";
    case "OverconstrainedError":
      return "Камера не поддерживает требуемые параметры";
    case "SecurityError":
      return "Требуется HTTPS";
    case "AbortError":
      return "Запрос камеры прерван";
    default:
      return fallback || "Не удалось открыть камеру";
  }
}
