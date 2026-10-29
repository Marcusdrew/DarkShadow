/**
 * CipherRoom crypto utilities.
 *
 * Model:
 * - Each room has a random 256-bit SECRET that only lives in the URL fragment (#...).
 *   It is never sent to the server.
 * - The server only sees a PUBLIC room id = truncated SHA-256 of the secret (one-way),
 *   formatted as a UUID. It cannot recover the secret nor derive the key.
 * - The AES-GCM key is derived (PBKDF2) from the secret and a per-room salt.
 * - Each participant generates an ECDSA P-256 keypair. fingerprint = SHA-256(pubkey)[0..16 hex].
 *   Every message is signed; clients drop messages whose signature or fingerprint is invalid,
 *   and pseudos are always re-derived from the fingerprint (never trusted from the network).
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
  const data: BufferSource =
    typeof input === "string"
      ? enc.encode(input)
      : (input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

/** Generate a random room secret (256 bits, base64url, 43 chars). Lives in the URL fragment only. */
export function generateRoomSecret(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function isValidRoomSecret(s: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(s);
}

/** Public room id sent to the server: SHA-256("cipherroom:id:" + secret), 128 bits, as a UUID-shaped string. */
export async function roomPublicId(secret: string): Promise<string> {
  const h = toHex(await sha256("cipherroom:id:" + secret)).slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Generate a random, per-room PBKDF2 salt (base64). Salts need not be secret, only unique. */
export function generateRoomSalt(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Derive an AES-GCM CryptoKey from the room secret and the room's salt.
 * `salt` is the base64 value stored with the room (required).
 */
export async function deriveRoomKey(
  secret: string,
  salt: string,
): Promise<CryptoKey> {
  if (!salt) throw new Error("missing_room_salt");
  const saltBytes: Uint8Array = fromB64(salt);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("cipherroom:key:" + secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes as BufferSource,
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
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return dec.decode(pt);
}

/** Compute the room fingerprint (public, shareable) from the room secret. */
export async function roomFingerprint(secret: string): Promise<string> {
  const h = await sha256("cipherroom:fp:" + secret);
  return toHex(h).slice(0, 16);
}

/** Fingerprint of a raw P-256 public key: first 16 hex chars of SHA-256. */
export async function fingerprintOfPubkey(pubkeyB64: string): Promise<string> {
  return toHex(await sha256(fromB64(pubkeyB64))).slice(0, 16);
}

/** Generate an ECDSA identity keypair (P-256). The private key is exported as JWK so the
 *  identity survives a reload within the same tab (sessionStorage), like before. */
export async function generateIdentity(): Promise<{
  pubkeyB64: string;
  fingerprint: string;
  privJwk: JsonWebKey;
  privKey: CryptoKey;
}> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  const pubkeyB64 = toB64(raw);
  const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return {
    pubkeyB64,
    fingerprint: await fingerprintOfPubkey(pubkeyB64),
    privJwk,
    privKey: kp.privateKey,
  };
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

function signedPayload(roomId: string, iv: string, ciphertext: string): Uint8Array {
  return enc.encode(`cipherroom:msg:v1|${roomId}|${iv}|${ciphertext}`);
}

/** Sign a message (binds it to the room, its IV and its ciphertext). */
export async function signMessage(
  privKey: CryptoKey,
  roomId: string,
  iv: string,
  ciphertext: string,
): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privKey,
    signedPayload(roomId, iv, ciphertext) as BufferSource,
  );
  return toB64(sig);
}

/**
 * Verify that a message was signed by the owner of `fingerprint`: the public key must hash to
 * the fingerprint, and the signature must be valid for this room, IV and ciphertext.
 */
export async function verifyMessage(
  roomId: string,
  fingerprint: string,
  pubkeyB64: string,
  iv: string,
  ciphertext: string,
  signatureB64: string,
): Promise<boolean> {
  try {
    if ((await fingerprintOfPubkey(pubkeyB64)) !== fingerprint) return false;
    const pub = await crypto.subtle.importKey(
      "raw",
      fromB64(pubkeyB64) as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      fromB64(signatureB64) as BufferSource,
      signedPayload(roomId, iv, ciphertext) as BufferSource,
    );
  } catch {
    return false;
  }
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
