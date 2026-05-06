"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";

export default function LoginForm() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setErr(true);
        setTimeout(() => setErr(false), 600);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin">
      <div className="admin-bar">
        <Logo size="md" />
      </div>
      <div className="login-wrap">
        <form className="login-card scale-in" onSubmit={submit}>
          <div>
            <span className="tag-mono">/admin · v1.0</span>
            <h2 style={{ marginTop: 8 }}>Доступ к консоли</h2>
            <p style={{ marginTop: 6 }}>
              Управление ритмом, последовательностью и параметрами передатчика.
            </p>
          </div>
          <div className="field">
            <label>
              Пароль <span className="hint">MVP · simple auth</span>
            </label>
            <input
              type="password"
              className="input mono"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••••"
              style={
                err
                  ? { borderColor: "var(--danger)", animation: "shake 200ms" }
                  : undefined
              }
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ height: 44 }}
            disabled={submitting}
          >
            Войти →
          </button>
          <p className="hint" style={{ textAlign: "center", opacity: 0.6 }}>
            HTTPS · validated · session-scoped
          </p>
        </form>
      </div>
    </div>
  );
}
