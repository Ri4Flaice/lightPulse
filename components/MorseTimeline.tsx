"use client";
import { useMemo } from "react";
import { morseToTimeline, totalDuration, type TimingConfig } from "@/lib/morse";

type Props = {
  sequence: string;
  cfg: TimingConfig;
  playing: boolean;
  currentIndex: number;
};

export default function MorseTimeline({ sequence, cfg, playing, currentIndex }: Props) {
  const timeline = useMemo(() => morseToTimeline(sequence, cfg), [sequence, cfg]);
  const total = totalDuration(timeline) || 1;

  let onCounter = -1;
  return (
    <div className="morse-timeline">
      {timeline.map((step, i) => {
        const w = (step.dur / total) * 100;
        const isOn = step.type === "on";
        if (isOn) onCounter++;
        const active = playing && isOn && onCounter === currentIndex;
        return (
          <div
            key={i}
            className={`mtl-step ${isOn ? "on" : "off"} ${active ? "active" : ""}`}
            style={{ width: `${w}%` }}
            title={`${isOn ? "ON" : "OFF"} · ${step.dur}ms · ${step.symbol}`}
          />
        );
      })}
    </div>
  );
}
