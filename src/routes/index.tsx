import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Oscilloscope } from "@/components/Oscilloscope";
import { HexStream } from "@/components/HexStream";
import { SignalMeter } from "@/components/SignalMeter";
import { AudioToggle } from "@/components/AudioToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getIdentity } from "@/lib/identity";
import type { Identity } from "@/lib/identity";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CipherRoom — messagerie chiffrée éphémère" },
      {
        name: "description",
        content:
          "Salons de discussion anonymes, chiffrés de bout en bout, qui s'effacent. Aucun compte. Aucun journal.",
      },
      { property: "og:title", content: "CipherRoom — messagerie chiffrée éphémère" },
      {
        property: "og:description",
        content: "Salons anonymes chiffrés. Le canal s'efface.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [joinId, setJoinId] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const [coords, setCoords] = useState<{ lat: string; lon: string } | null>(null);

  useEffect(() => {
    getIdentity().then(setIdentity);
    setNow(new Date());
    setCoords({
      lat: (Math.random() * 180 - 90).toFixed(4),
      lon: (Math.random() * 360 - 180).toFixed(4),
    });
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden scan-lines crt-flicker">
      <Oscilloscope className="absolute inset-0 w-full h-full opacity-60" />

      {/* Top hex stream */}
      <HexStream className="absolute top-0 left-0 right-0 h-4 mt-2" />
      <HexStream className="absolute bottom-0 left-0 right-0 h-4 mb-2" />

      {/* Header */}
      <header className="relative z-10 px-6 sm:px-10 py-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative w-2 h-2 rounded-full bg-signal pulse-ring" />
          <div className="font-mono text-xs tracking-[0.3em] text-primary glow-amber breathe">
            CIPHERROOM
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AudioToggle />
          <Link
            to="/about"
            className="font-mono text-xs text-muted-foreground hover:text-primary transition-colors tracking-widest"
          >
            ABOUT
          </Link>
        </div>
      </header>

      {/* Live status bar */}
      <div className="relative z-10 px-6 sm:px-10 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] text-muted-foreground tracking-[0.2em]">
        <span>UTC {now ? now.toISOString().slice(11, 19) : "--:--:--"}</span>
        <span>LAT {coords?.lat ?? "--"}° · LON {coords?.lon ?? "--"}°</span>
        <span className="flex items-center gap-2">SIG <SignalMeter /></span>
        <span className="text-signal">◉ NO LOGS</span>
      </div>

      {/* Main */}
      <main className="relative z-10 px-6 sm:px-10 pt-8 sm:pt-16 pb-20 max-w-3xl mx-auto">
        <div className="font-mono text-[10px] text-signal tracking-[0.4em] mb-6 animate-fade-in-up">
          ◉ SECURE CHANNEL // V1
        </div>

        <h1 className="font-serif text-5xl sm:text-7xl text-bone leading-[0.95] mb-8 animate-fade-in-up">
          <span className="glitch-text" data-text="Le canal s'ouvre.">Le canal s'ouvre.</span>
          <br />
          <span className="text-primary glow-amber italic">Puis s'efface.</span>
        </h1>

        <p className="font-serif text-lg sm:text-xl text-muted-foreground max-w-xl mb-12 leading-relaxed animate-fade-in-up">
          Une salle de discussion chiffrée. Anonyme. Éphémère. Pas de compte,
          pas de profil, pas d'historique. Juste un lien, une clé, et le silence
          quand vous partez.
        </p>

        {/* Identity card */}
        {identity && (
          <div className="mb-10 inline-flex flex-col gap-1 border border-border/60 bg-card/40 backdrop-blur px-4 py-3 rounded-md font-mono text-xs animate-fade-in-up">
            <div className="text-muted-foreground tracking-widest text-[10px]">
              IDENTITÉ DE SESSION
            </div>
            <div className="text-bone text-base">{identity.pseudo}</div>
            <div className="text-amber-deep text-[11px]">
              fp: {identity.fingerprint}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <Button
            asChild
            size="lg"
            className="font-mono tracking-wider h-14 px-8 text-base"
          >
            <Link to="/new">▸ OUVRIR UN CANAL</Link>
          </Button>

          <form
            className="flex gap-2 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const id = joinId.trim();
              if (id) window.location.href = `/r/${id}`;
            }}
          >
            <Input
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              placeholder="coller un lien d'invitation…"
              className="h-14 font-mono text-sm bg-card/40 backdrop-blur border-border/60"
            />
            <Button
              type="submit"
              variant="outline"
              size="lg"
              className="h-14 font-mono tracking-wider"
            >
              REJOINDRE
            </Button>
          </form>
        </div>

        {/* ASCII signature */}
        <pre className="font-mono text-[9px] text-muted-foreground/40 leading-tight mt-16 select-none hidden sm:block">
{`  ▒▒░  ░▒▓  signal interception terminal  ▓▒░  ░▒▒
  ░    chiffré · sans trace · entre nous     ░`}
        </pre>

        {/* Honest disclaimer */}
        <div className="mt-12 text-xs text-muted-foreground border-l-2 border-amber-deep/60 pl-4 max-w-md font-serif italic">
          CipherRoom est une expérience artistique et technique. Pour des
          besoins critiques de confidentialité, utilisez Signal.
        </div>
      </main>
    </div>
  );
}
