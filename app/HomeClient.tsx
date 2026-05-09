"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import ToastList, { type ToastData } from "@/components/Toast";
import { morseToTimeline } from "@/lib/morse";
import { detectTorchSupport, isIOS, TorchController, TorchError, type TorchSupport } from "@/lib/torch";
import { sendTorchLog } from "@/lib/torchLogClient";
import type { Config } from "@/lib/config";

type Props = { initialConfig: Config };

let toastIdCounter = 0;

export default function HomeClient({ initialConfig }: Props) {
  const [cfg, setCfg] = useState<Config>(initialConfig);

  const [torch, setTorch] = useState<TorchSupport & { acquired?: boolean; denied?: boolean }>({
    ok: false,
    reason: "...",
  });
  const [active, setActive] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [mode, setMode] = useState<"torch" | "screen" | "—">("—");
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const torchRef = useRef<TorchController | null>(null);
  // Resolves to true if torch was acquired, false if denied/failed
  const acquirePromiseRef = useRef<Promise<boolean> | null>(null);
  const homeRef = useRef<HTMLDivElement | null>(null);

  const timeline = useMemo(
    () => morseToTimeline(cfg.sequence, cfg),
    [cfg.sequence, cfg.dotDuration, cfg.dashDuration, cfg.symbolPause, cfg.wordPause]
  );
  // Ref so the running tick loop always reads the latest timeline without restart
  const timelineRef = useRef(timeline);
  useEffect(() => { timelineRef.current = timeline; }, [timeline]);

  const addToast = useCallback((message: string, type: ToastData["type"]) => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Detect support + try to acquire torch immediately on mount
  useEffect(() => {
    const t = detectTorchSupport();
    setTorch(t);
    if (!t.ok) return;

    const ctrl = new TorchController();
    torchRef.current = ctrl;
    let cancelled = false;

    // iOS Safari requires a user gesture for getUserMedia — defer acquire to button click
    if (isIOS()) {
      setTorch({ ok: true, reason: "Готов · нажмите для запуска", acquired: false });
      return () => {
        cancelled = true;
        ctrl.release();
        torchRef.current = null;
      };
    }

    acquirePromiseRef.current = ctrl
      .acquire()
      .then((): boolean => {
        if (cancelled) return false;
        setTorch({ ok: true, reason: "Фонарик готов", acquired: true });
        sendTorchLog(ctrl.diagnostics).catch(() => {});
        return true;
      })
      .catch((err): boolean => {
        if (cancelled) return false;
        const isTorchErr = err instanceof TorchError;
        const denied = isTorchErr && err.code === "PERMISSION_DENIED";
        const reason = denied ? "Доступ отклонён · экранный режим" : "Экранный режим";
        setTorch({ ok: false, reason, denied });
        torchRef.current = null;
        const toastMsg = denied
          ? "Доступ к камере отклонён — экранный режим"
          : "Фонарик недоступен — экранный режим";
        addToast(toastMsg, denied ? "info" : "error");
        if (isTorchErr) sendTorchLog(err.diagnostics).catch(() => {});
        return false;
      });

    return () => {
      cancelled = true;
      acquirePromiseRef.current = null;
      ctrl.release();
      torchRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply accent
  useEffect(() => {
    if (cfg.accent) document.documentElement.style.setProperty("--accent", cfg.accent);
  }, [cfg.accent]);

  // Screen-flash class toggle
  useEffect(() => {
    const el = homeRef.current;
    if (!el) return;
    if (active && mode === "screen" && flashOn) el.classList.add("screen-flash");
    else el.classList.remove("screen-flash");
  }, [active, mode, flashOn]);

  const stop = useCallback(() => {
    setActive(false);
    setFlashOn(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    torchRef.current?.setOn(false);
  }, []);

  // Server↔client time offset (serverTime ≈ clientTime + offset).
  const serverOffsetRef = useRef(0);

  const start = useCallback(
    async (serverStartAt?: number) => {
      if (!timeline.length) return;
      setLoading(true);

      let useTorch = false;
      try {
        if (torchRef.current?.acquired) {
          useTorch = true;
        } else if (acquirePromiseRef.current) {
          useTorch = await acquirePromiseRef.current;
          if (!useTorch) {
            addToast("Фонарик недоступен — включён экранный режим", "info");
          }
        } else if (torch.ok && torchRef.current && !torchRef.current.acquired) {
          // iOS path: acquire runs inside the user-gesture click handler
          const ctrl = torchRef.current;
          try {
            await ctrl.acquire();
            setTorch({ ok: true, reason: "Фонарик готов", acquired: true });
            useTorch = true;
            sendTorchLog(ctrl.diagnostics).catch(() => {});
          } catch (err) {
            useTorch = false;
            const denied = err instanceof TorchError && err.code === "PERMISSION_DENIED";
            setTorch({
              ok: false,
              reason: denied ? "Доступ отклонён · экранный режим" : "Экранный режим",
              denied,
            });
            addToast(
              denied
                ? "Доступ к камере отклонён — экранный режим"
                : "Фонарик недоступен — экранный режим",
              denied ? "info" : "error"
            );
            if (err instanceof TorchError) sendTorchLog(err.diagnostics).catch(() => {});
          }
        } else if (torch.ok && !torchRef.current) {
          const ctrl = new TorchController();
          try {
            await ctrl.acquire();
            torchRef.current = ctrl;
            useTorch = true;
            sendTorchLog(ctrl.diagnostics).catch(() => {});
          } catch (err) {
            useTorch = false;
            addToast("Фонарик недоступен — экранный режим", "error");
            if (err instanceof TorchError) sendTorchLog(err.diagnostics).catch(() => {});
          }
        }
      } finally {
        setLoading(false);
      }

      if (useTorch) {
        addToast("Фонарик активен", "success");
      } else if (mode === "—") {
        addToast("Экранный режим активен", "info");
      }

      setMode(useTorch ? "torch" : "screen");
      setActive(true);

      // Convert server-time anchor to local-time anchor; if no anchor, start now.
      const offset = serverOffsetRef.current;
      const localAnchor =
        typeof serverStartAt === "number" ? serverStartAt - offset : Date.now();

      const totalDur = timeline.reduce((s, t) => s + t.dur, 0);
      let i = 0;
      let onIdx = -1;
      // `nextAt` is the local-clock target for the *current* step's transition.
      let nextAt = localAnchor;

      // Late-joiner sync: if anchor is in the past (broadcast already running),
      // find the current position in the loop instead of replaying from step 0
      // at zero-delay (which causes hyper-fast flashing).
      if (totalDur > 0 && localAnchor < Date.now()) {
        const elapsed = (Date.now() - localAnchor) % totalDur;
        let walked = 0;
        while (i < timeline.length && walked + timeline[i].dur <= elapsed) {
          walked += timeline[i].dur;
          i++;
        }
        nextAt = Date.now() - (elapsed - walked);
      }

      const tick = () => {
        const tl = timelineRef.current;
        if (i >= tl.length || i < 0) {
          i = 0;
          onIdx = -1;
          nextAt = Date.now();
        }
        const step = tl[i];
        if (step.type === "on") {
          onIdx++;
          setFlashOn(true);
          if (useTorch) torchRef.current?.setOn(true);
        } else {
          setFlashOn(false);
          if (useTorch) torchRef.current?.setOn(false);
        }
        // Schedule next step at absolute time (corrects for setTimeout drift).
        nextAt += step.dur;
        const wait = Math.max(0, nextAt - Date.now());
        timerRef.current = setTimeout(() => {
          i++;
          tick();
        }, wait);
      };

      const initialWait = Math.max(0, localAnchor - Date.now());
      timerRef.current = setTimeout(tick, initialWait);
    },
    [timeline, torch.ok, mode, addToast]
  );

  // Refs to call latest start/stop from EventSource handlers without stale closures.
  const startRef = useRef(start);
  const stopRef = useRef(stop);
  useEffect(() => {
    startRef.current = start;
    stopRef.current = stop;
  }, [start, stop]);

  // Track the active state so the SSE handler doesn't re-fire on duplicate events.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // NTP-style server clock sync. Repeated quick samples; keep the lowest-RTT result.
  useEffect(() => {
    let cancelled = false;
    let bestRtt = Infinity;

    const sample = async () => {
      const t0 = Date.now();
      try {
        const res = await fetch("/api/time", { cache: "no-store" });
        const t3 = Date.now();
        const j = (await res.json()) as { now: number };
        if (cancelled || typeof j.now !== "number") return;
        const rtt = t3 - t0;
        if (rtt < bestRtt) {
          bestRtt = rtt;
          // serverNow at (t0+t3)/2 ≈ j.now → offset such that serverTime = clientTime + offset
          serverOffsetRef.current = j.now - (t0 + t3) / 2;
        }
      } catch {
        /* ignore */
      }
    };

    (async () => {
      for (let i = 0; i < 4 && !cancelled; i++) {
        await sample();
        await new Promise((r) => setTimeout(r, 150));
      }
    })();
    const id = setInterval(sample, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Subscribe to admin broadcast events.
  useEffect(() => {
    let lastVersion = -1;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/broadcast/stream");
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as
            | { type: "broadcast"; payload: { playing: boolean; version: number; startAt?: number } }
            | { type: "config"; payload: Config }
            | { type: "ping" };
          if (msg.type === "config") {
            setCfg(msg.payload);
            return;
          }
          if (msg.type !== "broadcast") return;
          const data = msg.payload;
          if (typeof data.version !== "number" || data.version <= lastVersion) return;
          lastVersion = data.version;
          if (data.playing && !activeRef.current) {
            startRef.current(data.startAt);
          } else if (!data.playing && activeRef.current) {
            stopRef.current();
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (cancelled) return;
        retryTimer = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      torchRef.current?.release();
    };
  }, []);

  return (
    <div className="home" ref={homeRef}>
      <nav className="nav fade-in" style={{ animationDelay: "50ms" }}>
        <Logo size="md" href="/" />
      </nav>

      <main className="hero stagger">
        <button
          className={`launch ${active ? "active" : ""} ${loading ? "loading" : ""}`}
          onClick={active ? stop : () => start()}
          disabled={loading}
          aria-label={active ? "Остановить" : loading ? "Подключение…" : "Запустить"}
        >
          {active ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
              <span className="lbl">Остановить</span>
              <span className="sub">{mode === "torch" ? "Фонарик активен" : "Экранный режим"}</span>
            </>
          ) : loading ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="spin">
                <circle cx="12" cy="12" r="9" strokeDasharray="40" strokeDashoffset="15" strokeLinecap="round" />
              </svg>
              <span className="lbl">Подключение…</span>
              <span className="sub">поиск камеры</span>
            </>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 2h6l1 4-2 3v3l-3 9-3-9V9L8 6l1-4z" />
                <path d="M10 6h4" />
              </svg>
              <span className="lbl">Включить фонарик</span>
              <span className="sub">нажмите для передачи</span>
            </>
          )}
        </button>

      </main>

      <footer className="foot fade-in" style={{ animationDelay: "600ms" }}>
        <span>LightPulse ©2026 Все права защищены</span>
      </footer>

      <ToastList toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
