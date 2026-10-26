import type {
  PublicListing,
  ReviewPublishedListResponse,
} from "@pachi/contracts";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useMarketplace } from "../../src/api";
import { Gallery } from "../../src/components/Gallery";
import { DiscoveryHeader } from "../../src/components/DiscoveryParts";
import { ListingInquiryCard } from "../../src/components/ListingInquiryCard";
import { webListingUrl } from "../../src/contact-handoff";
import { MarketplaceError } from "../../src/data/marketplace";
import { detailCopy } from "../../src/detail-copy";
import { offeringFacts, type DetailFact } from "../../src/detail-presentation";
import {
  furnishingLabel,
  locationLabel,
  marketLabel,
  propertyLabel,
  purposeLabel,
} from "../../src/format";
import { useLocale } from "../../src/locale";
import { inquiryCardCopy } from "../../src/inquiry-card-copy";
import { safeReturnTo } from "../../src/navigation";
import { Button, Icon, Notice, Screen, colors } from "../../src/ui";

type LoadState = "loading" | "ready" | "missing" | "error";
function Facts({ facts }: { facts: DetailFact[] }) {
  return (
    <View style={styles.facts}>
      {facts
        .filter((fact) => fact.value !== null)
        .map((fact) => (
          <View key={fact.label} style={styles.fact}>
            <Text style={styles.factLabel}>{fact.label}</Text>
            <Text style={styles.factValue}>{fact.value}</Text>
          </View>
        ))}
    </View>
  );
}

function PriceCard({ listing, currentId }: { listing: PublicListing; currentId: string }) {
  const { locale } = useLocale();
  const { webOrigin, isTestPreview } = useMarketplace();
  const copy = inquiryCardCopy(locale);
  const [failed, setFailed] = useState(false);
  const url = listing.id === currentId ? webListingUrl(webOrigin, listing.id) : null;
  const openContact = url ? () => {
    setFailed(false);
    void Linking.openURL(url).catch(() => setFailed(true));
  } : undefined;
  return (
    <View>
      <ListingInquiryCard
        listing={listing}
        provider={listing.provider ? {
          displayName: listing.provider.display_name,
          identityVerified: listing.provider.identity_verified,
          authorityDeclared: listing.provider.authority_declared,
          lastConfirmedAt: listing.last_confirmed_at ?? null,
        } : null}
        onViewing={openContact}
        onMessage={openContact}
        contactNote={url ? copy.webHandoff : copy.contactUnavailable}
        samplePreview={isTestPreview}
      />
      {failed && <Text accessibilityRole="alert" style={styles.note}>{copy.contactError}</Text>}
    </View>
  );
}

export default function ListingDetail() {
  const params = useLocalSearchParams<{
    id: string | string[];
    returnTo?: string | string[];
  }>();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { client } = useMarketplace();
  const { locale, money, date, t } = useLocale();
  const copy = detailCopy(locale);
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [listing, setListing] = useState<PublicListing | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [retry, setRetry] = useState(0);
  const [reviews, setReviews] = useState<ReviewPublishedListResponse | null>(
    null,
  );
  const [reviewState, setReviewState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [reviewRetry, setReviewRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setListing(null);
    setState("loading");
    void client
      .detail(id, controller.signal)
      .then((value) => {
        if (!active) return;
        setListing(value);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState(
          error instanceof MarketplaceError && error.code === "missing"
            ? "missing"
            : "error",
        );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [client, id, retry]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setReviews(null);
    setReviewState("loading");
    if (listing)
      void client
        .reputation(listing.id, controller.signal)
        .then((value) => {
          if (!active) return;
          setReviews(value);
          setReviewState("ready");
        })
        .catch(() => {
          if (active && !controller.signal.aborted) setReviewState("error");
        });
    return () => {
      active = false;
      controller.abort();
    };
  }, [client, listing, reviewRetry]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(safeReturnTo(params.returnTo));
  };
  const terms = listing ? offeringFacts(listing, locale, money) : [];

  return (
    <Screen>
      <DiscoveryHeader back onBack={goBack} />
      {state === "loading" && (
        <View accessibilityLiveRegion="polite" style={styles.loading}>
          <View style={styles.loadingPhoto} />
          <ActivityIndicator color={colors.forest} size="large" />
          <Text style={styles.body}>{copy.loading}</Text>
        </View>
      )}
      {state === "missing" && (
        <Notice
          title={copy.missingTitle}
          message={copy.missingMessage}
          action={copy.browse}
          onAction={() => router.replace("/listings")}
        />
      )}
      {state === "error" && (
        <Notice
          title={copy.errorTitle}
          message={copy.errorMessage}
          action={copy.retry}
          onAction={() => setRetry((value) => value + 1)}
          kind="error"
        />
      )}
      {state === "ready" && listing && (
        <View style={styles.article}>
          <Gallery key={listing.id} listing={listing} />
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>
              {purposeLabel(listing.purpose, locale)} ·{" "}
              {propertyLabel(listing.property.property_type, locale)}
            </Text>
            <Text
              accessibilityRole="header"
              style={[styles.title, wide && styles.wideTitle]}
            >
              {listing.title}
            </Text>
            <Text style={styles.location}>{locationLabel(listing)}</Text>
          </View>
          <View style={[styles.layout, wide && styles.wideLayout]}>
            <View style={[styles.main, wide && styles.wideMain]}>
              <View style={styles.metrics}>
                {listing.property.bedrooms !== null && (
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>
                      {listing.property.bedrooms}
                    </Text>
                    <Text style={styles.metricLabel}>{copy.beds}</Text>
                  </View>
                )}
                {listing.property.bathrooms !== null && (
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>
                      {listing.property.bathrooms}
                    </Text>
                    <Text style={styles.metricLabel}>{copy.baths}</Text>
                  </View>
                )}
                {listing.property.size_sqm !== null && (
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>
                      {Number(listing.property.size_sqm).toLocaleString(locale)}{" "}
                      <Text style={styles.squareMetres}>m²</Text>
                    </Text>
                    <Text style={styles.metricLabel}>{copy.area}</Text>
                  </View>
                )}
              </View>
              {!wide && (
                <PriceCard key={listing.id} listing={listing} currentId={id} />
              )}
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  {copy.about}
                </Text>
                <Text style={styles.description}>{listing.description}</Text>
              </View>
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  {copy.property}
                </Text>
                <Facts
                  facts={[
                    {
                      label: copy.type,
                      value: propertyLabel(
                        listing.property.property_type,
                        locale,
                      ),
                    },
                    {
                      label: copy.furnishing,
                      value: listing.property.furnishing
                        ? furnishingLabel(listing.property.furnishing, locale)
                        : null,
                    },
                  ]}
                />
              </View>
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  {listing.purpose === "RENT"
                    ? copy.rentalTerms
                    : listing.purpose === "SHORT_LET"
                      ? copy.stayTerms
                      : copy.terms}
                </Text>
                <Facts facts={terms} />
                {terms.some((fact) => fact.value === null) && (
                  <Text style={styles.note}>{copy.unspecified}</Text>
                )}
                {listing.purpose === "SHORT_LET" && (
                  <Text style={styles.note}>{copy.stayNote}</Text>
                )}
              </View>
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  {copy.availability}
                </Text>
                <Facts
                  facts={[
                    {
                      label: copy.status,
                      value: marketLabel(listing.market_status, locale),
                    },
                    {
                      label: copy.availableFrom,
                      value: listing.available_from
                        ? date(listing.available_from)
                        : copy.timing,
                    },
                  ]}
                />
              </View>
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  {copy.location}
                </Text>
                <View style={styles.locationCard}>
                  <View style={styles.locationMark} accessible={false}>
                    <Icon name="pin" size={25} />
                  </View>
                  <View style={styles.locationCopy}>
                    {listing.location.neighborhood && (
                      <Text style={styles.neighborhood}>
                        {listing.location.neighborhood}
                      </Text>
                    )}
                    <Text style={styles.body}>
                      {[
                        listing.location.city,
                        listing.location.region === "Southwest"
                          ? t("southwest")
                          : listing.location.region,
                      ].join(" · ")}
                    </Text>
                    <Text style={styles.note}>{copy.locationNote}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.section}>
                <Text accessibilityRole="header" style={styles.heading}>
                  {copy.reputation}
                </Text>
                {reviewState === "loading" && (
                  <Text accessibilityLiveRegion="polite" style={styles.note}>
                    {copy.reputationLoading}
                  </Text>
                )}
                {reviewState === "error" && (
                  <View style={styles.reputationError}>
                    <Text style={styles.note}>
                      {copy.reputationUnavailable}
                    </Text>
                    <Button
                      label={copy.retry}
                      variant="secondary"
                      onPress={() => setReviewRetry((value) => value + 1)}
                    />
                  </View>
                )}
                {reviews && (
                  <View style={styles.reputationCard}>
                    <Text style={styles.reviewCount}>
                      {reviews.reputation.count.toLocaleString(locale)}{" "}
                      {reviews.reputation.count === 1
                        ? copy.reputationReview
                        : copy.reputationReviews}
                    </Text>
                    {reviews.reputation.count >= 3 &&
                    reviews.reputation.average !== null ? (
                      <Text
                        accessibilityLabel={`${copy.reputationAverage}: ${reviews.reputation.average.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / 5`}
                        style={styles.rating}
                      >
                        {reviews.reputation.average.toLocaleString(locale, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        <Text style={styles.ratingScale}>/ 5</Text>
                      </Text>
                    ) : (
                      <Text style={styles.note}>
                        {copy.reputationThreshold}
                      </Text>
                    )}
                    <Text style={styles.note}>{copy.reputationNote}</Text>
                  </View>
                )}
              </View>
            </View>
            {wide && (
              <View style={styles.sidebar}>
                <PriceCard key={listing.id} listing={listing} currentId={id} />
                <View style={styles.browsingNote}>
                  <Text style={styles.browsingHeading}>{copy.browsing}</Text>
                  <Text style={styles.note}>{copy.browsingNote}</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  article: { gap: 28, paddingBottom: 32 },
  loading: { gap: 24, alignItems: "center", paddingBottom: 100 },
  loadingPhoto: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: colors.sage,
    borderRadius: 24,
  },
  titleBlock: { gap: 12 },
  eyebrow: {
    fontFamily: "DMSans",
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: "Manrope",
    fontSize: 31,
    lineHeight: 39,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: colors.forest,
  },
  wideTitle: { fontSize: 40, lineHeight: 48 },
  location: {
    fontFamily: "DMSans",
    fontSize: 15,
    lineHeight: 23,
    color: colors.muted,
  },
  layout: { gap: 28 },
  wideLayout: { flexDirection: "row", alignItems: "flex-start", gap: 52 },
  main: { gap: 32 },
  wideMain: { flex: 1, minWidth: 0 },
  sidebar: { width: 320, gap: 24 },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.sage,
    paddingVertical: 21,
  },
  metric: { minWidth: 74, gap: 6 },
  metricValue: {
    fontFamily: "Manrope",
    fontSize: 23,
    color: colors.forest,
    fontWeight: "600",
  },
  metricLabel: { fontFamily: "DMSans", fontSize: 12, color: colors.muted },
  squareMetres: { fontSize: 15 },
  section: { gap: 17 },
  heading: {
    fontFamily: "Manrope",
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "600",
    letterSpacing: -0.4,
    color: colors.forest,
  },
  body: {
    fontFamily: "DMSans",
    fontSize: 15,
    color: colors.forest,
    lineHeight: 24,
  },
  description: {
    fontFamily: "DMSans",
    fontSize: 15,
    lineHeight: 26,
    color: colors.muted,
  },
  facts: { gap: 1 },
  fact: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 20,
    borderBottomWidth: 1,
    borderColor: colors.sage,
    paddingVertical: 13,
  },
  factLabel: {
    flex: 1,
    fontFamily: "DMSans",
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },
  factValue: {
    flex: 1,
    fontFamily: "DMSans",
    fontSize: 14,
    lineHeight: 22,
    color: colors.forest,
    fontWeight: "600",
    textAlign: "right",
  },
  note: {
    fontFamily: "DMSans",
    fontSize: 13,
    lineHeight: 21,
    color: colors.muted,
  },
  locationCard: {
    flexDirection: "row",
    gap: 18,
    borderRadius: 18,
    backgroundColor: colors.sage,
    padding: 22,
  },
  locationMark: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.ivory,
    alignItems: "center",
    justifyContent: "center",
  },
  locationCopy: { flex: 1, gap: 8 },
  neighborhood: {
    fontFamily: "Manrope",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 25,
    color: colors.forest,
  },
  reputationCard: {
    gap: 13,
    backgroundColor: colors.sage,
    borderRadius: 18,
    padding: 22,
  },
  reviewCount: {
    fontFamily: "DMSans",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    color: colors.forest,
  },
  rating: {
    fontFamily: "Manrope",
    fontSize: 35,
    fontWeight: "600",
    color: colors.forest,
  },
  ratingScale: { fontFamily: "DMSans", fontSize: 16 },
  reputationError: { alignItems: "flex-start", gap: 12 },
  browsingNote: { gap: 9, paddingHorizontal: 4 },
  browsingHeading: {
    fontFamily: "Manrope",
    fontSize: 16,
    fontWeight: "600",
    color: colors.forest,
  },
});
