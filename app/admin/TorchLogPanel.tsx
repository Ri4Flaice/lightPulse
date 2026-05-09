"use client";

import { useCallback, useEffect, useState } from "react";

type LogEntry = {
  ts: string;
  serverTs: string;
  ipHash: string;
  userAgent: string;
  platform: string;
  hasMediaDevices: boolean;
  hasImageCapture: boolean;
  outcome: "success" | "permission_denied" | "no_torch" | "no_camera" | "error";
  successMethod?: string;
  successCameraLabel?: string;
  durationMs: number;
  topLevelErrorName?: string;
  topLevelErrorMessage?: string;
  security: {
    isSecureContext: boolean;
    protocol: string;
    permissionsApiState: string;
    permissionsPolicyCamera: boolean | "unknown";
    displayMode: string;
    visibilityState: string;
    inIframe: boolean;
  };
  attempts: Array<{
    cameraLabel: string;
    cameraId: string;
    facingMode?: string;
    capabilitiesTorch: boolean | "undefined";
    capabilitiesJson: string;
    settingsJson: string;
    methods: Array<{
      method: string;
      ok: boolean;
      errorName?: string;
      errorMessage?: string;
      settingsTorchAfter?: boolean | "undefined";
    }>;
  }>;
};

const OUTCOME_LABEL: Record<LogEntry["outcome"], string> = {
  success: "Успех",
  permission_denied: "Отклонено",
  no_torch: "Нет фонарика",
  no_camera: "Нет камеры",
  error: "Ошибка",
};

const OUTCOME_COLOR: Record<LogEntry["outcome"], string> = {
  success: "#a6ff3d",
  permission_denied: "#ffb84d",
  no_torch: "#ff7a7a",
  no_camera: "#ff7a7a",
  error: "#ff7a7a",
};

function shortUA(ua: string): string {
  const m =
    ua.match(/\(([^)]+)\)/)?.[1].split(";").map((s) => s.trim()).slice(-2).join(" ") ?? "";
  const browser =
    ua.match(/(SamsungBrowser|EdgA|Chrome|Firefox|Safari)\/[\d.]+/i)?.[0] ?? "";
  return [m, browser].filter(Boolean).join(" · ").slice(0, 90);
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", { hour12: false });
  } catch {
    return iso;
  }
}

const BATCH = 10;

export default function TorchLogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [limit, setLimit] = useState(BATCH);
  const [hasMore, setHasMore] = useState(false);
  const [totalShown, setTotalShown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchEntries = useCallback(async (fetchLimit: number, append: boolean) => {
    append ? setLoadingMore(true) : setLoading(true);
    setErr(null);
    try {
      // Fetch one extra to detect if more exist
      const res = await fetch(`/api/torch-log?limit=${fetchLimit + 1}`, { cache: "no-store" });
      if (!res.ok) { setErr(`Ошибка ${res.status}`); return; }
      const j = (await res.json()) as { entries: LogEntry[] };
      const got = j.entries.slice(0, fetchLimit);
      setHasMore(j.entries.length > fetchLimit);
      setEntries(got);
      setTotalShown(got.length);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setLimit(BATCH);
    fetchEntries(BATCH, false);
  }, [fetchEntries]);

  const loadMore = useCallback(() => {
    const next = limit + BATCH;
    setLimit(next);
    fetchEntries(next, true);
  }, [limit, fetchEntries]);

  const clear = useCallback(async () => {
    if (!confirm("Очистить весь журнал фонарика?")) return;
    setLoading(true);
    try {
      await fetch("/api/torch-log", { method: "DELETE" });
      setEntries([]);
      setHasMore(false);
      setLimit(BATCH);
      setTotalShown(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries(BATCH, false);
  }, [fetchEntries]);

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <span className="num">05</span> Журнал фонарика
        </h3>
        <span className="tag-mono">{totalShown > 0 ? `${totalShown} записей` : "—"}</span>
      </header>
      <div className="panel-body">
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Загрузка…" : "↻ Обновить"}
          </button>
          <a
            className="btn"
            href="/api/torch-log?format=raw"
            download="torch-log.jsonl"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            ↓ Скачать JSONL
          </a>
          <button
            className="btn"
            onClick={clear}
            disabled={loading || entries.length === 0}
            style={{ marginLeft: "auto" }}
          >
            Очистить
          </button>
        </div>

        {err && (
          <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 10 }}>{err}</p>
        )}

        {!loading && entries.length === 0 && !err && (
          <p style={{ fontSize: 12, color: "var(--ink-dim)" }}>Записей нет.</p>
        )}

        {entries.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {entries.map((e, i) => (
              <details
                key={`${e.serverTs}-${i}`}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "8px 10px",
                  background: "rgba(255,255,255,0.02)",
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <summary style={{ cursor: "pointer", listStyle: "none", minWidth: 0 }}>
                  {/* Строка 1: индикатор + время + исход + метод */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    flexWrap: "wrap",
                    minWidth: 0,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 4,
                      background: OUTCOME_COLOR[e.outcome],
                      flexShrink: 0,
                    }} />
                    <span style={{ color: "var(--ink-dim)", flexShrink: 0 }}>
                      {fmtTime(e.serverTs)}
                    </span>
                    <span style={{ color: OUTCOME_COLOR[e.outcome], fontWeight: 600, flexShrink: 0 }}>
                      {OUTCOME_LABEL[e.outcome]}
                    </span>
                    <span style={{ color: "var(--ink)", flexShrink: 0 }}>
                      {e.successMethod ?? e.topLevelErrorName ?? "—"}
                    </span>
                  </div>
                  {/* Строка 2: UA (обрезается) + длительность */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    marginTop: 3,
                    minWidth: 0,
                  }}>
                    <span style={{
                      color: "var(--ink-dim)",
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {shortUA(e.userAgent)}
                    </span>
                    <span style={{ color: "var(--ink-dim)", flexShrink: 0 }}>{e.durationMs}мс</span>
                  </div>
                </summary>

                <div style={{ marginTop: 10, fontSize: 11, fontFamily: "var(--font-mono)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginBottom: 10, minWidth: 0 }}>
                    <span style={{ color: "var(--ink-dim)" }}>UA:</span>
                    <span style={{ wordBreak: "break-all" }}>{e.userAgent}</span>
                    <span style={{ color: "var(--ink-dim)" }}>Platform:</span>
                    <span>{e.platform}</span>
                    <span style={{ color: "var(--ink-dim)" }}>Secure:</span>
                    <span>{String(e.security.isSecureContext)} · {e.security.protocol}</span>
                    <span style={{ color: "var(--ink-dim)" }}>Permissions:</span>
                    <span style={{ wordBreak: "break-all" }}>
                      api={e.security.permissionsApiState} · policy=
                      {String(e.security.permissionsPolicyCamera)} · iframe={String(e.security.inIframe)}
                    </span>
                    <span style={{ color: "var(--ink-dim)" }}>Display:</span>
                    <span>{e.security.displayMode} · {e.security.visibilityState}</span>
                    <span style={{ color: "var(--ink-dim)" }}>ImageCapture:</span>
                    <span>{String(e.hasImageCapture)}</span>
                    <span style={{ color: "var(--ink-dim)" }}>IP hash:</span>
                    <span>{e.ipHash}</span>
                    {e.topLevelErrorName && (
                      <>
                        <span style={{ color: "var(--ink-dim)" }}>Top error:</span>
                        <span style={{ wordBreak: "break-all" }}>
                          {e.topLevelErrorName}
                          {e.topLevelErrorMessage ? ` — ${e.topLevelErrorMessage}` : ""}
                        </span>
                      </>
                    )}
                  </div>

                  {e.attempts.map((a, ai) => (
                    <div
                      key={ai}
                      style={{ borderTop: "1px dashed var(--line)", paddingTop: 8, marginTop: 8 }}
                    >
                      <div style={{ color: "var(--ink-dim)", marginBottom: 4, wordBreak: "break-word" }}>
                        Камера #{ai + 1}: {a.cameraLabel || "(без названия)"} · facing=
                        {a.facingMode ?? "—"} · caps.torch={String(a.capabilitiesTorch)}
                      </div>
                      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", tableLayout: "fixed" }}>
                        <colgroup>
                          <col style={{ width: 24 }} />
                          <col style={{ width: "40%" }} />
                          <col />
                        </colgroup>
                        <tbody>
                          {a.methods.map((m, mi) => (
                            <tr key={mi}>
                              <td style={{ padding: "2px 4px", color: m.ok ? "#a6ff3d" : "#ff7a7a" }}>
                                {m.ok ? "✓" : "✗"}
                              </td>
                              <td style={{ padding: "2px 4px", wordBreak: "break-all" }}>{m.method}</td>
                              <td style={{ padding: "2px 4px", color: "var(--ink-dim)", wordBreak: "break-all" }}>
                                {m.errorName ?? ""}
                                {m.errorMessage ? ` — ${m.errorMessage}` : ""}
                                {m.settingsTorchAfter !== undefined
                                  ? ` (settings.torch=${String(m.settingsTorchAfter)})`
                                  : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ cursor: "pointer", color: "var(--ink-dim)" }}>
                          capabilities / settings JSON
                        </summary>
                        <pre style={{ fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "4px 0", overflowX: "hidden" }}>
                          caps: {a.capabilitiesJson}
                          {"\n"}settings: {a.settingsJson}
                        </pre>
                      </details>
                    </div>
                  ))}
                </div>
              </details>
            ))}

            {hasMore && (
              <button
                className="btn"
                onClick={loadMore}
                disabled={loadingMore}
                style={{ marginTop: 4, width: "100%" }}
              >
                {loadingMore ? "Загрузка…" : `Загрузить ещё ${BATCH}`}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
