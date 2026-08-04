import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fingerprintToWords } from "@/lib/crypto";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roomId: string;
  roomFingerprint: string;
}

export function VerifyDialog({ open, onOpenChange, roomId, roomFingerprint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState("");
  const words = fingerprintToWords(roomFingerprint, 4);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = `${window.location.origin}/r/#${roomId}`;
    setUrl(u);
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, u, {
        width: 220,
        margin: 1,
        color: { dark: "#e8c179", light: "#00000000" },
      }).catch(console.error);
    }
  }, [open, roomId]);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    toast.success("Lien copié");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/60">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm tracking-widest text-signal">
            ◉ VÉRIFIER LE CANAL
          </DialogTitle>
          <DialogDescription className="font-serif italic">
            Partagez ce lien et cette empreinte pour que vos pairs vérifient qu'ils sont
            bien sur le même canal.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <canvas ref={canvasRef} className="rounded-md bg-background/40 p-2" />

          <div className="font-mono text-xs text-muted-foreground tracking-widest">
            EMPREINTE DU SALON
          </div>
          <div className="font-mono text-base text-primary glow-amber">
            {roomFingerprint.match(/.{1,4}/g)?.join(" ")}
          </div>

          <div className="font-mono text-xs text-muted-foreground tracking-widest mt-2">
            MOTS DE SÉCURITÉ
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            {words.map((w, i) => (
              <span
                key={i}
                className="font-serif text-bone bg-secondary px-3 py-1 rounded text-sm"
              >
                {w}
              </span>
            ))}
          </div>

          <Button onClick={copy} variant="outline" className="mt-4 font-mono">
            Copier le lien
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
