type Props = { size?: "sm" | "md" | "lg" | "xl"; showSub?: boolean };

const SIZES = { sm: 12, md: 14, lg: 18, xl: 26 } as const;

export default function Logo({ size = "md", showSub = false }: Props) {
  const fs = SIZES[size];
  return (
    <div className="lp-logo" style={{ gap: fs * 0.7 }}>
      <span className="lp-mark" style={{ height: fs * 0.95, gap: fs * 0.22 }}>
        <span className="d" style={{ width: fs * 0.28, height: fs * 0.28 }} />
        <span className="d" style={{ width: fs * 0.28, height: fs * 0.28 }} />
        <span className="h" style={{ width: fs * 1.0, height: fs * 0.28 }} />
      </span>
      <span className="lp-name" style={{ fontSize: fs }}>
        Light<span>Pulse</span>
      </span>
      {showSub && (
        <span
          className="tag-mono"
          style={{ marginLeft: 8, paddingLeft: 10, borderLeft: "1px solid var(--line-strong)" }}
        >
          v1.0 · MVP
        </span>
      )}
    </div>
  );
}
