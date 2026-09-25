"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { imageForListing, type PreviewListing } from "./preview-data";
import { formatPrice, formatPropertyType } from "./preview-utils";
import { usePreview } from "./preview-context";

export function PreviewShell({ children }: { children: ReactNode }) {
  const { locale, setLocale, t } = usePreview();
  return (
    <div className="preview-app">
      <div className="preview-ribbon">
        <span>
          <i aria-hidden="true" />
          {t("preview")}
        </span>
        <span>{t("footerPreview")}</span>
      </div>
      <header className="preview-header">
        <Link
          className="brand"
          href="/preview"
          aria-label="Pachi, explore homes"
        >
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>
            Pachi<span className="brand-period">.</span>
          </span>
        </Link>
        <nav className="desktop-nav" aria-label={t("navMain")}>
          <Link href="/preview">{t("explore")}</Link>
          <Link href="/preview/provider">{t("workspace")}</Link>
        </nav>
        <div className="header-actions">
          <span className="fixture-tag">{t("synthetic")}</span>
          <button
            className="locale-button"
            type="button"
            onClick={() => setLocale(locale === "en" ? "fr" : "en")}
            aria-label={t("languageLabel")}
          >
            {t("language")}
          </button>
        </div>
      </header>
      <main className="preview-main">{children}</main>
      <nav className="mobile-dock" aria-label={t("navMain")}>
        <Link href="/preview">
          <span aria-hidden="true">01</span>
          {t("explore")}
        </Link>
        <Link href="/preview/provider">
          <span aria-hidden="true">02</span>
          {t("workspace")}
        </Link>
      </nav>
      <footer className="preview-footer">
        <span>Pachi / Cameroon</span>
        <span>{t("footerPreview")}</span>
      </footer>
    </div>
  );
}
export function ListingCard({ listing }: { listing: PreviewListing }) {
  const { locale, t } = usePreview();
  return (
    <article className="listing-card">
      <Link
        className="listing-image"
        href={`/preview/listings/${listing.id}`}
        aria-label={`${t("openListing")}: ${listing.title[locale]}`}
      >
        <Image
          src={imageForListing(listing)}
          alt={`${formatPropertyType(listing.propertyType, locale)} · ${listing.area}, ${listing.city}`}
          fill
          unoptimized
          sizes="(max-width: 680px) 90vw, (max-width: 1100px) 45vw, 30vw"
        />
        {listing.status === "recent" && (
          <span className="image-flag">{t("recent")}</span>
        )}
        <span className="area-label">{listing.area}</span>
      </Link>
      <div className="listing-copy">
        <div className="listing-meta">
          <span>
            {listing.city} · {formatPropertyType(listing.propertyType, locale)}
          </span>
          <span>{listing.furnished && t("furnished")}</span>
        </div>
        <Link
          className="listing-title"
          href={`/preview/listings/${listing.id}`}
        >
          {listing.title[locale]}
        </Link>
        <p className="listing-facts">
          {listing.bedrooms} {t("beds")} <span>·</span> {listing.bathrooms}{" "}
          {t("baths")} <span>·</span> {listing.areaSqm} {t("sqm")}
        </p>
        <div className="listing-bottom">
          <strong>
            {formatPrice(listing.price, locale)}{" "}
            <small>
              {listing.period === "monthly"
                ? t("perMonth")
                : listing.period === "nightly"
                  ? t("perNight")
                  : t("totalPrice")}
            </small>
          </strong>
          <Link
            href={`/preview/listings/${listing.id}`}
            aria-label={`${t("details")}: ${listing.title[locale]}`}
          >
            {t("details")} <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

export function TrustMark({
  verified,
  label,
}: {
  verified: boolean;
  label: string;
}) {
  return (
    <span
      className={`trust-mark ${verified ? "trust-positive" : "trust-muted"}`}
    >
      <span aria-hidden="true">{verified ? "✓" : "·"}</span>
      {label}
    </span>
  );
}

export function PreviewAction({ viewing = false }: { viewing?: boolean }) {
  const { t } = usePreview();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const title = viewing ? t("viewing") : t("contact");
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) opener.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  function close() {
    setOpen(false);
  }
  return (
    <>
      <button
        ref={opener}
        className={viewing ? "button-outline" : "button-dark"}
        type="button"
        onClick={() => setOpen(true)}
      >
        {title}
        <span aria-hidden="true">↗</span>
      </button>
      {open && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            className="preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-dialog-title"
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                const focusable =
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    "button, input, textarea, select, a[href]",
                  );
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <button
              ref={closeButton}
              className="dialog-close"
              type="button"
              onClick={close}
              aria-label={t("close")}
            >
              ×
            </button>
            <p className="eyebrow">{t("detailsUnavailable")}</p>
            <h2 id="preview-dialog-title">
              {viewing ? t("viewing") : t("inquiryTitle")}
            </h2>
            <p>{viewing ? t("inquiryBody") : t("inquiryBody")}</p>
            <div className="dialog-preview-fields">
              {viewing ? (
                <label>
                  {t("date")}
                  <input type="date" />
                </label>
              ) : (
                <>
                  <label>
                    {t("name")}
                    <input type="text" autoComplete="name" />
                  </label>
                  <label>
                    {t("message")}
                    <textarea rows={3} />
                  </label>
                </>
              )}
            </div>
            <div className="preview-only-note" role="status">
              <strong>{t("noSend")}</strong>
              <span>{viewing ? t("inquiryBody") : t("contactAccess")}</span>
            </div>
            <button
              className="button-dark dialog-button"
              type="button"
              onClick={close}
            >
              {t("close")}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
