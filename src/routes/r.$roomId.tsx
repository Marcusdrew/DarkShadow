import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Oscilloscope } from "@/components/Oscilloscope";
import { HexStream } from "@/components/HexStream";
import { BootSequence } from "@/components/BootSequence";
import { DecryptingText } from "@/components/DecryptingText";
import { VerifyDialog } from "@/components/VerifyDialog";
import { SignalMeter } from "@/components/SignalMeter";
import { AudioToggle } from "@/components/AudioToggle";
import { TypingWaveform } from "@/components/TypingWaveform";
import { PanicOverlay } from "@/components/PanicOverlay";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  decryptMessage,
  deriveRoomKey,
  encryptMessage,
  roomFingerprint as computeRoomFp,
} from "@/lib/crypto";
import { getIdentity, wipeIdentity } from "@/lib/identity";
import type { Identity } from "@/lib/identity";
import { alertSound, clickSound, pingSound } from "@/lib/audio";
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
  fresh: boolean;
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
interface SystemEntry {
  id: number;
  text: string;
  kind: "info" | "warn" | "ok";
}

const SHIELD_HOLD_MS = 1800;
const SCREENSHOT_KEYS = new Set([
  "PrintScreen",
  "F13",
  "AudioVolumeUp",
  "AudioVolumeDown",
  "Power",
]);

function isCaptureShortcut(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  return (
    SCREENSHOT_KEYS.has(e.key) ||
    ((e.metaKey || e.ctrlKey) && e.shiftKey && key === "s") ||
    (e.metaKey && e.shiftKey && ["3", "4", "5"].includes(key)) ||
    ((e.ctrlKey || e.metaKey) && key === "printscreen")
  );
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
  const [systemLog, setSystemLog] = useState<SystemEntry[]>([]);
  const [typingPeers, setTypingPeers] = useState<Record<string, number>>({});
  const [panic, setPanic] = useState(false);
  const [boost, setBoost] = useState(0);
  const [shielded, setShielded] = useState(false);
  const [roomClosedReason, setRoomClosedReason] = useState<"expired" | "full" | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const intensityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef(0);
  const logSeq = useRef(0);
  const shieldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinedRef = useRef(false);

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

  // Load room meta
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("expires_at, message_ttl_seconds, fingerprint, max_participants")
        .eq("id", roomId)
        .maybeSingle();
      if (error || !data || new Date(data.expires_at).getTime() <= Date.now()) {
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

  const pushLog = useCallback((text: string, kind: SystemEntry["kind"] = "info") => {
    logSeq.current += 1;
    setSystemLog((prev) => [...prev, { id: logSeq.current, text, kind }]);
  }, []);

  const activateShield = useCallback((hold = SHIELD_HOLD_MS) => {
    setShielded(true);
    if (shieldTimer.current) clearTimeout(shieldTimer.current);
    shieldTimer.current = setTimeout(() => setShielded(false), hold);
  }, []);

  // Join + load + realtime
  useEffect(() => {
    if (!identity || !keyReady || !room) return;

    let cancelled = false;
    joinedRef.current = false;
    pushLog("▸ liaison montante établie", "ok");
    pushLog(`▸ session ${identity.pseudo} (fp ${identity.fingerprint.slice(0, 8)})`);

    const init = async () => {
      const { error: joinError } = await supabase.from("room_participants").upsert(
        {
          room_id: roomId,
          fingerprint: identity.fingerprint,
          pseudo: identity.pseudo,
          pubkey: identity.pubkeyB64,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "room_id,fingerprint" },
      );
      if (joinError) {
        const message = joinError.message.toLowerCase();
        if (message.includes("room_participant_limit_reached")) {
          setRoomClosedReason("full");
          toast.error("Canal complet");
          return;
        }
        if (message.includes("room_expired")) {
          setRoomClosedReason("expired");
          return;
        }
        throw joinError;
      }
      joinedRef.current = true;

      const { data: pData } = await supabase
        .from("room_participants")
        .select("fingerprint, pseudo, joined_at")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      if (!cancelled && pData) setParticipants(pData as Participant[]);

      const { data: mData } = await supabase
        .from("messages")
        .select(
          "id, sender_pseudo, sender_fingerprint, ciphertext, iv, created_at, expires_at",
        )
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
          } catch { /* ignore */ }
        }
        if (!cancelled) setMessages(decrypted);
      }
    };
    init();

    const channel = supabase
      .channel(`room:${roomId}`, { config: { broadcast: { self: false } } })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          if (!joinedRef.current) return;
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
            if (!isMine) pingSound();
          } catch { /* ignore */ }
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
          if (!joinedRef.current) return;
          const p = payload.new as Participant;
          setParticipants((prev) =>
            prev.some((x) => x.fingerprint === p.fingerprint) ? prev : [...prev, p],
          );
          if (p.fingerprint !== identity.fingerprint) {
            pushLog(`▸ ${p.pseudo} a rejoint le canal`, "ok");
            pingSound();
          }
        },
      )
      .on("broadcast", { event: "typing" }, (payload) => {
        if (!joinedRef.current) return;
        const fp = (payload.payload as { fp?: string })?.fp;
        if (!fp || fp === identity.fingerprint) return;
        setTypingPeers((prev) => ({ ...prev, [fp]: Date.now() }));
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      joinedRef.current = false;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, keyReady, room, roomId]);

  // Auto-expire messages
  useEffect(() => {
    const i = setInterval(() => {
      const now = Date.now();
      setMessages((prev) => prev.filter((m) => !m.expiresAt || m.expiresAt > now));
      setTypingPeers((prev) => {
        const out: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) if (now - v < 2500) out[k] = v;
        return out;
      });
    }, 800);
    return () => clearInterval(i);
  }, []);

  // Room expiration
  useEffect(() => {
    if (!room) return;
    const expireAt = new Date(room.expires_at).getTime();
    const closeRoom = () => {
      setRoomClosedReason("expired");
      setMessages([]);
      setInput("");
      nav({ to: "/r/$roomId/expired", params: { roomId } });
    };
    if (expireAt <= Date.now()) {
      closeRoom();
      return;
    }
    const t = setTimeout(closeRoom, expireAt - Date.now());
    return () => clearTimeout(t);
  }, [room, roomId, nav]);

  // Visibility + capture shortcut detection
  useEffect(() => {
    if (!identity) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        activateShield(4000);
        pushLog(`⚠ ${identity.pseudo} a quitté la fenêtre (capture possible)`, "warn");
        alertSound();
      } else {
        activateShield(900);
        pushLog(`▸ ${identity.pseudo} est de retour`, "info");
      }
    };
    const onBlur = () => activateShield(4000);
    const onFocus = () => activateShield(900);
    const onCaptureKey = (e: KeyboardEvent) => {
      if (!isCaptureShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      activateShield(5000);
      pushLog("⚠ tentative de capture masquée", "warn");
      alertSound();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("keydown", onCaptureKey, true);
    window.addEventListener("keyup", onCaptureKey, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("keydown", onCaptureKey, true);
      window.removeEventListener("keyup", onCaptureKey, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [activateShield, identity, pushLog]);

  // Panic shortcut Ctrl+.
  const triggerPanic = useCallback(() => {
    wipeIdentity();
    setMessages([]);
    setSystemLog([]);
    setPanic(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ".") {
        e.preventDefault();
        triggerPanic();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerPanic]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, systemLog.length]);

  const pulse = useCallback(() => {
    setIntensity(0.95);
    setBoost((b) => b + 1);
    if (intensityTimer.current) clearTimeout(intensityTimer.current);
    intensityTimer.current = setTimeout(() => setIntensity(0.4), 600);
  }, []);

  const send = async () => {
    if (!input.trim() || !keyReady || !identity || !room) return;
    if (new Date(room.expires_at).getTime() <= Date.now() || roomClosedReason) {
      setRoomClosedReason("expired");
      toast.error("Canal fermé");
      return;
    }
    const text = input;
    setInput("");
    pulse();
    clickSound();
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
    clickSound();
    const now = Date.now();
    if (channelRef.current && identity && now - lastTypingSent.current > 800) {
      lastTypingSent.current = now;
      channelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: { fp: identity.fingerprint },
      });
    }
  };

  const copyInvite = async () => {
    const url = `${window.location.origin}/r/${roomId}`;
    await navigator.clipboard.writeText(url);
    toast.success("Lien d'invitation copié");
    pushLog("▸ lien d'invitation copié dans le presse-papiers", "ok");
  };

  if (panic) return <PanicOverlay onClose={() => nav({ to: "/" })} />;

  if (roomClosedReason === "full") {
    return <ClosedRoomState title="Canal complet" detail="La limite de participants définie pour ce canal est atteinte." />;
  }

  if (booting) return <BootSequence onDone={() => setBooting(false)} />;

  if (!room || !identity || !keyReady) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono text-muted-foreground text-sm">
        ◉ établissement du canal…
      </div>
    );
  }

  const typingNames = participants
    .filter((p) => typingPeers[p.fingerprint] && p.fingerprint !== identity.fingerprint)
    .map((p) => p.pseudo);

  return (
    <div className="relative min-h-screen flex flex-col scan-lines crt-flicker overflow-hidden">
      <Oscilloscope intensity={intensity} className="absolute inset-0 w-full h-full opacity-25" />
      <HexStream className="absolute top-0 left-0 right-0 h-3" />
      <HexStream className="absolute bottom-0 left-0 right-0 h-3" />

      {/* Header */}
      <header className="relative z-10 border-b border-border/60 bg-background/70 backdrop-blur px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-2 h-2 rounded-full bg-signal pulse-ring shrink-0" />
          <div className="font-mono text-[10px] tracking-[0.3em] text-signal breathe shrink-0 hidden sm:block">
            LIVE
          </div>
          <div className="min-w-0">
            <div className="font-serif text-bone text-sm sm:text-base truncate">
              Canal{" "}
              <span className="font-mono text-primary glow-amber text-xs">
                {room.fingerprint.slice(0, 8)}
              </span>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground flex items-center gap-2">
              <span>{participants.length}/{room.max_participants}</span>
              <span>·</span>
              <RoomExpiry iso={room.expires_at} />
              <span className="hidden sm:flex items-center gap-1">
                · <SignalMeter boost={boost} />
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <AudioToggle />
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={copyInvite}
          >
            INVITER
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => setVerifyOpen(true)}
          >
            VÉRIFIER
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="font-mono text-xs sm:hidden"
            onClick={triggerPanic}
            title="Effacer et quitter"
          >
            ⌧
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="relative z-10 flex-1 flex min-h-0">
        {/* Participants */}
        <aside className="hidden md:flex w-60 border-r border-border/60 bg-background/40 backdrop-blur flex-col p-4 gap-2 shrink-0">
          <div className="font-mono text-[10px] text-muted-foreground tracking-[0.3em] mb-2 flex items-center justify-between">
            <span>PARTICIPANTS</span>
            <span className="text-signal">◉ {participants.length}</span>
          </div>
          {participants.map((p) => {
            const isMe = p.fingerprint === identity.fingerprint;
            const isTyping = !!typingPeers[p.fingerprint];
            return (
              <div key={p.fingerprint} className="font-mono text-xs animate-fade-in-up">
                <div className={`flex items-center gap-2 ${isMe ? "text-primary" : "text-bone"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isTyping ? "bg-signal" : "bg-amber-deep/60"}`} />
                  <span className="truncate">{isMe ? "vous · " : ""}{p.pseudo}</span>
                </div>
                <div className="text-amber-deep text-[10px] ml-3.5 truncate">
                  {p.fingerprint.slice(0, 16)}
                </div>
              </div>
            );
          })}

          {/* System log */}
          <div className="mt-4 pt-4 border-t border-border/40">
            <div className="font-mono text-[10px] text-muted-foreground tracking-[0.3em] mb-2">
              SYSTEM LOG
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {systemLog.slice(-20).map((l) => (
                <div
                  key={l.id}
                  className={`font-mono text-[10px] leading-snug animate-fade-in-up ${
                    l.kind === "warn"
                      ? "text-destructive"
                      : l.kind === "ok"
                        ? "text-signal"
                        : "text-muted-foreground"
                  }`}
                >
                  {l.text}
                </div>
              ))}
            </div>
          </div>

          <pre className="font-mono text-[8px] text-muted-foreground/30 mt-auto select-none leading-tight">
{`░▒▓ secure ▓▒░
   no logs
   no trace`}
          </pre>
        </aside>

        {/* Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="font-serif italic text-muted-foreground text-center py-12">
                Le canal est ouvert. Premier signal en attente…
              </div>
            )}
            {messages.map((m) => (
              <Message
                key={m.id}
                m={m}
                mine={m.fingerprint === identity.fingerprint}
                ttlSeconds={room.message_ttl_seconds}
              />
            ))}
            {/* Mobile inline log */}
            <div className="md:hidden space-y-1">
              {systemLog.slice(-5).map((l) => (
                <div
                  key={l.id}
                  className={`font-mono text-[10px] italic animate-fade-in-up ${
                    l.kind === "warn" ? "text-destructive" : "text-amber-deep"
                  }`}
                >
                  {l.text}
                </div>
              ))}
            </div>
          </div>

          {/* Typing indicator */}
          <div className="px-4 sm:px-6 h-6 flex items-center gap-3">
            {typingNames.length > 0 && (
              <>
                <div className="w-16 h-4">
                  <TypingWaveform />
                </div>
                <div className="font-mono text-[10px] text-muted-foreground tracking-wider">
                  {typingNames.slice(0, 2).join(", ")}
                  {typingNames.length > 2 ? ` +${typingNames.length - 2}` : ""} transmet…
                </div>
              </>
            )}
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

      {shielded && (
        <div className="fixed inset-0 z-[9998] capture-shield flex flex-col items-center justify-center text-center px-6">
          <div className="font-mono text-xs text-primary tracking-[0.4em] mb-4 breathe">
            ◉ CANAL VERROUILLÉ
          </div>
          <div className="font-serif italic text-bone/60 text-sm max-w-xs">
            Le contenu est masqué tant que la fenêtre n'est pas active.
          </div>
        </div>
      )}
    </div>
  );
}

function Message({
  m,
  mine,
  ttlSeconds,
}: {
  m: Msg;
  mine: boolean;
  ttlSeconds: number;
}) {
  const [done, setDone] = useState(!m.fresh);
  return (
    <div
      className={`flex flex-col gap-1 animate-fade-in-up ${mine ? "items-end" : "items-start"}`}
    >
      <div className="font-mono text-[10px] text-muted-foreground tracking-wider px-1 flex items-center gap-2">
        <span>{mine ? "▸ vous" : m.pseudo}</span>
        <span className="text-amber-deep/60">{m.fingerprint.slice(0, 8)}</span>
        {m.expiresAt && (
          <span className="text-destructive/70">
            <Countdown to={m.expiresAt} total={ttlSeconds} />
          </span>
        )}
      </div>
      <div
        className={`max-w-[80%] relative rounded-md px-4 py-2 font-serif text-base leading-relaxed overflow-hidden ${
          mine
            ? "bg-primary/15 border border-primary/30 text-bone"
            : "bg-card/60 border border-border/60 text-bone"
        }`}
      >
        {done ? m.text : <DecryptingText text={m.text} onDone={() => setDone(true)} />}
        {m.fresh && !done && (
          <div className="absolute inset-x-0 top-0 h-px bg-signal/60 animate-signal-sweep" />
        )}
      </div>
    </div>
  );
}

function Countdown({ to, total }: { to: number; total: number }) {
  const [left, setLeft] = useState(Math.max(0, Math.ceil((to - Date.now()) / 1000)));
  useEffect(() => {
    const i = setInterval(
      () => setLeft(Math.max(0, Math.ceil((to - Date.now()) / 1000))),
      500,
    );
    return () => clearInterval(i);
  }, [to]);
  const pct = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-1 bg-destructive/60 rounded-full"
        style={{ width: `${20 * pct + 4}px` }}
      />
      {left}s
    </span>
  );
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
  if (m < 60) return <span>expire dans {m}m</span>;
  const h = Math.floor(m / 60);
  return <span>expire dans {h}h</span>;
}