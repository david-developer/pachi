const listingId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only operator configuration can choose the web origin; listing data cannot. */
export function webListingUrl(origin: string | undefined, id: string): string | null {
  if (!origin || !/^https?:\/\//i.test(origin) || !listingId.test(id)) return null;
  try {
    const url = new URL(origin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      origin.trim() !== origin ||
      /[\u0000-\u0020\u007f\\]/.test(origin) ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/"
    ) return null;
    return `${url.origin}/listings/${id}`;
  } catch {
    return null;
  }
}
