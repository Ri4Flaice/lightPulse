"use client";

type Props = { sequence: string; currentIndex: number; playing: boolean };

type Char =
  | { kind: "."; stepIdx: number }
  | { kind: "-"; stepIdx: number }
  | { kind: "sp" }
  | { kind: "wp" };

export default function MorseGlyphs({ sequence, currentIndex, playing }: Props) {
  const chars: Char[] = [];
  let stepIdx = -1;

  for (let i = 0; i < sequence.length; i++) {
    const c = sequence[i];
    if (c === "." || c === "-") {
      stepIdx++;
      chars.push({ kind: c, stepIdx });
    } else if (c === " ") {
      chars.push({ kind: "sp" });
    } else if (c === "/") {
      chars.push({ kind: "wp" });
    }
  }

  return (
    <div className="morse-glyphs">
      {chars.map((c, i) => {
        if (c.kind === "sp") return <span key={i} className="mg-sp" />;
        if (c.kind === "wp") return <span key={i} className="mg-wp">/</span>;
        const isActive = playing && c.stepIdx === currentIndex;
        return (
          <span
            key={i}
            className={`mg-pip ${c.kind === "." ? "dot" : "dash"} ${isActive ? "active" : ""}`}
          />
        );
      })}
    </div>
  );
}
