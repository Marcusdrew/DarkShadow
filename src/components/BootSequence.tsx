import { useEffect, useState } from "react";

const LINES = [
  "> initiating secure handshake...",
  "> generating ephemeral keypair (P-256)...",
  "> deriving room cipher (AES-256-GCM)...",
  "> jamming uplink frequencies...",
  "> scrubbing metadata trails...",
  "> channel established. you are invisible.",
];

export function BootSequence({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState<string[]>([]);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      if (i >= LINES.length) {
        setTimeout(onDone, 600);
        return;
      }
      setShown((prev) => [...prev, LINES[i]]);
      i++;
      setTimeout(tick, 380 + Math.random() * 220);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
        setSkipped(true);
        onDone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  if (skipped) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background cursor-pointer"
      onClick={() => {
        setSkipped(true);
        onDone();
      }}
    >
      <div className="font-mono text-sm text-primary glow-amber max-w-lg w-full px-6">
        <div className="text-xs text-muted-foreground mb-4 tracking-widest">
          [ CIPHERROOM // SECURE CHANNEL ]
        </div>
        {shown.map((l, i) => (
          <div key={i} className="animate-fade-in-up">
            {l}
          </div>
        ))}
        <div className="text-bone typewriter-cursor inline-block mt-1" />
        <div className="mt-8 text-[10px] text-muted-foreground tracking-widest">
          <span className="hidden sm:inline">press ESC to skip</span>
          <span className="sm:hidden">▸ tap anywhere to skip</span>
        </div>
      </div>
    </div>
  );
}
