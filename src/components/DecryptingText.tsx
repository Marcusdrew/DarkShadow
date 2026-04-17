import { useEffect, useState } from "react";

const HEX = "0123456789abcdef";

function randomHex(len: number) {
  let s = "";
  for (let i = 0; i < len; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}

/**
 * Reveals text character by character, prior chars displayed as random hex
 * that "stabilize" into the real glyph. Cinematic deciphering effect.
 */
export function DecryptingText({
  text,
  speed = 28,
  onDone,
}: {
  text: string;
  speed?: number;
  onDone?: () => void;
}) {
  const [revealed, setRevealed] = useState(0);
  const [scramble, setScramble] = useState("");

  useEffect(() => {
    setRevealed(0);
  }, [text]);

  useEffect(() => {
    if (revealed >= text.length) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => setRevealed((r) => r + 1), speed);
    return () => clearTimeout(t);
  }, [revealed, text.length, speed, onDone]);

  useEffect(() => {
    const i = setInterval(() => {
      setScramble(randomHex(Math.max(0, text.length - revealed)));
    }, 60);
    return () => clearInterval(i);
  }, [revealed, text.length]);

  return (
    <span>
      <span>{text.slice(0, revealed)}</span>
      <span className="text-amber-deep opacity-60 font-mono text-sm">
        {scramble.slice(0, Math.min(8, scramble.length))}
      </span>
    </span>
  );
}
