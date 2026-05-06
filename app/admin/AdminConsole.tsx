"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import StatusChip from "@/components/StatusChip";
import MorseGlyphs from "@/components/MorseGlyphs";
import MorseTimeline from "@/components/MorseTimeline";
import { morseToTimeline, textToMorse, totalDuration } from "@/lib/morse";
import type { Config } from "@/lib/config";

const PRESETS = [
  { id: "sos", label: "SOS", text: "SOS", seq: "... --- ..." },
  { id: "help", label: "HELP", text: "HELP", seq: ".... . .-.. .--." },
  { id: "ok", label: "OK", text: "OK", seq: "--- -.-" },
  { id: "cq", label: "CQ", text: "CQ", seq: "-.-. --.-" },
  { id: "love", label: "LOVE", text: "LOVE", seq: ".-.. --- ...- ." },
];

const TIMING_FIELDS = [
  { k: "dotDuration", label: "Точка", min: 50, max: 600, step: 10, w: 4 },
  { k: "dashDuration", label: "Тире", min: 150, max: 1500, step: 20, w: 18 },
  { k: "symbolPause", label: "Символ паузы", min: 50, max: 1000, step: 20, w: 0 },
  { k: "wordPause", label: "Пауза в слове", min: 100, max: 2000, step: 20, w: 0 },
] as const;

function cfgToJson(cfg: Config): string {
  return JSON.stringify(
    {
      sequence: cfg.sequence,
      label: cfg.label,
      dotDuration: cfg.dotDuration,
      dashDuration: cfg.dashDuration,
      symbolPause: cfg.symbolPause,
      wordPause: cfg.wordPause,
      accent: cfg.accent,
    },
    null,
    2
  );
}

function jsonToCfgPatch(
  str: string
): { ok: true; data: Partial<Config> } | { ok: false; err: string } {
  try {
    const p = JSON.parse(str) as Record<string, unknown>;
    const out: Partial<Config> = {};
    if (typeof p.sequence === "string") out.sequence = p.sequence;
    if (typeof p.label === "string") out.label = p.label;
    if (typeof p.dotDuration === "number") out.dotDuration = p.dotDuration;
    if (typeof p.dashDuration === "number") out.dashDuration = p.dashDuration;
    if (typeof p.symbolPause === "number") out.symbolPause = p.symbolPause;
    if (typeof p.wordPause === "number") out.wordPause = p.wordPause;
    if (typeof p.accent === "string") out.accent = p.accent;
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : "parse error" };
  }
}

type Props = { initialConfig: Config };

export default function AdminConsole({ initialConfig }: Props) {
  const router = useRouter();
  const [cfg, setCfg] = useState<Config>(initialConfig);
  const [savedCfg, setSavedCfg] = useState<Config>(initialConfig);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(savedCfg);

  const [tab, setTab] = useState<"text" | "morse">("text");
  const [text, setText] = useState(initialConfig.label);

  const [previewMode, setPreviewMode] = useState<"torch" | "screen">("torch");
  const [playing, setPlaying] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [flashOn, setFlashOn] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [jsonTab, setJsonTab] = useState<"preview" | "edit">("preview");
  const [jsonStr, setJsonStr] = useState<string>(() => cfgToJson(initialConfig));
  const [jsonErr, setJsonErr] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const update = (patch: Partial<Config>) =>
    setCfg((c) => {
      const next = { ...c, ...patch };
      setJsonStr(cfgToJson(next));
      return next;
    });

  const applyJson = () => {
    const res = jsonToCfgPatch(jsonStr);
    if (!res.ok) {
      setJsonErr("Ошибка JSON: " + res.err);
      return;
    }
    setJsonErr("");
    setCfg((c) => ({ ...c, ...res.data }));
    if (typeof res.data.label === "string") setText(res.data.label);
    setJsonTab("preview");
  };

  const exportJson = () => {
    const blob = new Blob([cfgToJson(cfg)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lightpulse-config.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const str = String(ev.target?.result ?? "");
      const res = jsonToCfgPatch(str);
      if (!res.ok) {
        setJsonErr("Ошибка импорта: " + res.err);
        return;
      }
      setJsonErr("");
      setJsonStr(str);
      setCfg((c) => ({ ...c, ...res.data }));
      if (typeof res.data.label === "string") setText(res.data.label);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const onTextChange = (v: string) => {
    setText(v);
    update({ sequence: textToMorse(v) || "...", label: v.toUpperCase().slice(0, 18) });
  };
  const onSeqChange = (v: string) => update({ sequence: v.replace(/[^.\-\s\/]/g, "") });

  const timeline = useMemo(
    () => morseToTimeline(cfg.sequence, cfg),
    [cfg.sequence, cfg.dotDuration, cfg.dashDuration, cfg.symbolPause, cfg.wordPause]
  );
  const totalMs = useMemo(() => totalDuration(timeline), [timeline]);
  const onCount = useMemo(() => timeline.filter((s) => s.type === "on").length, [timeline]);

  const stop = useCallback(() => {
    setPlaying(false);
    setFlashOn(false);
    setStepIdx(-1);
    setProgress(0);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    if (!timeline.length) return;
    setPlaying(true);
    let i = 0;
    let onIdx = -1;
    let elapsed = 0;
    const tick = () => {
      if (i >= timeline.length) {
        i = 0;
        onIdx = -1;
        elapsed = 0;
      }
      const step = timeline[i];
      if (step.type === "on") {
        onIdx++;
        setStepIdx(onIdx);
        setFlashOn(true);
      } else {
        setFlashOn(false);
      }
      setProgress(elapsed / (totalMs || 1));
      timerRef.current = setTimeout(() => {
        elapsed += step.dur;
        i++;
        tick();
      }, step.dur);
    };
    tick();
  }, [timeline, totalMs]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (playing) {
      stop();
      const t = setTimeout(play, 50);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.sequence, cfg.dotDuration, cfg.dashDuration, cfg.symbolPause, cfg.wordPause]);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setText(p.text);
    update({ sequence: p.seq, label: p.label });
  };
  const activePreset = PRESETS.find((p) => p.seq === cfg.sequence)?.id;

  async function save() {
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setSaveErr(j.error || `Ошибка ${res.status}`);
        return;
      }
      const saved: Config = await res.json();
      setSavedCfg(saved);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <div className="admin">
      <div className="admin-bar fade-in">
        <div className="left">
          <Logo size="md" />
          <span className="crumbs">
            <span>админка</span>
            <span>/</span>
            <span className="now">конфигурация</span>
          </span>
        </div>
        <div className="right">
          <StatusChip live label="Онлайн" />
          <button className="btn btn-ghost" onClick={logout}>
            Выйти
          </button>
        </div>
      </div>

      <div className="admin-body stagger">
        {/* 01: Sequence */}
        <section className="panel">
          <header className="panel-head">
            <h3>
              <span className="num">01</span> Последовательность
            </h3>
            <span className="tag-mono">
              {cfg.sequence.length} знаков · {onCount} импульсов
            </span>
          </header>
          <div className="panel-body">
            <div className="tabs">
              <button
                className={`tab ${tab === "text" ? "active" : ""}`}
                onClick={() => setTab("text")}
              >
                Текст → Морзе
              </button>
              <button
                className={`tab ${tab === "morse" ? "active" : ""}`}
                onClick={() => setTab("morse")}
              >
                Прямая азбука Морзе
              </button>
            </div>

            {tab === "text" ? (
              <>
                <div className="field">
                  <label>
                    Текст для передачи <span className="hint">Англ / Ру · автоконверт</span>
                  </label>
                  <textarea
                    className="textarea"
                    value={text}
                    onChange={(e) => onTextChange(e.target.value)}
                    placeholder="Введите сообщение…"
                  />
                </div>
                <div className="swap-row">
                  <span className="swap-arrow">↓</span>
                </div>
                <div className="field">
                  <label>Морзянка (предосмотр)</label>
                  <div className="textarea mono" style={{ minHeight: 60, opacity: 0.85 }}>
                    {cfg.sequence || <span style={{ color: "var(--ink-dim)" }}>—</span>}
                  </div>
                </div>
              </>
            ) : (
              <div className="field">
                <label>
                  Морзянка <span className="hint">. − / · только эти символы</span>
                </label>
                <textarea
                  className="textarea mono"
                  value={cfg.sequence}
                  onChange={(e) => onSeqChange(e.target.value)}
                  placeholder=".- ..- -.."
                />
              </div>
            )}

            <div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Пресеты</label>
              </div>
              <div className="presets">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={`preset ${activePreset === p.id ? "active" : ""}`}
                    onClick={() => applyPreset(p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>Временная шкала</label>
              </div>
              <MorseTimeline
                sequence={cfg.sequence}
                cfg={cfg}
                playing={playing}
                currentIndex={stepIdx}
              />
              <div className="counter" style={{ marginTop: 10 }}>
                <span>длительность цикла</span>
                <span className="v">{(totalMs / 1000).toFixed(2)}с</span>
              </div>
            </div>
          </div>
        </section>

        {/* 02: Timing */}
        <section className="panel">
          <header className="panel-head">
            <h3>
              <span className="num">02</span> Тайминг
            </h3>
            <span className="tag-mono">миллисекунды</span>
          </header>
          <div className="panel-body">
            <div className="tim-grid">
              {TIMING_FIELDS.map((t) => (
                <div key={t.k} className="tim-card">
                  <span className="k">
                    {t.w > 0 && <span className="pip" style={{ width: t.w, height: 4 }} />}
                    {t.label}
                  </span>
                  <div className="v">
                    <input
                      type="number"
                      min={t.min}
                      max={t.max}
                      step={t.step}
                      value={cfg[t.k]}
                      onChange={(e) =>
                        update({ [t.k]: Number(e.target.value) || t.min } as Partial<Config>)
                      }
                    />
                    <span className="u">мс</span>
                  </div>
                  <input
                    type="range"
                    min={t.min}
                    max={t.max}
                    step={t.step}
                    value={cfg[t.k]}
                    onChange={(e) =>
                      update({ [t.k]: Number(e.target.value) } as Partial<Config>)
                    }
                  />
                </div>
              ))}
            </div>

            <hr className="hr" />

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <div className="tabs" style={{ marginBottom: 0 }}>
                  <button
                    className={`tab ${jsonTab === "preview" ? "active" : ""}`}
                    onClick={() => setJsonTab("preview")}
                  >
                    Конфиг
                  </button>
                  <button
                    className={`tab ${jsonTab === "edit" ? "active" : ""}`}
                    onClick={() => {
                      setJsonStr(cfgToJson(cfg));
                      setJsonTab("edit");
                      setJsonErr("");
                    }}
                  >
                    Редактор
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <label
                    className="btn"
                    style={{ height: 30, padding: "0 10px", fontSize: 11, cursor: "pointer" }}
                    title="Импортировать JSON-файл"
                  >
                    ↑ Импорт
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={importJson}
                      style={{ display: "none" }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    style={{ height: 30, padding: "0 10px", fontSize: 11 }}
                    onClick={exportJson}
                    title="Скачать config.json"
                  >
                    ↓ Экспорт
                  </button>
                </div>
              </div>

              {jsonTab === "preview" ? (
                <pre className="kv-json">{cfgToJson(cfg)}</pre>
              ) : (
                <div>
                  <textarea
                    className="textarea mono"
                    style={{ minHeight: 180, fontSize: 12 }}
                    value={jsonStr}
                    onChange={(e) => {
                      setJsonStr(e.target.value);
                      setJsonErr("");
                    }}
                    spellCheck={false}
                  />
                  {jsonErr && (
                    <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
                      {jsonErr}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ flex: 1, height: 38, fontSize: 13 }}
                      onClick={applyJson}
                    >
                      Применить
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setJsonStr(cfgToJson(cfg));
                        setJsonTab("preview");
                        setJsonErr("");
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 03: Live Test */}
        <section className="panel">
          <header className="panel-head">
            <h3>
              <span className="num">03</span> Тест
            </h3>
            <StatusChip live={playing} label={playing ? "Воспроизведение" : "Режим ожидания"} />
          </header>
          <div className="panel-body">
            <div className="preview-mode-toggle">
              <button
                className={previewMode === "torch" ? "on" : ""}
                onClick={() => setPreviewMode("torch")}
              >
                Режим фонарика
              </button>
              <button
                className={previewMode === "screen" ? "on" : ""}
                onClick={() => setPreviewMode("screen")}
              >
                Режим экрана
              </button>
            </div>

            <div className="preview-stage">
              <div className="device-frame" />
              <div className="notch" />
              <div
                className={`device-screen ${previewMode === "screen" && flashOn ? "flash" : ""}`}
              />
              {previewMode === "torch" && (
                <div className={`torch-bulb ${flashOn ? "on" : ""}`}>
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 2h6l1 4-2 3v3l-3 9-3-9V9L8 6l1-4z" />
                  </svg>
                </div>
              )}
            </div>

            <MorseGlyphs sequence={cfg.sequence} currentIndex={stepIdx} playing={playing} />

            <div className="counter">
              <span>прогресс</span>
              <span className="v mono">
                {Math.round(progress * 100)}% · {(totalMs / 1000).toFixed(2)}с цикл
              </span>
            </div>

            <div className="transport">
              <button
                className={`btn ${playing ? "" : "btn-primary"}`}
                onClick={playing ? stop : play}
              >
                {playing ? "■ Стоп" : "▶ Воспроизвести"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  stop();
                  setTimeout(play, 80);
                }}
              >
                ↻ Заново
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className={`save-bar ${dirty ? "dirty" : ""}`}>
        <div className="msg">
          <span
            className="dot"
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: dirty ? "var(--accent)" : "var(--ink-dim)",
              boxShadow: dirty ? "0 0 8px var(--accent-glow)" : "none",
            }}
          />
          {saveErr
            ? `Ошибка: ${saveErr}`
            : dirty
              ? "Изменения не сохранены"
              : "Конфигурация актуальна"}
          <span className="tag-mono" style={{ marginLeft: 6 }}>
            config.json
          </span>
        </div>
        <div className="actions">
          <button
            className="btn"
            onClick={() => {
              setCfg(savedCfg);
              setJsonStr(cfgToJson(savedCfg));
              setJsonErr("");
            }}
            disabled={!dirty || saving}
          >
            Отменить
          </button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
