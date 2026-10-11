"use client";
import { useEffect, useState } from "react";
import type { ListingLifecycleState } from "@pachi/contracts";
type Pending = { path: string; body: string; key: string };
export default function ListingLifecyclePage() {
  const [session, setSession] = useState<{
    authenticated: boolean;
    csrfToken?: string;
  } | null>(null);
  const [id, setId] = useState(""),
    [state, setState] = useState<ListingLifecycleState | null>(null);
  const [market, setMarket] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        if (active) setSession(s);
      })
      .catch(() => {
        if (active) setSession({ authenticated: false });
      });
    return () => {
      active = false;
    };
  }, []);
  async function load() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/account/listings/${encodeURIComponent(id)}/lifecycle`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setState(null);
        throw new Error("Listing controls are unavailable for this account.");
      }
      const next = (await response.json()) as ListingLifecycleState;
      setState(next);
      setMarket(next.market_status);
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "Listing controls could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function send(operation: "market" | "freshness", retry?: Pending) {
    if (!state && !retry) return;
    const command = retry ?? {
      path: `/api/account/listings/${state!.listing_id}/lifecycle/${operation}`,
      key: crypto.randomUUID(),
      body: JSON.stringify({
        expected_version: state!.version,
        expected_revision_id: state!.revision_id,
        expected_offering_version_id: state!.offering_version_id,
        ...(operation === "market" ? { market_status: market } : {}),
      }),
    };
    setPending(command);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(command.path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": session?.csrfToken ?? "",
          "idempotency-key": command.key,
        },
        body: command.body,
      });
      if (!response.ok) {
        if (response.status < 500) {
          setPending(null);
          if ([401, 403, 404].includes(response.status)) setState(null);
        }
        throw new Error(
          response.status === 409
            ? "The listing changed or current publication requirements are blocked. Refresh its state."
            : response.status >= 500
              ? "The result is unconfirmed. Retry the same request."
              : "This account cannot perform that change.",
        );
      }
      const next = (await response.json()) as ListingLifecycleState;
      setState(next);
      setMarket(next.market_status);
      setPending(null);
      setMessage(
        ["DRAFT", "PENDING_REVIEW"].includes(next.publication_status)
          ? "Material changes were submitted for review."
          : "Listing state saved.",
      );
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "The result is unconfirmed. Retry the same request.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="shell">
      <section className="panel">
        <a href="/provider">Provider workspace</a>
        <h1>Listing availability and freshness</h1>
        {!session ? (
          <p>Loading account state.</p>
        ) : !session.authenticated ? (
          <p>Sign in to manage a listing.</p>
        ) : (
          <>
            <label>
              Listing reference
              <input
                value={id}
                disabled={busy || pending !== null}
                onChange={(e) => {
                  setId(e.target.value);
                  setState(null);
                  setError("");
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy || pending !== null || !id}
              onClick={() => {
                void load();
              }}
            >
              Refresh listing state
            </button>
            {state && (
              <div>
                <p>Publication: {state.publication_status}</p>
                <p>Market: {state.market_status}</p>
                <p>
                  Freshness expires:{" "}
                  {state.expires_at
                    ? new Date(state.expires_at).toLocaleString()
                    : "Not confirmed"}
                </p>
                {!state.region_enabled && (
                  <p role="status">
                    Publishing is disabled in this region. Renewal and new
                    inquiries are unavailable.
                  </p>
                )}
                {!state.visible && (
                  <p role="status">
                    This listing is currently unavailable publicly.
                  </p>
                )}
                <label>
                  Market availability
                  <select
                    value={market}
                    disabled={busy || pending !== null}
                    onChange={(e) => setMarket(e.target.value)}
                  >
                    {state.allowed_market_states.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={
                    busy || pending !== null || market === state.market_status
                  }
                  onClick={() => {
                    void send("market");
                  }}
                >
                  Save market availability
                </button>
                {state.can_confirm_freshness && (
                  <button
                    type="button"
                    disabled={busy || pending !== null}
                    onClick={() => {
                      void send("freshness");
                    }}
                  >
                    {state.publication_status === "EXPIRED"
                      ? "Request renewal"
                      : "Confirm freshness"}
                  </button>
                )}
              </div>
            )}
            {pending && !busy && (
              <button
                type="button"
                onClick={() => {
                  void send("freshness", pending);
                }}
              >
                Retry unconfirmed request
              </button>
            )}
          </>
        )}
        {busy && <p role="status">Saving or loading listing state…</p>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
