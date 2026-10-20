import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createMarketplaceClient } from "./data/marketplace";
const baseUrl = process.env.EXPO_PUBLIC_API_URL;
const client = createMarketplaceClient(baseUrl);
const value = {
  client,
  configured: client.configured,
  isTestPreview: process.env.EXPO_PUBLIC_REVIEW_MODE === "synthetic-test",
};
const MarketplaceContext = createContext(value);
export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const state = useMemo(() => value, []);
  return (
    <MarketplaceContext.Provider value={state}>
      {children}
    </MarketplaceContext.Provider>
  );
}
export function useMarketplace() {
  return useContext(MarketplaceContext);
}
