import { generateIdentity, pseudoFromFingerprint } from "./crypto";

export interface Identity {
  fingerprint: string;
  pseudo: string;
  pubkeyB64: string;
}

const KEY = "cipherroom:identity";

let cached: Identity | null = null;

export async function getIdentity(): Promise<Identity> {
  if (cached) return cached;
  if (typeof window === "undefined") {
    throw new Error("Identity only available in browser");
  }
  const raw = sessionStorage.getItem(KEY);
  if (raw) {
    try {
      cached = JSON.parse(raw) as Identity;
      return cached;
    } catch {
      /* fall through */
    }
  }
  const id = await generateIdentity();
  cached = {
    fingerprint: id.fingerprint,
    pseudo: pseudoFromFingerprint(id.fingerprint),
    pubkeyB64: id.pubkeyB64,
  };
  sessionStorage.setItem(KEY, JSON.stringify(cached));
  return cached;
}

export function wipeIdentity() {
  cached = null;
  if (typeof window !== "undefined") {
    sessionStorage.clear();
  }
}
