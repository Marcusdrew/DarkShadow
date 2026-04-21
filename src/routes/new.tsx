import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Oscilloscope } from "@/components/Oscilloscope";
import { HexStream } from "@/components/HexStream";
import { supabase } from "@/integrations/supabase/client";
import { roomFingerprint } from "@/lib/crypto";
import { toast } from "sonner";

export const Route = createFileRoute("/new")({
  head: () => ({
    meta: [
      { title: "Ouvrir un canal — CipherRoom" },
      { name: "description", content: "Configurer un nouveau salon chiffré éphémère." },
    ],
  }),
  component: NewRoomPage,
});

const ROOM_DURATIONS = [
  { label: "15 min", value: 15 * 60 },
  { label: "1 heure", value: 60 * 60 },
  { label: "24 heures", value: 24 * 60 * 60 },
];

const TTL_OPTIONS = [
  { label: "session", value: 0 },
  { label: "30 sec", value: 30 },
  { label: "5 min", value: 300 },
];

const MAX_OPTIONS = [2, 4, 8, 16];

function NewRoomPage() {
  const nav = useNavigate();
  const [roomDuration, setRoomDuration] = useState(60 * 60);
  const [ttl, setTtl] = useState(0);
  const [maxP, setMaxP] = useState(8);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const expiresAt = new Date(Date.now() + roomDuration * 1000).toISOString();
      // Pre-generate id so we can compute the fingerprint
      const id = crypto.randomUUID();
      const fp = await roomFingerprint(id);
      const { error } = await supabase.from("rooms").insert({
        id,
        expires_at: expiresAt,
        max_participants: maxP,
        message_ttl_seconds: ttl,
        fingerprint: fp,
      });
      if (error) throw error;
      nav({ to: "/r/$roomId", params: { roomId: id } });
    } catch (e) {
      console.error(e);
      toast.error("Échec de l'ouverture du canal");
      setCreating(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden scan-lines crt-flicker">
      <Oscilloscope className="absolute inset-0 w-full h-full opacity-30" />
      <HexStream className="absolute top-0 left-0 right-0 h-3" />
      <HexStream className="absolute bottom-0 left-0 right-0 h-3" />
      <div className="relative z-10 max-w-2xl mx-auto px-6 py-12">
        <a
          href="/"
          className="font-mono text-xs text-muted-foreground hover:text-primary tracking-widest"
        >
          ← RETOUR
        </a>
        <div className="font-mono text-[10px] text-signal tracking-[0.4em] mb-3">
          ◉ NEW CHANNEL CONFIG
        </div>
        <h1 className="font-serif text-4xl text-bone mb-10">
          Configurer le <span className="text-primary glow-amber italic">canal</span>
        </h1>

        <Section label="Durée de vie du salon">
          <OptionGroup
            options={ROOM_DURATIONS}
            value={roomDuration}
            onChange={setRoomDuration}
          />
        </Section>

        <Section label="Auto-destruction des messages">
          <OptionGroup options={TTL_OPTIONS} value={ttl} onChange={setTtl} />
          <p className="text-xs text-muted-foreground font-serif italic mt-2">
            {ttl === 0
              ? "Les messages persistent jusqu'à la fermeture du salon."
              : `Chaque message s'efface après ${ttl} secondes.`}
          </p>
        </Section>

        <Section label="Participants maximum">
          <OptionGroup
            options={MAX_OPTIONS.map((v) => ({ label: String(v), value: v }))}
            value={maxP}
            onChange={setMaxP}
          />
        </Section>

        <Button
          onClick={handleCreate}
          disabled={creating}
          size="lg"
          className="mt-8 h-14 px-10 font-mono tracking-wider text-base"
        >
          {creating ? "▸ ÉTABLISSEMENT…" : "▸ OUVRIR LE CANAL"}
        </Button>

        <div className="mt-12 border-l-2 border-amber-deep/60 pl-4 max-w-md font-serif italic text-xs text-muted-foreground">
          À l'ouverture, vous recevrez un lien et une empreinte. Le lien <em>est</em>
          la clé : ne le partagez qu'aux personnes de confiance.
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="font-mono text-[10px] text-muted-foreground tracking-[0.3em] mb-3">
        {label.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

function OptionGroup<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`font-mono text-sm px-4 py-2 rounded-md border transition-all ${
            value === o.value
              ? "bg-primary text-primary-foreground border-primary glow-amber"
              : "border-border/60 bg-card/40 text-bone hover:border-primary/50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
