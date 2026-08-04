function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function generateRoomSaltServer(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Same fingerprint derivation as the client (sha256 of "cipherroom:fp:" + id). */
export async function roomFingerprintServer(roomId: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("cipherroom:fp:" + roomId),
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
