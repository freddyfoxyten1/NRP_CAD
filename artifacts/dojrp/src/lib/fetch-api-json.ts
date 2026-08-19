/** Parse an API response as JSON. HTML (SPA/nginx fallback) is a common VPS miss. */
export async function readApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<")) {
    throw new Error(
      res.status === 404 || res.ok
        ? "This feature is not on the live VPS yet. The local API must handle it."
        : `Request failed (${res.status}). The server returned a web page instead of data.`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The server returned an unexpected response.");
  }
}
