type Props = { live?: boolean; label: string };

export default function StatusChip({ live, label }: Props) {
  return (
    <span className={`chip ${live ? "live" : ""}`}>
      <span className="dot" />
      {label}
    </span>
  );
}
