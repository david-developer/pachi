import type { PublicListing } from "@pachi/contracts";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { detailCopy } from "../detail-copy";
import { marketLabel, pricePeriod } from "../format";
import { inquiryCardCopy } from "../inquiry-card-copy";
import { useLocale } from "../locale";
import { colors, typography } from "../ui";

/** Approved public summaries only; private provider records do not belong here. */
export type ListingInquiryProvider = {
  displayName: string;
  identityVerified: boolean;
  authorityDeclared: boolean;
  lastConfirmedAt?: string | null;
};

type ListingInquiryCardProps = {
  listing: PublicListing;
  provider?: ListingInquiryProvider | null | undefined;
  onViewing?: (() => void) | undefined;
  onMessage?: (() => void) | undefined;
  contactNote: string;
  samplePreview?: boolean;
};

type InquiryIconName = "calendar" | "message" | "arrow" | "shield" | "building" | "check" | "person";

function InquiryIcon({
  name,
  color = colors.forest,
  size = 18,
}: {
  name: InquiryIconName;
  color?: string;
  size?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
      aria-hidden
    >
      {name === "calendar" && (
        <>
          <Rect x={4} y={5} width={16} height={16} rx={2} />
          <Path d="M8 3v4m8-4v4M4 10h16m-12 4h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
        </>
      )}
      {name === "message" && (
        <Path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
      )}
      {name === "arrow" && <Path d="M5 12h14m-6-6 6 6-6 6" />}
      {name === "shield" && (
        <Path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Zm-3 9 2 2 4-4" />
      )}
      {name === "building" && (
        <>
          <Path d="M4 21V5l9-2v18m0-12h7v12M2 21h20M8 7v1m0 3v1m0 3v1m9-4v1m0 3v1m-9 4v-2h2v2" />
        </>
      )}
      {name === "check" && <Path d="m5 12 4 4L19 6" />}
      {name === "person" && (
        <>
          <Circle cx={12} cy={8} r={3} />
          <Path d="M6 20v-2a6 6 0 0 1 12 0v2" />
        </>
      )}
    </Svg>
  );
}

function InquiryAction({
  label,
  icon,
  onPress,
  primary = false,
  hint,
  testID,
}: {
  label: string;
  icon: "calendar" | "message";
  onPress?: (() => void) | undefined;
  primary?: boolean;
  hint: string;
  testID: string;
}) {
  const [focused, setFocused] = useState(false);
  const disabled = !onPress;
  const foreground = disabled ? colors.muted : primary ? colors.white : colors.forest;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint || undefined}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.action,
        primary ? styles.primaryAction : styles.secondaryAction,
        primary && disabled && styles.disabledPrimary,
        !primary && disabled && styles.disabledSecondary,
        focused && styles.focusedAction,
        pressed && !disabled && styles.pressedAction,
      ]}
    >
      <InquiryIcon name={icon} color={foreground} />
      <Text style={[styles.actionLabel, { color: foreground }]}>{label}</Text>
      {primary && <InquiryIcon name="arrow" color={foreground} size={16} />}
    </Pressable>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/u);
  const first = Array.from(words[0] ?? "");
  return (words.length > 1
    ? `${first[0] ?? ""}${Array.from(words.at(-1) ?? "")[0] ?? ""}`
    : first.slice(0, 2).join("")
  ).toLocaleUpperCase();
}

export function ListingInquiryCard({
  listing,
  provider,
  onViewing,
  onMessage,
  contactNote,
  samplePreview = false,
}: ListingInquiryCardProps) {
  const { locale, money, date } = useLocale();
  const copy = inquiryCardCopy(locale);
  const detail = detailCopy(locale);
  const publicProvider = provider?.displayName.trim() ? provider : null;
  const confirmedAt = publicProvider?.lastConfirmedAt;
  const confirmed = confirmedAt && Number.isFinite(Date.parse(confirmedAt))
    ? `${copy.confirmed} ${date(confirmedAt)}`
    : null;

  return (
    <View testID="listing-price-card" style={styles.card}>
      <View style={styles.priceGroup}>
        <Text style={styles.priceLabel}>{detail.price}</Text>
        <Text testID="listing-price-amount" style={styles.price}>
          {money(listing.price.amount_minor)}
          <Text testID="listing-price-currency" style={styles.currency}>
            {" "}XAF
          </Text>
        </Text>
        <Text style={styles.period}>{pricePeriod(listing.price, locale)}</Text>
        {listing.price.negotiable && <Text style={styles.period}>{detail.negotiable}</Text>}
      </View>

      <View style={styles.status}>
        {listing.market_status === "AVAILABLE" && (
          <View accessible={false} style={styles.statusDot} />
        )}
        <Text testID="listing-card-availability" style={styles.statusText}>
          <Text>{marketLabel(listing.market_status, locale)}</Text>
          {confirmed ? ` · ${confirmed}` : ""}
        </Text>
      </View>

      <View style={styles.divider} />

      <View testID="listing-provider" style={styles.provider}>
        <View accessible={false} style={styles.avatar}>
          {publicProvider ? (
            <Text style={styles.initials}>{initials(publicProvider.displayName)}</Text>
          ) : <InquiryIcon name="person" size={21} />}
        </View>
        <View style={styles.providerText}>
          <Text testID="listing-provider-name" style={styles.providerName}>
            {publicProvider?.displayName ?? copy.providerUnavailable}
          </Text>
          <Text style={styles.providerRole}>{copy.providerRole}</Text>
        </View>
      </View>

      {publicProvider && (publicProvider.identityVerified || publicProvider.authorityDeclared) && (
        <View style={styles.trust}>
          {publicProvider.identityVerified && (
            <View testID="listing-provider-identity" style={styles.trustRow}>
              <InquiryIcon name="shield" size={17} />
              <Text style={styles.trustLabel}>{copy.identityVerified}</Text>
              <InquiryIcon name="check" size={16} />
            </View>
          )}
          {publicProvider.authorityDeclared && (
            <View testID="listing-provider-authority" style={styles.trustRow}>
              <InquiryIcon name="building" size={17} />
              <Text style={styles.trustLabel}>{copy.authorityDeclared}</Text>
            </View>
          )}
          <Text style={styles.disclaimer}>
            {publicProvider.identityVerified ? copy.identityNote : copy.authorityNote}
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <InquiryAction
          label={copy.viewing}
          icon="calendar"
          onPress={onViewing}
          hint={contactNote}
          primary
          testID="listing-request-viewing"
        />
        <InquiryAction
          label={copy.message}
          icon="message"
          onPress={onMessage}
          hint={contactNote}
          testID="listing-message-provider"
        />
        {!!contactNote && <Text style={styles.contactNote}>{contactNote}</Text>}
      </View>

      <View style={styles.safety}>
        <InquiryIcon name="shield" color={colors.muted} size={17} />
        <Text style={styles.safetyText}>{copy.safety}</Text>
      </View>
      {samplePreview && <Text style={styles.sample}>{copy.sample}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.sage,
    backgroundColor: colors.white,
    padding: 24,
  },
  priceGroup: { gap: 7 },
  priceLabel: {
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  price: {
    fontFamily: typography.heading,
    color: colors.forest,
    fontSize: 30,
    lineHeight: 39,
    fontWeight: "700",
    letterSpacing: -0.6,
  },
  currency: {
    fontFamily: typography.body,
    fontSize: 12,
    fontWeight: "400",
    letterSpacing: 0,
  },
  period: {
    fontFamily: typography.body,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 21,
  },
  status: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 18 },
  statusDot: { width: 5, height: 5, marginTop: 7, borderRadius: 3, backgroundColor: colors.forest },
  statusText: { flex: 1, fontFamily: typography.body, fontSize: 12, lineHeight: 19, color: colors.forest },
  divider: { height: 1, backgroundColor: colors.sage, marginVertical: 23 },
  provider: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: typography.body, fontSize: 14, fontWeight: "600", color: colors.forest },
  providerText: { flex: 1, minWidth: 0, gap: 3 },
  providerName: { fontFamily: typography.body, fontSize: 14, lineHeight: 21, color: colors.forest },
  providerRole: { fontFamily: typography.body, fontSize: 12, lineHeight: 19, color: colors.muted },
  trust: { gap: 14, marginTop: 24 },
  trustRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  trustLabel: { flex: 1, minWidth: 0, fontFamily: typography.body, fontSize: 12, lineHeight: 19, color: colors.forest },
  disclaimer: { fontFamily: typography.body, fontSize: 11, lineHeight: 18, color: colors.muted, marginTop: 2 },
  actions: { gap: 12, marginTop: 25 },
  action: { minHeight: 49, borderRadius: 6, borderWidth: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 12 },
  primaryAction: { backgroundColor: colors.forest, borderColor: colors.forest },
  secondaryAction: { backgroundColor: colors.white, borderColor: colors.border },
  disabledPrimary: { backgroundColor: colors.sage, borderColor: colors.border },
  disabledSecondary: { backgroundColor: colors.ivory },
  focusedAction: { outlineWidth: 2, outlineColor: colors.forest, outlineOffset: 3, outlineStyle: "solid" },
  pressedAction: { opacity: 0.84 },
  actionLabel: { flexShrink: 1, fontFamily: typography.body, fontSize: 14, lineHeight: 21, fontWeight: "600", textAlign: "center" },
  contactNote: { fontFamily: typography.body, fontSize: 12, lineHeight: 19, color: colors.muted },
  safety: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 25 },
  safetyText: { flex: 1, minWidth: 0, fontFamily: typography.body, fontSize: 11, lineHeight: 18, color: colors.muted },
  sample: { marginTop: 24, fontFamily: typography.body, fontSize: 10, lineHeight: 17, color: colors.muted, textAlign: "center" },
});
