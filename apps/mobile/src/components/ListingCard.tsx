import type { PublicListing } from "@pachi/contracts";
import { useRouter } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { useMarketplace } from "../api";
import { useLocale } from "../locale";
import {
  locationLabel,
  pricePeriod,
  propertyLabel,
  purposeLabel,
} from "../format";
import { ArchitecturalMark, colors, Icon, typography } from "../ui";

export function ListingCard({
  listing,
  returnTo,
}: {
  listing: PublicListing;
  returnTo: string;
}) {
  const router = useRouter();
  const { client } = useMarketplace();
  const { locale, t, money } = useLocale();
  const [failed, setFailed] = useState(false);
  const cover =
    listing.media.find((media) => media.is_cover) ?? listing.media[0];
  const uri = client.mediaUrl(listing.id, cover);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${listing.title}, ${money(listing.price.amount_minor)} XAF ${pricePeriod(listing.price, locale)}, ${locationLabel(listing)}`}
      testID={`listing-card-${listing.id}`}
      onPress={() =>
        router.push({
          pathname: "/listings/[id]",
          params: { id: listing.id, returnTo },
        })
      }
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.photo}>
        {uri && !failed ? (
          <Image
            key={uri}
            source={{ uri }}
            accessibilityLabel={listing.title}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <View style={styles.placeholder}>
            <ArchitecturalMark size={46} />
            <Text style={styles.photoText}>
              {t(failed ? "imageError" : "noPhoto")}
            </Text>
          </View>
        )}
        <View style={styles.purpose}>
          <Text style={styles.purposeText}>
            {purposeLabel(listing.purpose, locale)}
          </Text>
        </View>
      </View>
      <View style={styles.content}>
        <View style={styles.priceRow}>
          <Text style={styles.price}>
            {money(listing.price.amount_minor)}{" "}
            <Text style={styles.currency}>XAF</Text>
          </Text>
          <Text style={styles.period}>
            {pricePeriod(listing.price, locale)}
          </Text>
        </View>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
          {listing.title}
        </Text>
        <View style={styles.location}>
          <Icon name="pin" size={14} />
          <Text numberOfLines={1} style={styles.locationText}>
            {locationLabel(listing)}
          </Text>
        </View>
        <View style={styles.specs}>
          <Text style={styles.spec}>
            {propertyLabel(listing.property.property_type, locale)}
          </Text>
          {listing.property.bedrooms !== null && (
            <View style={styles.fact}>
              <Icon name="bed" size={16} />
              <Text style={styles.spec}>
                {listing.property.bedrooms} {t("beds")}
              </Text>
            </View>
          )}
          {listing.property.bathrooms !== null && (
            <View style={styles.fact}>
              <Icon name="bath" size={16} />
              <Text style={styles.spec}>
                {listing.property.bathrooms} {t("baths")}
              </Text>
            </View>
          )}
          {listing.property.size_sqm !== null && (
            <Text style={styles.spec}>
              {Number(listing.property.size_sqm).toLocaleString(
                locale === "fr" ? "fr-CM" : "en-CM",
              )}{" "}
              m²
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 19,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.sage,
  },
  photo: { aspectRatio: 1.48, backgroundColor: colors.sage },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  photoText: { fontFamily: typography.body, fontSize: 13, color: colors.muted },
  purpose: {
    position: "absolute",
    top: 13,
    left: 13,
    backgroundColor: colors.ivory,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  purposeText: {
    fontFamily: typography.body,
    fontWeight: "700",
    fontSize: 11,
    color: colors.forest,
  },
  content: { padding: 17, gap: 10 },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
  },
  price: {
    fontFamily: typography.heading,
    fontWeight: "700",
    fontSize: 23,
    lineHeight: 30,
    color: colors.forest,
    letterSpacing: -0.7,
  },
  currency: { fontSize: 12, letterSpacing: 0 },
  period: { fontFamily: typography.body, fontSize: 11, color: colors.muted },
  title: {
    fontFamily: typography.heading,
    fontWeight: "600",
    fontSize: 16,
    lineHeight: 23,
    color: colors.forest,
  },
  location: { flexDirection: "row", gap: 5, alignItems: "center" },
  locationText: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 20,
    color: colors.muted,
  },
  specs: {
    borderTopWidth: 1,
    borderColor: colors.sage,
    paddingTop: 13,
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  fact: { flexDirection: "row", alignItems: "center", gap: 5 },
  spec: {
    fontFamily: typography.body,
    fontSize: 11,
    lineHeight: 18,
    color: colors.muted,
  },
});
