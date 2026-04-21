import { useEffect, useState } from "react";
import { disableAudio, enableAudio, isAudioEnabled } from "@/lib/audio";

export function AudioToggle({ className = "" }: { className?: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(isAudioEnabled());
  }, []);

  const toggle = async () => {
    if (on) {
      disableAudio();
      setOn(false);
    } else {
      await enableAudio();
      setOn(true);
    }
  };

  return (
    <button
      onClick={toggle}
      title={on ? "Couper le signal audio" : "Activer le signal audio"}
      className={`font-mono text-[10px] tracking-[0.25em] px-2 py-1 rounded border transition-all ${
        on
          ? "border-signal/60 text-signal glow-signal"
          : "border-border/60 text-muted-foreground hover:text-bone"
      } ${className}`}
    >
      {on ? "◉ AUDIO ON" : "○ AUDIO OFF"}
    </button>
  );
}