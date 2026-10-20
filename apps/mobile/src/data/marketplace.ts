import type {
  PublicListing,
  PublicListingMedia,
  PublicListingQuery,
  PublicListingSearchResponse,
  ReviewCriteria,
  ReviewPublished,
  ReviewPublishedListResponse,
} from "@pachi/contracts";

export type Query = PublicListingQuery;
export type QueryError =
  | "invalid_option"
  | "too_long"
  | "whole_number"
  | "price_range"
  | "invalid_date"
  | "invalid_cursor";
export type QueryErrors = Partial<Record<keyof Query, QueryError>>;
export type MarketplaceErrorCode =
  | "missing"
  | "network"
  | "timeout"
  | "unavailable"
  | "invalid-config"
  | "invalid-query"
  | "aborted";

/** Only safe, local messages are exposed; server responses and URLs are never logged. */
export class MarketplaceError extends Error {
  constructor(public readonly code: MarketplaceErrorCode) {
    super(
      code === "invalid-config"
        ? "Set EXPO_PUBLIC_API_URL to a device-reachable HTTP(S) API base URL, including /v1."
        : `Public marketplace request ${code}.`,
    );
    this.name = "MarketplaceError";
  }
}

const choices = {
  purpose: ["RENT", "SALE", "SHORT_LET"],
  region: ["Southwest", "Littoral"],
  property_type: ["HOUSE", "APARTMENT", "ROOM", "LAND", "COMMERCIAL"],
  furnishing: ["FURNISHED", "UNFURNISHED", "PARTLY_FURNISHED"],
  sort: ["newest", "price_asc", "price_desc"],
} as const;
const keys = [
  "purpose",
  "region",
  "city",
  "neighborhood",
  "property_type",
  "min_price",
  "max_price",
  "min_bedrooms",
  "min_bathrooms",
  "furnishing",
  "available_from",
  "sort",
  "limit",
  "cursor",
] as const;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supportedWidths = [320, 640, 1280, 1920] as const;

/** Router params may contain repeated values. Repeated filters are rejected, never silently selected. */
export function parseQueryParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): Query {
  const input: Record<string, unknown> = {};
  for (const key of keys) {
    const values =
      params instanceof URLSearchParams ? params.getAll(key) : params[key];
    if (Array.isArray(values)) {
      if (values.length === 1) input[key] = values[0];
      else if (values.length > 1) input[key] = "\u0000";
    } else if (values !== undefined) input[key] = values;
  }
  return input as Query;
}

export function validateQuery(input: Query): {
  query: Query;
  errors: QueryErrors;
} {
  const query: Query = { sort: "newest" };
  const errors: QueryErrors = {};
  for (const key of keys) {
    const raw: unknown = input[key];
    if (raw === undefined || raw === "") continue;
    if (typeof raw !== "string") {
      errors[key] = "invalid_option";
      continue;
    }
    const value = key === "cursor" ? raw : raw.trim();
    if (!value) continue;
    // Assign only supported fields; additional input properties cannot reach a request.
    Object.assign(query, { [key]: value });
    if (
      key in choices &&
      !(choices[key as keyof typeof choices] as readonly string[]).includes(
        value,
      )
    )
      errors[key] = "invalid_option";
    if (
      (key === "city" || key === "neighborhood") &&
      (value.length > (key === "city" ? 120 : 160) ||
        /[\u0000-\u001f\u007f]/.test(value))
    )
      errors[key] = "too_long";
    if (
      [
        "min_price",
        "max_price",
        "min_bedrooms",
        "min_bathrooms",
        "limit",
      ].includes(key)
    ) {
      if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        (key === "limit" && (Number(value) < 1 || Number(value) > 20))
      )
        errors[key] = "whole_number";
      else Object.assign(query, { [key]: String(Number(value)) });
    }
    if (key === "available_from" && !isDate(value))
      errors[key] = "invalid_date";
    // A cursor belongs only to the exact search that produced it. Its contents stay opaque.
    if (
      key === "cursor" &&
      (value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value))
    )
      errors[key] = "invalid_cursor";
  }
  if (
    !errors.min_price &&
    !errors.max_price &&
    query.min_price !== undefined &&
    query.max_price !== undefined &&
    Number(query.min_price) > Number(query.max_price)
  )
    errors.max_price = "price_range";
  return { query, errors };
}

export function serializeQuery(input: Query): URLSearchParams {
  const { query, errors } = validateQuery(input);
  if (Object.keys(errors).length) throw new MarketplaceError("invalid-query");
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = query[key];
    if (value !== undefined && !(key === "sort" && value === "newest"))
      params.set(key, value);
  }
  return params;
}

/** Updates a duplicate listing with its newest projection, preserving the first page order. */
export function mergeListings(
  existing: PublicListing[],
  incoming: PublicListing[],
): PublicListing[] {
  return [
    ...new Map(
      [...existing, ...incoming].map((listing) => [listing.id, listing]),
    ).values(),
  ];
}

export function dedupeMedia(media: PublicListingMedia[]): PublicListingMedia[] {
  const result = new Map<string, PublicListingMedia>();
  for (const item of media) if (!result.has(item.id)) result.set(item.id, item);
  return [...result.values()];
}

type Fetch = typeof globalThis.fetch;
export function createMarketplaceClient(
  baseUrl: string | undefined,
  options: { fetch?: Fetch; timeoutMs?: number } = {},
) {
  const base = apiBase(baseUrl);
  const timeoutMs = options.timeoutMs ?? 12_000;
  const request = async (
    path: string,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (!base || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new MarketplaceError("invalid-config");
    if (signal?.aborted) throw new MarketplaceError("aborted");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await (options.fetch ?? globalThis.fetch)(
        `${base}${path}`,
        {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      if (response.status === 404) throw new MarketplaceError("missing");
      if (!response.ok) throw new MarketplaceError("unavailable");
      try {
        return await response.json();
      } catch {
        throw new MarketplaceError("unavailable");
      }
    } catch (error) {
      if (signal?.aborted) throw new MarketplaceError("aborted");
      if (timedOut) throw new MarketplaceError("timeout");
      if (error instanceof MarketplaceError) throw error;
      throw new MarketplaceError("network");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  };
  return {
    configured: base !== null && Number.isFinite(timeoutMs) && timeoutMs > 0,
    async search(
      query: Query = {},
      signal?: AbortSignal,
    ): Promise<PublicListingSearchResponse> {
      const params = serializeQuery(query).toString();
      const response = record(
        await request(`/public/listings${params ? `?${params}` : ""}`, signal),
      );
      if (
        !Array.isArray(response.items) ||
        response.items.length > 20 ||
        typeof response.has_more !== "boolean" ||
        !cursorOrNull(response.next_cursor) ||
        response.has_more !== (response.next_cursor !== null)
      )
        malformed();
      return {
        items: (response.items as unknown[]).map(projectListing),
        filters: {},
        has_more: response.has_more as boolean,
        next_cursor: response.next_cursor as string | null,
      };
    },
    async detail(id: string, signal?: AbortSignal): Promise<PublicListing> {
      if (!uuid.test(id)) throw new MarketplaceError("missing");
      const listing = projectListing(
        await request(`/public/listings/${encodeURIComponent(id)}`, signal),
      );
      if (listing.id.toLowerCase() !== id.toLowerCase()) malformed();
      return listing;
    },
    async reputation(
      id: string,
      signal?: AbortSignal,
    ): Promise<ReviewPublishedListResponse> {
      if (!uuid.test(id)) throw new MarketplaceError("missing");
      return projectReputation(
        await request(
          `/public/listings/${encodeURIComponent(id)}/reviews`,
          signal,
        ),
      );
    },
    mediaUrl(
      listingId: string,
      media: PublicListingMedia | undefined,
      requestedWidth = 640,
    ): string | null {
      if (
        !base ||
        !uuid.test(listingId) ||
        !media ||
        !uuid.test(media.id) ||
        !Array.isArray(media.widths) ||
        !Number.isFinite(requestedWidth)
      )
        return null;
      const widths = supportedWidths.filter((width) =>
        media.widths.includes(width),
      );
      const width =
        widths.find((candidate) => candidate >= requestedWidth) ??
        widths.at(-1);
      return width === undefined
        ? null
        : `${base}/public/listings/${encodeURIComponent(listingId)}/media/${encodeURIComponent(media.id)}/variants/${width}`;
    },
  };
}

function apiBase(value: string | undefined): string | null {
  if (
    !value ||
    !/^https?:\/\//i.test(value) ||
    value.trim() !== value ||
    /[\u0000-\u0020\u007f\\?#]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.hostname ||
      /%2f|%5c|%2e/i.test(url.pathname)
    )
      return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function malformed(): never {
  throw new MarketplaceError("unavailable");
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return malformed();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") return malformed();
  return value;
}
function identifier(value: unknown): string {
  const id = text(value);
  if (!uuid.test(id)) malformed();
  return id;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") return malformed();
  return value;
}
function whole(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return malformed();
  return value;
}
function nullableWhole(value: unknown): number | null {
  return value === null ? null : whole(value);
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function dateOrNull(value: unknown): string | null {
  if (value === null) return null;
  const date = text(value);
  if (!isDate(date)) malformed();
  return date;
}
function timeOrNull(value: unknown): string | null {
  if (value === null) return null;
  const time = text(value);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(time))
    malformed();
  return time;
}
function cursorOrNull(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= 4096 &&
      !/[\u0000-\u0020\u007f]/.test(value))
  );
}

/** Explicit projection is a second boundary against accidentally bundling new private API fields. */
function projectListing(value: unknown): PublicListing {
  const row = record(value),
    price = record(row.price),
    terms = record(row.terms),
    property = record(row.property),
    location = record(row.location);
  if (
    price.currency !== "XAF" ||
    !choices.purpose.includes(row.purpose as never) ||
    !choices.property_type.includes(property.property_type as never)
  )
    malformed();
  const size = nullableText(property.size_sqm);
  if (
    size !== null &&
    (!/^\d+(?:\.\d+)?$/.test(size) || !Number.isFinite(Number(size)))
  )
    malformed();
  const furnishing = nullableText(property.furnishing);
  if (furnishing !== null && !choices.furnishing.includes(furnishing as never))
    malformed();
  const expiry = text(row.expires_at);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      expiry,
    ) ||
    !isDate(expiry.slice(0, 10)) ||
    !Number.isFinite(Date.parse(expiry))
  )
    malformed();
  if (!Array.isArray(row.media)) malformed();
  const media = (row.media as unknown[]).map((value): PublicListingMedia => {
    const item = record(value);
    if (
      !Array.isArray(item.widths) ||
      !item.widths.every((width) => supportedWidths.includes(width as never))
    )
      malformed();
    return {
      id: identifier(item.id),
      is_cover: bool(item.is_cover),
      widths: [...new Set(item.widths as PublicListingMedia["widths"])].sort(
        (a, b) => a - b,
      ),
    };
  });
  return {
    id: identifier(row.id),
    purpose: text(row.purpose),
    title: text(row.title),
    description: text(row.description),
    price: {
      amount_minor: whole(price.amount_minor),
      currency: "XAF",
      pricing_period: text(price.pricing_period),
      negotiable: bool(price.negotiable),
    },
    terms: {
      deposit_amount_minor: nullableWhole(terms.deposit_amount_minor),
      advance_months: nullableWhole(terms.advance_months),
      minimum_lease_months: nullableWhole(terms.minimum_lease_months),
      utilities_included:
        terms.utilities_included === null
          ? null
          : bool(terms.utilities_included),
      service_charge_amount_minor: nullableWhole(
        terms.service_charge_amount_minor,
      ),
      weekly_amount_minor: nullableWhole(terms.weekly_amount_minor),
      minimum_nights: nullableWhole(terms.minimum_nights),
      guest_limit: nullableWhole(terms.guest_limit),
      check_in_time: timeOrNull(terms.check_in_time),
      check_out_time: timeOrNull(terms.check_out_time),
      cleaning_fee_minor: nullableWhole(terms.cleaning_fee_minor),
    },
    property: {
      property_type: text(property.property_type),
      bedrooms: nullableWhole(property.bedrooms),
      bathrooms: nullableWhole(property.bathrooms),
      size_sqm: size,
      furnishing,
    },
    location: {
      region: text(location.region),
      city: text(location.city),
      ...(location.neighborhood === undefined
        ? {}
        : { neighborhood: text(location.neighborhood) }),
    },
    market_status: text(row.market_status),
    available_from: dateOrNull(row.available_from),
    expires_at: expiry,
    media: dedupeMedia(media),
  };
}

function projectReputation(value: unknown): ReviewPublishedListResponse {
  const row = record(value),
    aggregate = record(row.reputation),
    count = whole(aggregate.count),
    average = aggregate.average;
  if (
    !Array.isArray(row.items) ||
    row.items.length > count ||
    !cursorOrNull(row.next_cursor)
  )
    malformed();
  if (
    count < 3
      ? average !== null
      : typeof average !== "number" ||
        !Number.isFinite(average) ||
        average < 1 ||
        average > 5
  )
    malformed();
  const items = (row.items as unknown[]).map((input): ReviewPublished => {
    const item = record(input),
      criteria = record(item.criteria),
      projectedCriteria: ReviewCriteria = {};
    if (
      !["SEEKER_TO_PROVIDER", "PROVIDER_TO_SEEKER"].includes(
        text(item.direction),
      ) ||
      item.event_label !== "VALIDATED_COMPLETED_VIEWING" ||
      !isDate(text(item.date))
    )
      malformed();
    for (const key of [
      "listing_accuracy",
      "communication",
      "reliability",
      "transparency",
      "overall_experience",
      "appointment_attendance",
      "respectful_conduct",
      "overall_interaction",
    ] as const) {
      if (criteria[key] !== undefined) {
        const value = whole(criteria[key]);
        if (value < 1 || value > 5) malformed();
        projectedCriteria[key] = value;
      }
    }
    const rating = whole(item.rating);
    if (rating < 1 || rating > 5) malformed();
    return {
      id: identifier(item.id),
      direction: item.direction as ReviewPublished["direction"],
      rating,
      text: nullableText(item.text),
      criteria: projectedCriteria,
      date: text(item.date),
      author_display_name: text(item.author_display_name),
      author_role: text(item.author_role),
      event_label: "VALIDATED_COMPLETED_VIEWING",
      provider_identity_verified: bool(item.provider_identity_verified),
    };
  });
  return {
    items,
    next_cursor: row.next_cursor as string | null,
    reputation: { count, average: average as number | null },
  };
}
