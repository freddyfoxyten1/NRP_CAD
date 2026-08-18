/** Pull a Google Doc file id from a share/edit URL or a raw id. */
export function parseGoogleDocId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const fromDocs = raw.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
  if (fromDocs?.[1] && fromDocs[1] !== "e") return fromDocs[1];
  const fromDrive = raw.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/);
  if (fromDrive?.[1]) return fromDrive[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  return null;
}
