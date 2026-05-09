import { useEffect, useState } from "react";

/**
 * Decorative signal-strength meter. Drifts slowly, reacts to `boost` impulses.
 * Pure visual — no real signal measurement.
 */
export function SignalMeter({ boost = 0 }: { boost?: number }) {
  const [level, setLevel] = useState(0.62);

  useEffect(() => {
    let tick = 0;
    const i = setInterval(() => {
      tick += 1;
      setLevel((l) => {
        const drift = Math.sin(tick * 1.37) * 0.04;
        return Math.max(0.35, Math.min(0.95, l + drift));
      });
    }, 350);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (boost > 0) setLevel(0.95);
  }, [boost]);

  const bars = 8;
  const active = Math.round(level * bars);

  return (
    <div className="flex items-end gap-[2px] h-3" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`w-[3px] transition-all duration-200 ${
            i < active ? "bg-signal" : "bg-border"
          }`}
          style={{ height: `${30 + (i / bars) * 70}%` }}
        />
      ))}
    </div>
  );
}