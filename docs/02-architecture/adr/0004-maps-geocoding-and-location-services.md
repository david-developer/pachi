# ADR 0004 — Maps, Geocoding and Location

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Decision and delivery scope

PostgreSQL/PostGIS and Pachi-managed geography are the canonical inventory location model. Structured region/city/neighborhood/landmark entry and list discovery are core MVP. Map results, external autocomplete, distance sorting, compare and commute features follow their stated product gates; no external map call is required to create a valid property manually.

Google Maps Platform is the initial external map/geocoding integration candidate behind an adapter. Before enabling it, gate E06 must establish Cameroon launch-area coverage, appropriate terms/attribution/storage permissions, key restrictions, cost limits and public-location privacy. Do not treat coverage marketing or an untested address-validation service as proof. If the candidate fails, change this ADR before substituting a provider. No simultaneous Google/Mapbox implementation is required.

## Canonical geography and provenance

Store stable Region, City and Neighborhood IDs with English/French labels, aliases, parent relations, source/license, version and publishing_enabled. Southwest and Littoral are initially enabled; other regions remain selectable for preregistration only. Imported administrative/neighborhood data must have a documented source/license and manual validation; do not fabricate an authoritative dataset.

Property location stores provider-confirmed structured address, landmark/directions, optional PostGIS point, precision/source and confidence/confirmation timestamp. A geocoder suggestion is not a verified property address. Users confirm or correct it. Keep external place IDs separately; never use them as Pachi neighborhood primary keys. Record geocoder-derived fields and their permitted retention separately from independently confirmed domain data.

## Public location privacy

Modes: NEIGHBORHOOD_ONLY (default), APPROXIMATE, EXACT, HIDDEN. Public API/search/map projections obey the strictest current listing/property/safety permission. Exact private address or coordinates never leak through raw API fields, image EXIF, search facets, distance calculations, map-center parameters, logs or cached HTML.

NEIGHBORHOOD_ONLY returns an approved area label/centroid or area geometry, not the private point. APPROXIMATE returns a stable coarse area derived under policy, not fresh random jitter on every request that can be averaged to recover a home. EXACT requires informed provider opt-in, current permission and no safety restriction. HIDDEN returns no location finer than the allowed market region/city context. Provider preview explains what seekers will see.

Distance results use approved public precision and label approximate distances; disable precise sorting when it would reveal hidden coordinates. Viewport search cannot act as a repeated binary-search oracle for a protected exact point: use the public projection for discovery filters. Private directions are shared only through scheduled viewing access controls.

## Search and map integration

Core filters include purpose, structured location, property type, normalized price, bedrooms/bathrooms, furnishing, amenities and availability. Indexed SQL/PostGIS supports bounding/radius operations for the gated feature. Limit viewport size, page size and query complexity. Public discovery uses the same publication/freshness/verification predicate as list/detail; hidden or expired content never remains as a map pin.

Keep text entry and manual pin confirmation available when external services fail. Cancellation/debounce reduces autocomplete cost. Reverse geocoding can suggest labels but cannot overwrite canonical user-confirmed fields silently. Do not automatically enable device-location permission; request it contextually and provide manual search if declined.

## Provider security, terms and cost

Separate browser, native and server keys, each environment-specific and restricted by allowed APIs and supported application/domain identifiers. Server secrets stay server-side. Enforce quota budgets/alerts and safe fallback rather than an unbounded external call per keystroke. Attribution is shown wherever required. Offline saved-listing content uses Pachi-owned public data/media; do not cache third-party tiles or place content without explicit permission.

Before implementation, check the selected APIs' current official documentation and terms, including Cameroon service availability and data-storage restrictions. This ADR intentionally makes no claim that a particular address validation or route service is currently supported in Cameroon.

## Acceptance evidence

Test neighborhood parent/alias integrity, disabled-region publication denial, manual entry without vendor access, pin confirmation, permissions declined, geocoder outage, key restrictions, cost limits and hidden-coordinate inference through every public endpoint. Benchmark real launch neighborhoods/landmarks and record ambiguous/missing results. No map feature ships on synthetic coverage claims.
