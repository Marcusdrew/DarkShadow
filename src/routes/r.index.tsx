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
import { supabase } from "@/integrations/supabase/external";
import {
  decryptMessage,
  deriveRoomKey,
  encryptMessage,
  roomFingerprint as computeRoomFp,
  roomPublicId,
  isValidRoomSecret,
  signMessage,
  verifyMessage,
  pseudoFromFingerprint,
} from "@/lib/crypto";
import { getIdentity, wipeIdentity } from "@/lib/identity";
import type { Identity } from "@/lib/identity";
import { alertSound, clickSound, pingSound } from "@/lib/audio";
import { toast } from "sonner";
import { ShieldCheck, Shield, LogOut, Calculator, Send, Link as LinkIcon } from "lucide-react";
import { canRevealChannel } from "@/lib/privacy-policy";

export const Route = createFileRoute("/r/")({
  head: () => ({
    meta: [
      { title: "CipherRoom — Canal actif" },
      { name: "description", content: "Salon chiffré éphémère." },
      { property: "og:title", content: "CipherRoom — Canal actif" },
      { property: "og:description", content: "Conversation chiffrée dans un canal temporaire CipherRoom." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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

const SHIELD_HOLD_MS = 3200;
const ROOM_SECRET_KEY = "cipherroom:room-secret";
/** Plaintext limit so the ciphertext stays under the database limit (16 000 base64 chars). */
const MAX_MESSAGE_CHARS = 4000;
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
    ((e.ctrlKey || e.metaKey || e.altKey) && key === "printscreen") ||
    (e.metaKey && ["s", "printscreen"].includes(key))
  );
}

type SecurityEventType = "capture" | "hidden" | "visible" | "pagehide";

function RoomPage() {
  const nav = useNavigate();
  // The room secret lives in the URL fragment: it never reaches the server.
  const [secret, setSecret] = useState<string | null>(null);
  // Public room id (one-way hash of the secret): the only identifier the server ever sees.
  const [roomId, setRoomId] = useState<string | null>(null);
  const [hashChecked, setHashChecked] = useState(false);

  const [booting, setBooting] = useState(true);
  const finishBoot = useCallback(() => setBooting(false), []);
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
  const [sending, setSending] = useState(false);
  const [roomClosedReason, setRoomClosedReason] = useState<"expired" | "full" | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const intensityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef(0);
  const logSeq = useRef(0);
  const shieldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shieldLocked = useRef(false);
  const joinedRef = useRef(false);
  const knownParticipants = useRef<Set<string>>(new Set());

  // Room secret: read it from the URL fragment once, then remove it from the address bar and
  // browser history (history sync, shared devices) and keep it in this tab's sessionStorage only.
  useEffect(() => {
    const read = () => {
      const raw = window.location.hash.replace(/^#/, "").trim();
      let decoded = "";
      try {
        decoded = raw ? decodeURIComponent(raw) : "";
      } catch {
        decoded = "";
      }
      let found: string | null = isValidRoomSecret(decoded) ? decoded : null;
      if (found) {
        try {
          sessionStorage.setItem(ROOM_SECRET_KEY, found);
        } catch {
          /* storage unavailable: secret stays in memory only */
        }
      } else if (!raw) {
        try {
          const stored = sessionStorage.getItem(ROOM_SECRET_KEY);
          if (stored && isValidRoomSecret(stored)) found = stored;
        } catch {
          /* ignore */
        }
      }
      if (raw) window.history.replaceState(window.history.state, "", window.location.pathname);
      setSecret(found);
      setHashChecked(true);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // Derive the public room id from the secret
  useEffect(() => {
    let mounted = true;
    setRoomId(null);
    if (!secret) return;
    roomPublicId(secret).then((id) => {
      if (mounted) setRoomId(id);
    });
    return () => {
      mounted = false;
    };
  }, [secret]);

  // Identity
  useEffect(() => {
    let mounted = true;
    (async () => {
      const id = await getIdentity();
      if (!mounted) return;
      setIdentity(id);
    })();
    return () => {
      mounted = false;
    };
  }, [roomId]);

  // Load room meta
  useEffect(() => {
    if (!roomId || !secret) return;
    let mounted = true;
    (async () => {
      const { data: rows, error } = await supabase.rpc("cr_get_room", { p_room: roomId });
      const data = rows?.[0];
      if (error || !data || new Date(data.expires_at).getTime() <= Date.now()) {
        nav({ to: "/r/expired" });
        return;
      }
      const expectedFp = await computeRoomFp(secret);
      if (data.fingerprint !== expectedFp) {
        // The server returned metadata that does not belong to this secret: never continue.
        toast.error("Empreinte du salon invalide — canal refusé");
        nav({ to: "/r/expired" });
        return;
      }
      if (!data.salt) {
        nav({ to: "/r/expired" });
        return;
      }
      const k = await deriveRoomKey(secret, data.salt);
      if (!mounted) return;
      setKeyReady(k);
      setRoom(data as RoomMeta);
    })();
    return () => {
      mounted = false;
    };
  }, [roomId, secret, nav]);

  const pushLog = useCallback((text: string, kind: SystemEntry["kind"] = "info") => {
    setSystemLog((prev) => {
      logSeq.current = Math.max(logSeq.current, prev[prev.length - 1]?.id ?? 0) + 1;
      return [...prev, { id: logSeq.current, text, kind }];
    });
  }, []);

  const showShield = useCallback(() => {
    document.documentElement.classList.add("capture-active");
    setShielded(true);
  }, []);

  const hideShield = useCallback(() => {
    if (shieldLocked.current || !canRevealChannel(document.visibilityState, document.hasFocus())) return;
    document.documentElement.classList.remove("capture-active");
    setShielded(false);
  }, []);

  const activateShield = useCallback((hold = SHIELD_HOLD_MS) => {
    shieldLocked.current = true;
    showShield();
    if (shieldTimer.current) clearTimeout(shieldTimer.current);
    // Capture-related signals never reveal content on a timer.
    void hold;
  }, [showShield]);

  const lockShield = useCallback(() => {
    shieldLocked.current = true;
    if (shieldTimer.current) clearTimeout(shieldTimer.current);
    showShield();
  }, [showShield]);

  const resumeChannel = useCallback(() => {
    if (!canRevealChannel(document.visibilityState, document.hasFocus())) return;
    shieldLocked.current = false;
    if (shieldTimer.current) clearTimeout(shieldTimer.current);
    hideShield();
  }, [hideShield]);

  const broadcastSecurity = useCallback((type: SecurityEventType) => {
    if (!channelRef.current || !identity || !joinedRef.current) return;
    void channelRef.current.send({
      type: "broadcast",
      event: "security",
      payload: {
        type,
        fp: identity.fingerprint,
        pseudo: identity.pseudo,
        at: Date.now(),
      },
    });
  }, [identity]);

  useEffect(() => () => {
    if (shieldTimer.current) clearTimeout(shieldTimer.current);
    document.documentElement.classList.remove("capture-active");
    document.documentElement.classList.remove("private-channel");
  }, []);

  // Join + load + realtime
  useEffect(() => {
    if (!identity || !keyReady || !room || !roomId) return;

    let cancelled = false;
    joinedRef.current = false;
    pushLog("▸ liaison montante établie", "ok");
    pushLog(`▸ session ${identity.pseudo} (fp ${identity.fingerprint.slice(0, 8)})`);

    const init = async () => {
      // Join (or re-join) through the server function, which checks fingerprint = hash(pubkey).
      const { error: joinError } = await supabase.rpc("cr_join_room", {
        p_room: roomId,
        p_fingerprint: identity.fingerprint,
        p_pseudo: identity.pseudo,
        p_pubkey: identity.pubkeyB64,
      });
      if (joinError) {
        const message = joinError.message.toLowerCase();
        if (message.includes("room_participant_limit_reached")) {
          setRoomClosedReason("full");
          toast.error("Canal complet");
          return;
        }
        if (message.includes("room_expired")) {
          setRoomClosedReason("expired");
          nav({ to: "/r/expired" });
          return;
        }
        throw joinError;
      }
      joinedRef.current = true;

      await refreshParticipants();

      const { data: mData } = await supabase.rpc("cr_list_messages", { p_room: roomId });
      if (mData && !cancelled) {
        const decrypted: Msg[] = [];
        for (const m of mData) {
          const msg = await openMessage(m, false);
          if (msg) {
            seenIds.current.add(m.id);
            decrypted.push(msg);
          }
        }
        if (!cancelled) setMessages(decrypted);
      }
    };

    // Participants are always re-read from the server: a broadcast is only a hint.
    const refreshParticipants = async () => {
      const { data: pData } = await supabase.rpc("cr_list_participants", { p_room: roomId });
      if (cancelled || !pData) return;
      const next = (pData as Array<{ fingerprint: string; joined_at: string }>).map((p) => ({
        fingerprint: p.fingerprint,
        pseudo: pseudoFromFingerprint(p.fingerprint),
        joined_at: p.joined_at,
      }));
      const known = knownParticipants.current;
      for (const p of next) {
        if (known.size > 0 && !known.has(p.fingerprint) && p.fingerprint !== identity.fingerprint) {
          pushLog(`▸ ${p.pseudo} a rejoint le canal`, "ok");
          pingSound();
        }
      }
      knownParticipants.current = new Set(next.map((p: Participant) => p.fingerprint));
      setParticipants(next);
    };

    // Verify the signature (fingerprint = hash(pubkey), signed room+iv+ciphertext), then decrypt.
    // Anything that fails is dropped silently: it was not written by a room participant.
    const openMessage = async (
      m: {
        id: string;
        sender_fingerprint: string;
        sender_pubkey: string;
        ciphertext: string;
        iv: string;
        signature: string;
        created_at: string;
        expires_at: string | null;
      },
      fresh: boolean,
    ): Promise<Msg | null> => {
      if (!m || typeof m.id !== "string" || typeof m.ciphertext !== "string") return null;
      const ok = await verifyMessage(roomId, m.sender_fingerprint, m.sender_pubkey, m.iv, m.ciphertext, m.signature);
      if (!ok) return null;
      try {
        const text = await decryptMessage(keyReady, m.ciphertext, m.iv);
        return {
          id: m.id,
          pseudo: pseudoFromFingerprint(m.sender_fingerprint),
          fingerprint: m.sender_fingerprint,
          text,
          createdAt: new Date(m.created_at).getTime(),
          expiresAt: m.expires_at ? new Date(m.expires_at).getTime() : null,
          fresh,
        };
      } catch {
        return null;
      }
    };
    init();

    const channel = supabase
      .channel(`room:${roomId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "message" }, async (payload) => {
        if (!joinedRef.current) return;
        const m = payload.payload as Parameters<typeof openMessage>[0];
        if (!m?.id || seenIds.current.has(m.id)) return;
        const isMine = m.sender_fingerprint === identity.fingerprint;
        const msg = await openMessage(m, !isMine);
        if (!msg || seenIds.current.has(m.id)) return;
        seenIds.current.add(m.id);
        setMessages((prev) => [...prev, msg]);
        pulse();
        if (!isMine) pingSound();
      })
      .on("broadcast", { event: "participant" }, () => {
        if (!joinedRef.current) return;
        void refreshParticipants();
      })
      .on("broadcast", { event: "typing" }, (payload) => {
        if (!joinedRef.current) return;
        const fp = (payload.payload as { fp?: string })?.fp;
        if (!fp || fp === identity.fingerprint) return;
        setTypingPeers((prev) => ({ ...prev, [fp]: Date.now() }));
      })
      .on("broadcast", { event: "security" }, (payload) => {
        if (!joinedRef.current) return;
        const event = payload.payload as {
          type?: SecurityEventType | "room_expired";
          fp?: string;
          pseudo?: string;
        };
        if (!event.fp || event.fp === identity.fingerprint) return;
        if (event.type === "room_expired") {
          // Any peer can send this event: only close if the server confirms it.
          void (async () => {
            const { data } = await supabase.rpc("cr_get_room", { p_room: roomId });
            if (!data?.[0] || new Date(data[0].expires_at).getTime() <= Date.now()) {
              setRoomClosedReason("expired");
              setMessages([]);
              setInput("");
              toast("⏱ Le canal a expiré", { description: "Tous les messages ont été dissipés." });
              nav({ to: "/r/expired" });
            }
          })();
          return;
        }
        const who = /^[0-9a-f]{16}$/.test(event.fp) ? pseudoFromFingerprint(event.fp) : "un poste";
        if (event.type === "capture") {
          pushLog(`⚠ protection activée chez ${who} (capture possible)`, "warn");
          alertSound();
          return;
        }
        if (event.type === "hidden" || event.type === "pagehide") {
          pushLog(`⚠ ${who} a quitté la fenêtre`, "warn");
          alertSound();
          return;
        }
        if (event.type === "visible") pushLog(`▸ ${who} est revenu`, "info");
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
  }, [identity, keyReady, nav, pushLog, room, roomId]);

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
    if (!room || !roomId) return;
    const expireAt = new Date(room.expires_at).getTime();
    const closeRoom = () => {
      setRoomClosedReason("expired");
      setMessages([]);
      setInput("");
      toast("⏱ Le canal a expiré", { description: "Tous les messages ont été dissipés." });
      if (channelRef.current && identity && joinedRef.current) {
        void channelRef.current.send({
          type: "broadcast",
          event: "security",
          payload: { type: "room_expired", fp: identity.fingerprint, pseudo: identity.pseudo, at: Date.now() },
        });
      }
      nav({ to: "/r/expired" });
    };
    const verifyStillOpen = async () => {
      const { data, error } = await supabase.rpc("cr_get_room", { p_room: roomId });
      if (error) return; // transient network error: retry on the next tick
      if (!data?.[0] || new Date(data[0].expires_at).getTime() <= Date.now()) closeRoom();
    };
    if (expireAt <= Date.now()) {
      closeRoom();
      return;
    }
    const t = setTimeout(closeRoom, expireAt - Date.now());
    const i = setInterval(verifyStillOpen, 5000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [identity, room, roomId, nav]);

  // Visibility + capture shortcut detection
  useEffect(() => {
    if (!identity) return;
    document.documentElement.classList.add("private-channel");
    if (!canRevealChannel(document.visibilityState, document.hasFocus())) lockShield();
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        lockShield();
        broadcastSecurity("hidden");
        pushLog(`⚠ ${identity.pseudo} a quitté la fenêtre (capture possible)`, "warn");
        alertSound();
      } else {
        broadcastSecurity("visible");
        pushLog(`▸ ${identity.pseudo} est de retour`, "info");
      }
    };
    const onBlur = () => lockShield();
    // Never reveal automatically: the app-switcher or capture preview may still be open.
    const onFocus = () => {};
    const onBeforePrint = () => {
      lockShield();
      broadcastSecurity("capture");
      pushLog("⚠ impression détectée — contenu masqué", "warn");
      alertSound();
    };
    const onAfterPrint = () => lockShield();
    const onPageHide = () => {
      lockShield();
      broadcastSecurity("pagehide");
    };
    // ---- Mobile (Android / iOS) capture heuristics ----
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const mobileCapture = (label: string) => {
      lockShield();
      broadcastSecurity("capture");
      pushLog(`⚠ ${label} — contenu masqué`, "warn");
      alertSound();
    };
    // Multiple touches are only a possible capture gesture, never proof of a screenshot.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 3) mobileCapture("geste multitactile — capture possible");
    };
    // Keyboard and browser chrome resize the viewport during normal messaging.
    // Resizing alone is not a capture signal; lifecycle interruptions still mask immediately.
    const onFreeze = () => lockShield();
    const onResume = () => lockShield();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) lockShield();
    };
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea")) return;
      event.preventDefault();
    };
    const onCaptureKey = (e: KeyboardEvent) => {
      if (!isCaptureShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      activateShield(6500);
      broadcastSecurity("capture");
      pushLog("⚠ tentative de capture masquée", "warn");
      alertSound();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("keydown", onCaptureKey, true);
    window.addEventListener("keyup", onCaptureKey, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    if (coarse) {
      window.addEventListener("touchstart", onTouchStart, { passive: true });
      document.addEventListener("freeze", onFreeze);
      document.addEventListener("resume", onResume);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("keydown", onCaptureKey, true);
      window.removeEventListener("keyup", onCaptureKey, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      window.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onResume);
    };
  }, [activateShield, broadcastSecurity, identity, lockShield, pushLog]);

  // Keep the composer inside the visible area, including while the mobile keyboard is open.
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      document.documentElement.style.setProperty("--channel-height", `${viewport?.height ?? window.innerHeight}px`);
      document.documentElement.style.setProperty("--channel-top", `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--channel-height");
      document.documentElement.style.removeProperty("--channel-top");
    };
  }, []);

  const leaveChannel = () => {
    joinedRef.current = false;
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    try { sessionStorage.removeItem(ROOM_SECRET_KEY); } catch { /* unavailable storage */ }
    setMessages([]);
    setInput("");
    setSecret(null);
    shieldLocked.current = false;
    document.documentElement.classList.remove("capture-active");
    void nav({ to: "/" });
  };

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
    if (sending || shielded || !input.trim() || !keyReady || !identity || !room || !roomId) return;
    if (new Date(room.expires_at).getTime() <= Date.now() || roomClosedReason) {
      setRoomClosedReason("expired");
      toast.error("Canal fermé");
      return;
    }
    const text = input;
    setSending(true);
    setInput("");
    pulse();
    clickSound();
    try {
      if (text.length > MAX_MESSAGE_CHARS) {
        toast.error("Message trop long");
        setInput(text);
        return;
      }
      const { ciphertext, iv } = await encryptMessage(keyReady, text);
      const signature = await signMessage(identity.privKey, roomId, iv, ciphertext);
      // The server sets the timestamps and the expiry from the room's TTL, then broadcasts.
      const { data: posted, error } = await supabase.rpc("cr_post_message", {
        p_room: roomId,
        p_fingerprint: identity.fingerprint,
        p_ciphertext: ciphertext,
        p_iv: iv,
        p_signature: signature,
      });
      if (error) {
        if (error.message.includes("rate_limited")) toast.error("Trop de messages — patientez quelques secondes");
        throw error;
      }
      // Show our own message right away (the DB broadcast is deduplicated by id).
      const row = posted?.[0];
      if (row && !seenIds.current.has(row.id)) {
        seenIds.current.add(row.id);
        setMessages((prev) => [
          ...prev,
          {
            id: row.id,
            pseudo: identity.pseudo,
            fingerprint: identity.fingerprint,
            text,
            createdAt: new Date(row.created_at).getTime(),
            expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
            fresh: false,
          },
        ]);
      }
    } catch (e) {
      console.error(e);
      toast.error("Échec de l'envoi");
      setInput(text);
    } finally {
      setSending(false);
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
    // The secret stays in the fragment so it never appears in server logs or Referer headers.
    const url = `${window.location.origin}/r/#${secret}`;
    await navigator.clipboard.writeText(url);
    toast.success("Lien d'invitation copié");
    pushLog("▸ lien d'invitation copié dans le presse-papiers", "ok");
  };

  if (panic) return <PanicOverlay onClose={() => nav({ to: "/" })} />;

  if (roomClosedReason === "full") {
    return <ClosedRoomState title="Canal complet" detail="La limite de participants définie pour ce canal est atteinte." />;
  }

  if (booting) return <BootSequence onDone={finishBoot} />;

  if (hashChecked && !secret) {
    return (
      <ClosedRoomState
        title="Lien invalide"
        detail="Ce lien ne contient aucun secret de canal. Demandez une nouvelle invitation."
      />
    );
  }

  if (!room || !identity || !keyReady || !roomId || !secret) {
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
    <div className="fixed inset-x-0 top-[var(--channel-top,0px)] h-[var(--channel-height,100dvh)] flex flex-col scan-lines crt-flicker overflow-hidden">
      <Oscilloscope intensity={intensity} className="absolute inset-0 w-full h-full opacity-25" />
      <HexStream aria-hidden="true" className="absolute top-0 left-0 right-0 h-3" />
      <HexStream aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-3" />

      {/* Header */}
      <header className="relative z-10 shrink-0 border-b border-border/60 bg-background/70 backdrop-blur px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
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
            <div className="font-mono text-[10px] text-muted-foreground flex items-center gap-2 whitespace-nowrap">
              <span>{participants.length}/{room.max_participants}</span>
              <span>·</span>
              <RoomExpiry iso={room.expires_at} />
              <span className="hidden sm:flex items-center gap-1">
                · <SignalMeter boost={boost} />
              </span>
            </div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={leaveChannel} className="sm:order-last gap-2" aria-label="Sortir du canal">
          <LogOut aria-hidden="true" /> Sortir
        </Button>
        <div className="flex w-full sm:w-auto gap-2 items-center shrink-0">
          <AudioToggle compact />
          <Button size="sm" variant="outline" onClick={lockShield} title="Masquer le canal" aria-label="Masquer le canal" className="h-10 w-10 p-0">
            <Shield aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs h-10 px-3"
            onClick={copyInvite}
            title="Copier le lien d'invitation"
            aria-label="Copier le lien d'invitation"
          >
            <span className="hidden sm:inline">INVITER</span>
            <LinkIcon className="sm:hidden" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs h-10 px-3"
            onClick={() => setVerifyOpen(true)}
            title="Vérifier les empreintes"
            aria-label="Vérifier les empreintes"
          >
            <span className="hidden sm:inline">VÉRIFIER</span>
            <span className="sm:hidden">✓</span>
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="font-mono text-xs h-10 px-3 ml-auto sm:ml-0"
            onClick={triggerPanic}
            title="Mode panique : calculatrice"
            aria-label="Mode panique : calculatrice"
          >
            <Calculator aria-hidden="true" />
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
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 space-y-3">
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
            {systemLog.length > 0 && (
              <details className="md:hidden border-t border-border/50 py-2 space-y-1">
                <summary className="font-mono text-[10px] text-muted-foreground cursor-pointer">
                  Activité du canal
                </summary>
                {systemLog.slice(-4).map((l) => (
                  <div
                    key={l.id}
                    className={`font-mono text-[10px] leading-snug animate-fade-in-up break-words ${
                      l.kind === "warn" ? "text-destructive" : "text-amber-deep"
                    }`}
                  >
                    {l.text}
                  </div>
                ))}
              </details>
            )}
          </div>

          {/* Typing indicator */}
          <div className="px-4 sm:px-6 h-6 shrink-0 flex items-center gap-3 overflow-hidden">
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
          <div
            className="shrink-0 border-t border-border/60 bg-background/80 backdrop-blur px-3 pt-3 sm:p-4"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            <div className="flex gap-2 items-end">
              <textarea
                aria-label="Message"
                maxLength={MAX_MESSAGE_CHARS}
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
                className="flex-1 min-w-0 resize-none bg-card/50 border border-border/60 rounded-md px-3 py-2.5 font-serif text-bone text-base max-h-32 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
              />
              <Button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={send}
                disabled={!input.trim() || shielded || sending}
                aria-label="Envoyer le message"
                className="font-mono h-11 w-12 shrink-0 rounded-md"
              >
                <Send aria-hidden="true" />
              </Button>
            </div>
            <div className="font-mono text-[9px] text-muted-foreground/60 tracking-widest mt-2 flex justify-between gap-2">
              <span>
                {room.message_ttl_seconds > 0
                  ? `AUTO-DESTRUCT ${room.message_ttl_seconds}s`
                  : "PERSIST SESSION"}
              </span>
              <span className="hidden sm:inline">CTRL+. = PANIC</span>
            </div>
          </div>
        </div>
      </div>

      <VerifyDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        secret={secret}
        roomFingerprint={room.fingerprint}
      />

      {shielded && (
        <div role="dialog" aria-modal="true" aria-labelledby="shield-title" className="fixed inset-0 z-[2147483647] capture-shield flex flex-col items-center justify-center text-center px-6">
          <div id="shield-title" className="font-mono text-xs text-primary tracking-[0.4em] mb-4">
            ◉ CANAL VERROUILLÉ
          </div>
          <div className="font-serif italic text-bone/60 text-sm max-w-xs">
            Conversation masquée.
          </div>
          <Button autoFocus onClick={resumeChannel} className="mt-6 gap-2">
            <ShieldCheck aria-hidden="true" /> Reprendre le canal
          </Button>
        </div>
      )}
    </div>
  );
}

function ClosedRoomState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden scan-lines capture-shield">
      <Oscilloscope intensity={0.08} className="absolute inset-0 w-full h-full opacity-10" />
      <HexStream className="absolute top-0 left-0 right-0 h-3" />
      <HexStream className="absolute bottom-0 left-0 right-0 h-3" />
      <div className="relative z-10 max-w-md text-center">
        <div className="font-mono text-[10px] text-destructive tracking-[0.4em] mb-4">
          ◉ ACCESS DENIED
        </div>
        <h1 className="font-serif text-5xl text-bone mb-4 italic glitch-text" data-text={title}>
          {title}
        </h1>
        <p className="font-serif text-muted-foreground mb-8">{detail}</p>
        <a
          href="/"
          className="font-mono text-sm text-primary glow-amber tracking-widest hover:opacity-80"
        >
          ▸ RETOUR AU TERMINAL
        </a>
      </div>
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
        style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
        className={`max-w-[85%] sm:max-w-[75%] relative rounded-md px-3.5 py-2 font-serif text-[15px] sm:text-base leading-relaxed overflow-hidden break-words whitespace-pre-wrap [overflow-wrap:anywhere] shadow-sm ${
          mine
            ? "bg-primary/15 border border-primary/30 text-bone rounded-br-sm"
            : "bg-card/70 border border-border/60 text-bone rounded-bl-sm"
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