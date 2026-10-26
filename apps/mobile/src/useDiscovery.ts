import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicListing } from "@pachi/contracts";
import { useMarketplace } from "./api";
import {
  MarketplaceError,
  mergeListings,
  serializeQuery,
  type Query,
} from "./data/marketplace";

type SearchState = {
  key: string;
  items: PublicListing[];
  loading: boolean;
  error: MarketplaceError | null;
  cursor: string | null;
  more: boolean;
  paging: boolean;
  pageError: boolean;
};
const initial = (key: string): SearchState => ({
  key,
  items: [],
  loading: true,
  error: null,
  cursor: null,
  more: false,
  paging: false,
  pageError: false,
});

/** Each response belongs to one query generation, including paginated requests. */
export function useDiscovery(input: Query, enabled = true) {
  const { client } = useMarketplace();
  const key = enabled ? serializeQuery(input).toString() : "disabled";
  const query = useMemo(
    () => Object.fromEntries(new URLSearchParams(key)) as Query,
    [key],
  );
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<SearchState>(() => initial(key));
  const generation = useRef(0);
  const pageRequest = useRef<AbortController | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    pageRequest.current?.abort();
    busy.current = false;
    setState(initial(key));
    if (!enabled) return () => controller.abort();
    client
      .search(query, controller.signal)
      .then((response) => {
        if (generation.current !== current || controller.signal.aborted) return;
        setState({
          key,
          items: mergeListings([], response.items),
          loading: false,
          error: null,
          cursor: response.next_cursor,
          more: response.has_more,
          paging: false,
          pageError: false,
        });
      })
      .catch((error: unknown) => {
        if (generation.current !== current || controller.signal.aborted) return;
        setState({
          ...initial(key),
          loading: false,
          error:
            error instanceof MarketplaceError
              ? error
              : new MarketplaceError("network"),
        });
      });
    return () => {
      controller.abort();
      pageRequest.current?.abort();
    };
  }, [client, enabled, key, query, revision]);

  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const loadMore = async () => {
    if (
      busy.current ||
      state.key !== key ||
      state.loading ||
      !state.more ||
      !state.cursor
    )
      return;
    const current = generation.current;
    const cursor = state.cursor;
    const controller = new AbortController();
    pageRequest.current = controller;
    busy.current = true;
    setState((value) => ({ ...value, paging: true, pageError: false }));
    try {
      const response = await client.search(
        { ...query, cursor },
        controller.signal,
      );
      if (current !== generation.current || controller.signal.aborted) return;
      // A repeated cursor cannot make progress; keep existing results and offer retry.
      if (response.has_more && response.next_cursor === cursor)
        throw new MarketplaceError("unavailable");
      setState((value) => ({
        ...value,
        items: mergeListings(value.items, response.items),
        cursor: response.next_cursor,
        more: response.has_more,
        paging: false,
        pageError: false,
      }));
    } catch {
      if (current === generation.current && !controller.signal.aborted)
        setState((value) => ({ ...value, paging: false, pageError: true }));
    } finally {
      if (current === generation.current) busy.current = false;
    }
  };
  // Never display the previous query's cards during the render before its effect runs.
  return { ...(state.key === key ? state : initial(key)), retry, loadMore };
}
