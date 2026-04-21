import { Link, createFileRoute } from "@tanstack/react-router";
import { Oscilloscope } from "@/components/Oscilloscope";
import { HexStream } from "@/components/HexStream";

export const Route = createFileRoute("/r/$roomId/expired")({
  component: ExpiredPage,
});

function ExpiredPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden scan-lines">
      <Oscilloscope intensity={0.1} className="absolute inset-0 w-full h-full opacity-15" />
      <HexStream className="absolute top-0 left-0 right-0 h-3" />
      <HexStream className="absolute bottom-0 left-0 right-0 h-3" />
      <div className="relative z-10 max-w-md text-center">
        <div className="font-mono text-[10px] text-destructive tracking-[0.4em] mb-4">
          ◉ CHANNEL CLOSED
        </div>
        <h1 className="font-serif text-5xl text-bone mb-4 italic glitch-text" data-text="Le canal s'est refermé.">
          Le canal s'est refermé.
        </h1>
        <p className="font-serif text-muted-foreground mb-8">
          Tous les messages ont été dissipés. Aucune trace n'a été conservée.
        </p>
        <pre className="font-mono text-[10px] text-muted-foreground/40 mb-8 select-none leading-tight">
{`░▒▓░  silence  ░▒▓░
   end of transmission`}
        </pre>
        <Link
          to="/"
          className="font-mono text-sm text-primary glow-amber tracking-widest hover:opacity-80"
        >
          ▸ OUVRIR UN NOUVEAU CANAL
        </Link>
      </div>
    </div>
  );
}
