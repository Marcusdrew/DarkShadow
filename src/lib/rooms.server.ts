function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function generateRoomSaltServer(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}
