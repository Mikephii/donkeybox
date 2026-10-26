/**
 * Viewers may watch canvases but not change them. The door's identity check sets X-Wb-Role on the
 * Yjs upgrade request; for a viewer, incoming sync step 2 and update messages (the ones that carry
 * changes) are dropped, while step 1 (asking for state) and awareness (cursor and presence) pass.
 * Connections without the header come from the app itself on loopback.
 */
export function viewerFilter(data: Uint8Array): boolean {
  // y-protocols: varUint message type (0 = sync, 1 = awareness), then for sync a varUint subtype
  // (0 = step 1, 1 = step 2, 2 = update). Both fit in one byte.
  return !(data[0] === 0 && (data[1] === 1 || data[1] === 2));
}
