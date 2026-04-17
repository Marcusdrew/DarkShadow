import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Oscilloscope } from "@/components/Oscilloscope";
import { HexStream } from "@/components/HexStream";
import { BootSequence } from "@/components/BootSequence";
import { DecryptingText } from "@/components/DecryptingText";
import { VerifyDialog } from "@/components/VerifyDialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  decryptMessage,
  deriveRoomKey,
  encryptMessage,
  roomFingerprint as computeRoomFp,
} from "@/lib/crypto";
import { getIdentity } from "@/lib/identity";
import type { Identity } from "@/lib/identity";
import { wipeIdentity } from "@/lib/identity";
import { toast } from "sonner";

export const Route = createFileRoute("/r/$roomId")({
  head: ({ params }) => ({
    meta: [
      { title: `Canal ${params.roomId.slice(0, 8)} — CipherRoom` },
      { name: "description", content: "Salon chiffré éphémère." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RoomPage,
});

interface Msg {
  id: string;
  pseudo: string;
  fingerprint: string;
  text: string;
  createdAt: number;
  expiresAt: number | null;
  fresh: boolean; // animate decrypt
}

interface RoomMeta {
  expires_at: string;
  message_ttl_seconds: number;
  fingerprint: string;
  max_participants: number;
}

interface Participant {
  fingerprint: string;
  pseudo: string;
  joined_at: string;
}

function RoomPage() {
  const { roomId } = Route.useParams();
  const nav = useNavigate();

  const [booting, setBooting] = useState(true);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [keyReady, setKeyReady] = useState<CryptoKey | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [intensity, setIntensity] = useState(0.4);
  const [systemLog, setSystemLog] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const intensityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  // Identity + key
  useEffect(() => {
    let mounted = true;
    (async () => {
      const id = await getIdentity();
      if (!mounted) return;
      setIdentity(id);
      const k = await deriveRoomKey(roomId);
      if (!mounted) return;
      setKeyReady(k);
    })();
    return () => {
      mounted = false;
    };
  }, [roomId]);

  // Load room
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("expires_at, message_ttl_seconds, fingerprint, max_participants")
        .eq("id", roomId)
        .maybeSingle();
      if (error || !data) {
        nav({ to: "/r/$roomId/expired", params: { roomId } });
        return;
      }
      const expectedFp = await computeRoomFp(roomId);
      if (data.fingerprint !== expectedFp) {
        toast.error("Empreinte du salon invalide");
      }
      setRoom(data as RoomMeta);
    })();
  }, [roomId, nav]);

  // Join + load participants + messages + realtime
  useEffect(() => {
    if (!identity || !keyReady || !room) return;

    let cancelled = false;

    const init = async () => {
      // Upsert participant
      await supabase.from("room_participants").upsert(
        {
          room_id: roomId,
          fingerprint: identity.fingerprint,
          pseudo: identity.pseudo,
          pubkey: identity.pubkeyB64,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "room_id,fingerprint" },
      );

      // Load participants
      const { data: pData } = await supabase
        .from("room_participants")
        .select("fingerprint, pseudo, joined_at")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      if (!cancelled && pData) setParticipants(pData as Participant[]);

      // Load existing messages
      const { data: mData } = await supabase
        .from("messages")
        .select("id, sender_pseudo, sender_fingerprint, ciphertext, iv, created_at, expires_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true });
      if (mData && !cancelled) {
        const decrypted: Msg[] = [];
        for (const m of mData) {
          try {
            const text = await decryptMessage(keyReady, m.ciphertext, m.iv);
            seenIds.current.add(m.id);
            decrypted.push({
              id: m.id,
              pseudo: m.sender_pseudo,
              fingerprint: m.sender_fingerprint,
              text,
              createdAt: new Date(m.created_at).getTime(),
              expiresAt: m.expires_at ? new Date(m.expires_at).getTime() : null,
              fresh: false,
            });
          } catch {
            /* skip undecryptable */
          }
        }
        if (!cancelled) setMessages(decrypted);
      }
    };
    init();

    // Realtime
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const m = payload.new as {
            id: string;
            sender_pseudo: string;
            sender_fingerprint: string;
            ciphertext: string;
            iv: string;
            created_at: string;
            expires_at: string | null;
          };
          if (seenIds.current.has(m.id)) return;
          seenIds.current.add(m.id);
          try {
            const text = await decryptMessage(keyReady, m.ciphertext, m.iv);
            const isMine = m.sender_fingerprint === identity.fingerprint;
            setMessages((prev) => [
              ...prev,
              {
                id: m.id,
                pseudo: m.sender_pseudo,
                fingerprint: m.sender_fingerprint,
                text,
                createdAt: new Date(m.created_at).getTime(),
                expiresAt: m.expires_at ? new Date(m.expires_at).getTime() : null,
                fresh: !isMine,
              },
            ]);
            pulse();
          } catch {
            /* ignore */
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_participants",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const p = payload.new as Participant;
          setParticipants((prev) =>
            prev.some((x) => x.fingerprint === p.fingerprint) ? prev : [...prev, p],
          );
          if (p.fingerprint !== identity.fingerprint) {
            pushLog(`▸ ${p.pseudo} a rejoint le canal`);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [identity, keyReady, room, roomId]);

  // Auto-expire messages
  useEffect(() => {
    const i = setInterval(() => {
      const now = Date.now();
      setMessages((prev) => prev.filter((m) => !m.expiresAt || m.expiresAt > now));
    }, 1000);
    return () => clearInterval(i);
  }, []);

  // Room expiration check
  useEffect(() => {
    if (!room) return;
    const check = () => {
      if (new Date(room.expires_at).getTime() < Date.now()) {
        nav({ to: "/r/$roomId/expired", params: { roomId } });
      }
    };
    const i = setInterval(check, 5000);
    return () => clearInterval(i);
  }, [room, roomId, nav]);

  // Visibility detection
  useEffect(() => {
    if (!identity) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        pushLog(`⚠ ${identity.pseudo} a quitté la fenêtre (capture possible)`);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [identity]);

  // Panic key: Ctrl+.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ".") {
        e.preventDefault();
        wipeIdentity();
        setMessages([]);
        document.documentElement.innerHTML = `
          <html><head><title>Calculator</title></head>
          <body style="margin:0;background:#f0f0f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;">
            <div style="background:white;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);">
              <input value="0" style="width:200px;padding:10px;font-size:24px;text-align:right;border:1px solid #ddd;" readonly />
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:10px;">
                ${["7","8","9","÷","4","5","6","×","1","2","3","-","0",".","=","+"].map(k=>`<button style="padding:15px;font-size:18px;border:1px solid #ddd;background:white;cursor:pointer;">${k}</button>`).join("")}
              </div>
            </div>
          </body></html>`;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, systemLog.length]);

  const pulse = useCallback(() => {
    setIntensity(0.95);
    if (intensityTimer.current) clearTimeout(intensityTimer.current);
    intensityTimer.current = setTimeout(() => setIntensity(0.4), 600);
  }, []);

  const pushLog = (line: string) => {
    setSystemLog((prev) => [...prev, line]);
  };

  const send = async () => {
    if (!input.trim() || !keyReady || !identity || !room) return;
    const text = input;
    setInput("");
    pulse();
    try {
      const { ciphertext, iv } = await encryptMessage(keyReady, text);
      const expiresAt =
        room.message_ttl_seconds > 0
          ? new Date(Date.now() + room.message_ttl_seconds * 1000).toISOString()
          : null;
      const { error } = await supabase.from("messages").insert({
        room_id: roomId,
        sender_fingerprint: identity.fingerprint,
        sender_pseudo: identity.pseudo,
        ciphertext,
        iv,
        expires_at: expiresAt,
      });
      if (error) throw error;
    } catch (e) {
      console.error(e);
      toast.error("Échec de l'envoi");
      setInput(text);
    }
  };

  const onInputChange = (v: string) => {
    setInput(v);
    pulse();
  };

  if (booting) {
    return <BootSequence onDone={() => setBooting(false)} />;
  }

  if (!room || !identity || !keyReady) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono text-muted-foreground text-sm">
        ◉ établissement du canal…
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col scan-lines overflow-hidden">
      <Oscilloscope intensity={intensity} className="absolute inset-0 w-full h-full opacity-25" />
      <HexStream className="absolute top-0 left-0 right-0 h-3" />
      <HexStream className="absolute bottom-0 left-0 right-0 h-3" />

      {/* Header */}
      <header className="relative z-10 border-b border-border/60 bg-background/70 backdrop-blur px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="font-mono text-[10px] tracking-[0.3em] text-signal breathe shrink-0">
            ◉ LIVE
          </div>
          <div className="min-w-0">
            <div className="font-serif text-bone text-sm sm:text-base truncate">
              Canal{" "}
              <span className="font-mono text-primary glow-amber text-xs">
                {room.fingerprint.slice(0, 8)}
              </span>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {participants.length}/{room.max_participants} · expire{" "}
              <RoomExpiry iso={room.expires_at} />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => setVerifyOpen(true)}
          >
            VÉRIFIER
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="relative z-10 flex-1 flex min-h-0">
        {/* Participants */}
        <aside className="hidden md:flex w-56 border-r border-border/60 bg-background/40 backdrop-blur flex-col p-4 gap-2 shrink-0">
          <div className="font-mono text-[10px] text-muted-foreground tracking-[0.3em] mb-2">
            PARTICIPANTS
          </div>
          {participants.map((p) => (
            <div key={p.fingerprint} className="font-mono text-xs animate-fade-in-up">
              <div className="text-bone">
                {p.fingerprint === identity.fingerprint ? "▸ " : "  "}
                {p.pseudo}
              </div>
              <div className="text-amber-deep text-[10px] ml-3">{p.fingerprint.slice(0, 12)}</div>
            </div>
          ))}
          <pre className="font-mono text-[8px] text-muted-foreground/30 mt-auto select-none leading-tight">
{`░▒▓ secure ▓▒░
   no logs
   no trace`}
          </pre>
        </aside>

        {/* Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
            {messages.length === 0 && systemLog.length === 0 && (
              <div className="font-serif italic text-muted-foreground text-center py-12">
                Le canal est ouvert. Premier signal en attente…
              </div>
            )}
            {messages.map((m) => (
              <Message key={m.id} m={m} mine={m.fingerprint === identity.fingerprint} />
            ))}
            {systemLog.map((l, i) => (
              <div
                key={i}
                className="font-mono text-[11px] text-amber-deep italic animate-fade-in-up"
              >
                {l}
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="border-t border-border/60 bg-background/70 backdrop-blur p-3 sm:p-4">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="transmettre…"
                rows={1}
                className="flex-1 resize-none bg-card/40 border border-border/60 rounded-md px-3 py-2 font-serif text-bone text-sm focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
              />
              <Button
                onClick={send}
                disabled={!input.trim()}
                className="font-mono tracking-wider self-end"
              >
                ▸
              </Button>
            </div>
            <div className="font-mono text-[9px] text-muted-foreground/60 tracking-widest mt-2 flex justify-between">
              <span>
                {room.message_ttl_seconds > 0
                  ? `AUTO-DESTRUCT ${room.message_ttl_seconds}s`
                  : "PERSIST SESSION"}
              </span>
              <span>CTRL+. = PANIC</span>
            </div>
          </div>
        </div>
      </div>

      <VerifyDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        roomId={roomId}
        roomFingerprint={room.fingerprint}
      />
    </div>
  );
}

function Message({ m, mine }: { m: Msg; mine: boolean }) {
  const [done, setDone] = useState(!m.fresh);

  return (
    <div
      className={`flex flex-col gap-1 animate-fade-in-up ${mine ? "items-end" : "items-start"}`}
    >
      <div className="font-mono text-[10px] text-muted-foreground tracking-wider px-1">
        {mine ? "▸ vous" : m.pseudo}
        <span className="text-amber-deep/60 ml-2">{m.fingerprint.slice(0, 8)}</span>
        {m.expiresAt && (
          <span className="ml-2 text-destructive/70">
            <Countdown to={m.expiresAt} />
          </span>
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-md px-4 py-2 font-serif text-base leading-relaxed ${
          mine
            ? "bg-primary/15 border border-primary/30 text-bone"
            : "bg-card/60 border border-border/60 text-bone"
        }`}
      >
        {done ? (
          m.text
        ) : (
          <DecryptingText text={m.text} onDone={() => setDone(true)} />
        )}
      </div>
    </div>
  );
}

function Countdown({ to }: { to: number }) {
  const [left, setLeft] = useState(Math.max(0, Math.ceil((to - Date.now()) / 1000)));
  useEffect(() => {
    const i = setInterval(
      () => setLeft(Math.max(0, Math.ceil((to - Date.now()) / 1000))),
      500,
    );
    return () => clearInterval(i);
  }, [to]);
  return <span>{left}s</span>;
}

function RoomExpiry({ iso }: { iso: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((x) => x + 1), 30_000);
    return () => clearInterval(i);
  }, []);
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return <span>maintenant</span>;
  const m = Math.floor(ms / 60000);
  if (m < 60) return <span>dans {m}m</span>;
  const h = Math.floor(m / 60);
  return <span>dans {h}h</span>;
}
