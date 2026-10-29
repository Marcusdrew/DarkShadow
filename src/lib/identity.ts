import { generateIdentity, importPrivateKey, pseudoFromFingerprint, fingerprintOfPubkey } from "./crypto";

export interface Identity {
  fingerprint: string;
  pseudo: string;
  pubkeyB64: string;
  privKey: CryptoKey;
}

interface StoredIdentity {
  fingerprint: string;
  pubkeyB64: string;
  privJwk: JsonWebKey;
}

const KEY = "cipherroom:identity:v2";

let cached: Identity | null = null;

/** Per-tab identity (sessionStorage): survives a reload, dies with the tab or a panic wipe. */
export async function getIdentity(): Promise<Identity> {
  if (cached) return cached;
  if (typeof window === "undefined") {
    throw new Error("Identity only available in browser");
  }
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as StoredIdentity;
      if ((await fingerprintOfPubkey(s.pubkeyB64)) === s.fingerprint) {
        cached = {
          fingerprint: s.fingerprint,
          pseudo: pseudoFromFingerprint(s.fingerprint),
          pubkeyB64: s.pubkeyB64,
          privKey: await importPrivateKey(s.privJwk),
        };
        return cached;
      }
    }
  } catch {
    /* fall through: generate a fresh identity */
  }
  const id = await generateIdentity();
  cached = {
    fingerprint: id.fingerprint,
    pseudo: pseudoFromFingerprint(id.fingerprint),
    pubkeyB64: id.pubkeyB64,
    privKey: id.privKey,
  };
  try {
    const stored: StoredIdentity = { fingerprint: id.fingerprint, pubkeyB64: id.pubkeyB64, privJwk: id.privJwk };
    sessionStorage.setItem(KEY, JSON.stringify(stored));
    sessionStorage.removeItem("cipherroom:identity");
  } catch {
    /* storage unavailable: identity lives in memory only */
  }
  return cached;
}

export function wipeIdentity() {
  cached = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  }
}
