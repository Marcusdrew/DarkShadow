import { useEffect, useState } from "react";
import { disableAudio, enableAudio, isAudioEnabled } from "@/lib/audio";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AudioToggle({ className = "", compact = false }: { className?: string; compact?: boolean }) {
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
    <Button
      type="button"
      variant="outline"
      onClick={toggle}
      title={on ? "Couper le signal audio" : "Activer le signal audio"}
      aria-label={on ? "Couper le signal audio" : "Activer le signal audio"}
      aria-pressed={on}
      className={`font-mono text-[10px] ${compact ? "h-10 w-10 p-0" : "px-2 py-1"} rounded border transition-all ${
        on
          ? "border-signal/60 text-signal glow-signal"
          : "border-border/60 text-muted-foreground hover:text-bone"
      } ${className}`}
    >
      {compact ? (on ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />) : (on ? "◉ AUDIO ON" : "○ AUDIO OFF")}
    </Button>
  );
}