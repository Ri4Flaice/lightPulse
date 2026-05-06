"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import MorseGlyphs from "@/components/MorseGlyphs";
import MorseTimeline from "@/components/MorseTimeline";
import { morseToTimeline } from "@/lib/morse";
import { detectTorchSupport, TorchController, type TorchSupport } from "@/lib/torch";
import type { Config } from "@/lib/config";

type Props = { initialConfig: Config };

export default function HomeClient({ initialConfig }: Props) {
  const cfg = initialConfig;

  const [torch, setTorch] = useState<TorchSupport & { acquired?: boolean; denied?: boolean }>({
    ok: false,
    reason: "...",
  });
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [flashOn, setFlashOn] = useState(false);
  const [mode, setMode] = useState<"torch" | "screen" | "—">("—");

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const torchRef = useRef<TorchController | null>(null);
  // Resolves to true if torch was acquired, false if denied/failed
  const acquirePromiseRef = useRef<Promise<boolean> | null>(null);
  const homeRef = useRef<HTMLDivElement | null>(null);

  const timeline = useMemo(
    () => morseToTimeline(cfg.sequence, cfg),
    [cfg.sequence, cfg.dotDuration, cfg.dashDuration, cfg.symbolPause, cfg.wordPause]
  );

  // Detect support + try to acquire torch immediately on mount
  useEffect(() => {
    const t = detectTorchSupport();
    setTorch(t);
    if (!t.ok) return;

    const ctrl = new TorchController();
    torchRef.current = ctrl;
    let cancelled = false;

    acquirePromiseRef.current = ctrl
      .acquire()
      .then((): boolean => {
        if (cancelled) return false;
        setTorch({ ok: true, reason: "Фонарик готов", acquired: true });
        return true;
      })
      .catch((): boolean => {
        if (cancelled) return false;
        setTorch({ ok: false, reason: "Доступ к фонарику отклонён", denied: true });
        torchRef.current = null;
        return false;
      });

    return () => {
      cancelled = true;
      acquirePromiseRef.current = null;
      ctrl.release();
      torchRef.current = null;
    };
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
    setStepIdx(-1);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    torchRef.current?.setOn(false);
  }, []);

  const start = useCallback(async () => {
    if (!timeline.length) return;

    let useTorch = false;
    if (torchRef.current?.acquired) {
      // Already acquired — use torch immediately
      useTorch = true;
    } else if (acquirePromiseRef.current) {
      // Acquire is still in progress (user tapped before it resolved) — wait for it
      useTorch = await acquirePromiseRef.current;
    } else if (torch.ok && !torchRef.current) {
      // Acquire failed earlier — retry once on user gesture
      const ctrl = new TorchController();
      try {
        await ctrl.acquire();
        torchRef.current = ctrl;
        useTorch = true;
      } catch {
        useTorch = false;
      }
    }
    setMode(useTorch ? "torch" : "screen");
    setActive(true);

    let i = 0;
    let onIdx = -1;

    const tick = () => {
      if (i >= timeline.length) {
        i = 0;
        onIdx = -1;
      }
      const step = timeline[i];
      if (step.type === "on") {
        onIdx++;
        setStepIdx(onIdx);
        setFlashOn(true);
        if (useTorch) torchRef.current?.setOn(true);
      } else {
        setFlashOn(false);
        if (useTorch) torchRef.current?.setOn(false);
      }
      timerRef.current = setTimeout(() => {
        i++;
        tick();
      }, step.dur);
    };
    tick();
  }, [timeline, torch.ok]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      torchRef.current?.release();
    };
  }, []);

  const torchReady = torch.ok;
  const statusText =
    torch.denied
      ? "доступ отклонён · экранный режим"
      : torchReady
        ? "фонарик готов"
        : torch.reason === "..."
          ? "определение…"
          : "экранный режим";

  return (
    <div className="home" ref={homeRef}>
      <nav className="nav fade-in" style={{ animationDelay: "50ms" }}>
        <Logo size="md" />
      </nav>

      <main className="hero stagger">
        <div className="hero-left">
          <div className="hero-meta">
            <span className="dash" />
            <b>Сигнал · {cfg.label || "Свой"}</b>
            <span>·</span>
            <span>{statusText}</span>
          </div>

          <h1>
            Передавай светом.
            <br />
            <em>Без слов.</em>
          </h1>

          <p className="hero-sub">
            LightPulse превращает фонарик или экран твоего устройства в передатчик морзянки.
            Один тап — и сигнал в эфире.
          </p>

          <div className="status-bar" style={{ marginTop: "auto" }}>
            <div className={`status-card ${torchReady ? "ok" : ""}`}>
              <span className="k">Режим</span>
              <span className="v">{torchReady ? "Фонарик" : "Экран"}</span>
            </div>
            <div className="status-card">
              <span className="k">Скорость</span>
              <span className="v">
                {cfg.dotDuration}/{cfg.dashDuration} мс
              </span>
            </div>
            <div className="status-card">
              <span className="k">Статус</span>
              <span
                className="v"
                style={{ color: active ? "var(--accent)" : "var(--ink-mute)" }}
              >
                {active ? "Передача" : "Ожидание"}
              </span>
            </div>
          </div>
        </div>

        <div className="hero-right">
          <button
            className={`launch ${active ? "active" : ""}`}
            onClick={active ? stop : start}
            aria-label={active ? "Остановить" : "Запустить"}
          >
            {active ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
                </svg>
                <span className="lbl">Остановить</span>
                <span className="sub">{mode === "torch" ? "Фонарик активен" : "Экранный режим"}</span>
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

          <div className="hero-seq">
            <div className="lbl">Последовательность · {cfg.sequence.length} зн.</div>
            <MorseGlyphs sequence={cfg.sequence} currentIndex={stepIdx} playing={active} />
            <MorseTimeline
              sequence={cfg.sequence}
              cfg={cfg}
              playing={active}
              currentIndex={stepIdx}
            />
          </div>
        </div>
      </main>

      <footer className="foot fade-in" style={{ animationDelay: "600ms" }}>
        <span>LightPulse ©2026 Все права защищены</span>
        <div className="row">
          <span>Torch API · Android Chrome</span>
          <span>Экранный режим · iOS · Desktop</span>
        </div>
      </footer>

      {active && mode === "screen" && (
        <div className="flash-controls">
          <button className="btn" onClick={stop}>
            Стоп
          </button>
        </div>
      )}
    </div>
  );
}
