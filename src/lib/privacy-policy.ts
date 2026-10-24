/** A shield may only be explicitly lifted in an active, visible document. */
export function canRevealChannel(visibility: string, focused: boolean): boolean {
  return visibility === "visible" && focused;
}