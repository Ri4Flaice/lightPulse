"use client";

import { useEffect, useRef } from "react";

export type ToastData = {
  id: number;
  message: string;
  type: "success" | "error" | "info";
};

type Props = { toasts: ToastData[]; onDismiss: (id: number) => void };

export default function ToastList({ toasts, onDismiss }: Props) {
  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 200,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      alignItems: "center",
      pointerEvents: "none",
      width: "min(90vw, 380px)",
    }}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: number) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(toast.id), 4500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [toast.id, onDismiss]);

  const colors: Record<ToastData["type"], { bg: string; border: string; icon: string }> = {
    success: { bg: "rgba(12,12,12,0.96)", border: "var(--accent)", icon: "✓" },
    error:   { bg: "rgba(12,12,12,0.96)", border: "var(--danger)",  icon: "✕" },
    info:    { bg: "rgba(12,12,12,0.96)", border: "var(--line-strong)", icon: "·" },
  };
  const c = colors[toast.type];

  return (
    <div
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 999,
        boxShadow: `0 0 0 1px ${c.border}22, 0 8px 32px rgba(0,0,0,0.5)`,
        fontSize: 13,
        color: "var(--ink)",
        backdropFilter: "blur(12px)",
        animation: "fadeUp 300ms var(--ease-out) both",
        cursor: "pointer",
        userSelect: "none",
      }}
      onClick={() => onDismiss(toast.id)}
    >
      <span style={{
        width: 20, height: 20, borderRadius: "50%",
        background: c.border,
        color: toast.type === "success" ? "#050505" : "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, flexShrink: 0,
      }}>
        {c.icon}
      </span>
      {toast.message}
    </div>
  );
}
