import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$roomId/expired")({
  component: ExpiredPage,
});

function ExpiredPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="font-mono text-[10px] text-destructive tracking-[0.4em] mb-4">
          ◉ CHANNEL CLOSED
        </div>
        <h1 className="font-serif text-5xl text-bone mb-4 italic">
          Le canal s'est refermé.
        </h1>
        <p className="font-serif text-muted-foreground mb-8">
          Tous les messages ont été dissipés. Aucune trace n'a été conservée.
        </p>
        <pre className="font-mono text-[10px] text-muted-foreground/40 mb-8 select-none">
{`░▒▓  silence  ▓▒░`}
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
