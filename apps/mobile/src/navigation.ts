import {
  parseQueryParams,
  serializeQuery,
  validateQuery,
} from "./data/marketplace";

/** A public search return route is data, never an arbitrary redirect target. */
export function safeReturnTo(
  value: string | string[] | undefined,
): "/" | "/listings" | `/listings?${string}` {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return "/listings";
  try {
    const url = new URL(value, "https://pachi.invalid");
    if (url.origin !== "https://pachi.invalid" || url.hash) return "/listings";
    if (url.pathname === "/" && !url.search) return "/";
    if (url.pathname !== "/listings") return "/listings";
    const result = validateQuery(parseQueryParams(url.searchParams));
    if (Object.keys(result.errors).length) return "/listings";
    delete result.query.cursor;
    const search = serializeQuery(result.query).toString();
    return search ? `/listings?${search}` : "/listings";
  } catch {
    return "/listings";
  }
}
