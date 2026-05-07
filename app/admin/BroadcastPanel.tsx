"use client";

import { useCallback, useEffect, useState } from "react";

type BroadcastState = { playing: boolean; version: number; ts: number };

export default function BroadcastPanel() {
  const [state, setState] = useState<BroadcastState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/broadcast/state", { cache: "no-store" });
      if (res.ok) setState((await res.json()) as BroadcastState);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/broadcast/toggle", { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error || `Ошибка ${res.status}`);
        return;
      }
      setState(j as BroadcastState);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, []);

  const playing = state?.playing ?? false;

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <span className="num">05</span> Световое шоу
        </h3>
        <span className="tag-mono">
          {state ? `v${state.version}` : "—"} ·{" "}
          <span style={{ color: playing ? "var(--accent)" : "var(--ink-dim)" }}>
            {playing ? "идёт" : "выключено"}
          </span>
        </span>
      </header>
      <div className="panel-body">
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 0 }}>
          Запустить фонарик у всех, кто открыл главную страницу. Повторное нажатие — остановит у
          всех. Состояние сохраняется: новые посетители подхватят активное шоу автоматически.
        </p>

        <button
          type="button"
          className={`btn ${playing ? "" : "btn-primary"}`}
          onClick={toggle}
          disabled={busy}
          style={{
            width: "100%",
            height: 56,
            fontSize: 15,
            fontWeight: 600,
            marginTop: 8,
          }}
        >
          {busy
            ? "…"
            : playing
              ? "■ Остановить шоу у всех"
              : "▶ Запустить шоу у всех"}
        </button>

        {err && (
          <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 10 }}>{err}</p>
        )}

        {state && state.ts > 0 && (
          <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 12 }}>
            Последнее переключение:{" "}
            {new Date(state.ts).toLocaleString("ru-RU", { hour12: false })}
          </p>
        )}
      </div>
    </section>
  );
}
