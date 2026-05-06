export type TimingConfig = {
  dotDuration: number;
  dashDuration: number;
  symbolPause: number;
  wordPause: number;
};

export type TimelineStep = {
  type: "on" | "off";
  dur: number;
  symbol: "." | "-" | "i" | "s" | "w";
};

export const MORSE_MAP: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.",
  G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
  M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
  S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
  А: ".-", Б: "-...", В: ".--", Г: "--.", Д: "-..", Е: ".",
  Ж: "...-", З: "--..", И: "..", Й: ".---", К: "-.-", Л: ".-..",
  М: "--", Н: "-.", О: "---", П: ".--.", Р: ".-.", С: "...",
  Т: "-", У: "..-", Ф: "..-.", Х: "....", Ц: "-.-.", Ч: "---.",
  Ш: "----", Щ: "--.-", Ъ: "--.--", Ы: "-.--", Ь: "-..-", Э: "..-..",
  Ю: "..--", Я: ".-.-",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "!": "-.-.--", "/": "-..-.",
};

export function textToMorse(text: string): string {
  if (!text) return "";
  return text
    .toUpperCase()
    .split(" ")
    .map((word) =>
      word.split("").map((ch) => MORSE_MAP[ch] || "").filter(Boolean).join(" ")
    )
    .filter(Boolean)
    .join(" / ");
}

export function morseToTimeline(sequence: string, cfg: TimingConfig): TimelineStep[] {
  const { dotDuration, dashDuration, symbolPause, wordPause } = cfg;
  const out: TimelineStep[] = [];
  const groups = sequence.trim().split(/\s+\/\s+|\s\/\s|\/+/);

  groups.forEach((group, gi) => {
    const letters = group.trim().split(/\s+/).filter(Boolean);
    letters.forEach((letter, li) => {
      const chars = letter.split("");
      chars.forEach((c, ci) => {
        if (c === ".") out.push({ type: "on", dur: dotDuration, symbol: "." });
        else if (c === "-") out.push({ type: "on", dur: dashDuration, symbol: "-" });
        if (ci < chars.length - 1) out.push({ type: "off", dur: dotDuration, symbol: "i" });
      });
      if (li < letters.length - 1) out.push({ type: "off", dur: symbolPause, symbol: "s" });
    });
    if (gi < groups.length - 1) out.push({ type: "off", dur: wordPause, symbol: "w" });
  });
  return out;
}

export function totalDuration(timeline: TimelineStep[]): number {
  return timeline.reduce((s, t) => s + t.dur, 0);
}
