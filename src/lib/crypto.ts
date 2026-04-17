/**
 * CipherRoom crypto utilities.
 *
 * Hybrid model:
 * - Each room has a symmetric AES-GCM key derived from the room id (shared secret in URL)
 *   plus a random salt published with the room. Anyone with the URL can decrypt.
 * - Each participant generates an ECDSA keypair for identity (fingerprint).
 *
 * NOTE: This is "simple E2EE" — the room id IS the shared secret. Server never sees plaintext.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof input === "string" ? enc.encode(input) : input;
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

/** Derive an AES-GCM CryptoKey from the room id (shared secret). */
export async function deriveRoomKey(roomId: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(roomId),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("cipherroom:v1:salt"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptMessage(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );
  return { ciphertext: toB64(ct), iv: toB64(iv) };
}

export async function decryptMessage(
  key: CryptoKey,
  ciphertextB64: string,
  ivB64: string,
): Promise<string> {
  const ct = fromB64(ciphertextB64);
  const iv = fromB64(ivB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(pt);
}

/** Compute the room fingerprint (public, shareable) from the room id. */
export async function roomFingerprint(roomId: string): Promise<string> {
  const h = await sha256("cipherroom:fp:" + roomId);
  return toHex(h).slice(0, 16);
}

/** Generate an ECDSA identity keypair (P-256). */
export async function generateIdentity(): Promise<{
  pubkeyB64: string;
  fingerprint: string;
  privKey: CryptoKey;
  pubKey: CryptoKey;
}> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  const pubkeyB64 = toB64(raw);
  const fp = await sha256(new Uint8Array(raw));
  return {
    pubkeyB64,
    fingerprint: toHex(fp).slice(0, 16),
    privKey: kp.privateKey,
    pubKey: kp.publicKey,
  };
}

/** Stylish pseudonym from fingerprint. */
const ADJECTIVES = [
  "ember", "shadow", "amber", "static", "ghost", "echo", "drift", "cipher",
  "whisper", "neon", "rust", "velvet", "iron", "silent", "hollow", "vapor",
];
const NOUNS = [
  "fox", "owl", "wolf", "raven", "moth", "wren", "lynx", "stag",
  "heron", "viper", "hawk", "crane", "otter", "marten", "shrike", "ibis",
];

export function pseudoFromFingerprint(fp: string): string {
  const a = parseInt(fp.slice(0, 4), 16) % ADJECTIVES.length;
  const n = parseInt(fp.slice(4, 8), 16) % NOUNS.length;
  const num = parseInt(fp.slice(8, 12), 16) % 10000;
  return `${ADJECTIVES[a]}-${NOUNS[n]}-${num.toString().padStart(4, "0")}`;
}

/** Short verification words from fingerprint (BIP39-ish). */
const WORDLIST = [
  "anchor", "bramble", "candle", "drift", "ember", "frost", "glade", "harbor",
  "ivory", "jasper", "kestrel", "lantern", "marrow", "nimbus", "onyx", "petal",
  "quartz", "river", "silent", "thorn", "umbra", "violet", "willow", "xenon",
  "yarrow", "zephyr", "amber", "basalt", "cinder", "dune", "echo", "feather",
];

export function fingerprintToWords(fp: string, count = 4): string[] {
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = parseInt(fp.slice(i * 2, i * 2 + 2), 16) % WORDLIST.length;
    words.push(WORDLIST[idx]);
  }
  return words;
}
