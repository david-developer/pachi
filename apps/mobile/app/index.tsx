import type { PublicListingQuery } from "@pachi/contracts";
import { useState } from "react";
import { useRouter } from "expo-router";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useMarketplace } from "../src/api";
import {
  DiscoveryHeader,
  ListingGrid,
  Loading,
} from "../src/components/DiscoveryParts";
import {
  serializeQuery,
  validateQuery,
  type QueryErrors,
} from "../src/data/marketplace";
import { propertyLabel } from "../src/format";
import { useLocale } from "../src/locale";
import {
  ArchitecturalMark,
  Button,
  Choice,
  colors,
  Field,
  Notice,
  Screen,
  SectionHeading,
  typography,
} from "../src/ui";
import { useDiscovery } from "../src/useDiscovery";

export default function Home() {
  const router = useRouter();
  const { client, configured } = useMarketplace();
  const { t, locale } = useLocale();
  const { width } = useWindowDimensions();
  const listings = useDiscovery({ limit: "6" });
  const [purpose, setPurpose] =
    useState<NonNullable<PublicListingQuery["purpose"]>>("RENT");
  const [city, setCity] = useState("");
  const [property, setProperty] = useState<
    NonNullable<PublicListingQuery["property_type"]> | ""
  >("");
  const [budget, setBudget] = useState("");
  const [errors, setErrors] = useState<QueryErrors>({});
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const heroListing = listings.items.find((listing) => listing.media.length);
  const hero = heroListing
    ? client.mediaUrl(
        heroListing.id,
        heroListing.media.find((media) => media.is_cover) ??
          heroListing.media[0],
        1280,
      )
    : null;
  const search = () => {
    const result = validateQuery({
      purpose,
      city,
      ...(property ? { property_type: property } : {}),
      max_price: budget,
    });
    setErrors(result.errors);
    if (!Object.keys(result.errors).length)
      router.push(`/listings?${serializeQuery(result.query)}`);
  };
  return (
    <Screen onRefresh={listings.retry} refreshing={false}>
      <DiscoveryHeader />
      <View style={styles.hero}>
        {hero && failedPhoto !== hero ? (
          <Image
            source={{ uri: hero }}
            onError={() => setFailedPhoto(hero)}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessible={false}
          />
        ) : (
          <View style={styles.heroMark}>
            <ArchitecturalMark size={200} reversed />
          </View>
        )}
        <View style={styles.heroShade} />
        <View
          style={[
            styles.heroContent,
            width >= 768 && { padding: 42, minHeight: 350 },
          ]}
        >
          <Text style={styles.eyebrow}>{t("homeEyebrow")}</Text>
          <Text
            accessibilityRole="header"
            style={[
              styles.heroTitle,
              width >= 768 && { fontSize: 52, lineHeight: 60 },
            ]}
          >
            {t("homeTitle")}
          </Text>
          <Text style={styles.heroSubtitle}>{t("homeSubtitle")}</Text>
          <View style={styles.region}>
            <Text style={styles.regionText}>{t("regions")}</Text>
          </View>
        </View>
      </View>
      <View
        style={[styles.searchCard, width >= 768 && { marginHorizontal: 32 }]}
      >
        <View accessibilityRole="tablist" style={styles.tabs}>
          {(
            [
              ["RENT", "rent"],
              ["SALE", "buy"],
              ["SHORT_LET", "shortLet"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: purpose === value }}
              onPress={() => setPurpose(value)}
              style={[styles.tab, purpose === value && styles.activeTab]}
            >
              <Text
                style={[
                  styles.tabText,
                  purpose === value && { color: colors.ivory },
                ]}
              >
                {t(label)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Field
          label={t("city")}
          testID="city-input"
          value={city}
          onChangeText={setCity}
          placeholder={t("cityPlaceholder")}
          error={errors.city ? t(errors.city) : undefined}
        />
        <View style={styles.searchRow}>
          <View style={styles.half}>
            <Choice
              label={t("propertyType")}
              value={property}
              options={[
                { value: "", label: t("anyType") },
                ...["HOUSE", "APARTMENT", "ROOM", "LAND", "COMMERCIAL"].map(
                  (value) => ({ value, label: propertyLabel(value, locale) }),
                ),
              ]}
              onChange={(value) => setProperty(value as typeof property)}
            />
          </View>
          <View style={styles.half}>
            <Field
              label={t("budget")}
              value={budget}
              onChangeText={setBudget}
              numeric
              placeholder={t("anyBudget")}
              error={errors.max_price ? t(errors.max_price) : undefined}
            />
          </View>
        </View>
        <Button label={t("homeSearch")} onPress={search} />
        <Text style={styles.searchHint}>{t("cityHint")}</Text>
      </View>
      <View style={styles.latestHeading}>
        <SectionHeading title={t("latest")} subtitle={t("latestSubtitle")} />
        <Button
          label={t("allHomes")}
          variant="ghost"
          onPress={() => router.push("/listings")}
        />
      </View>
      {!configured ? (
        <Notice
          title={t("configurationError")}
          message={t("configurationMessage")}
        />
      ) : listings.loading ? (
        <Loading />
      ) : listings.error ? (
        <Notice
          title={t("homeError")}
          message={t("errorMessage")}
          action={t("retry")}
          onAction={listings.retry}
          kind="error"
        />
      ) : listings.items.length ? (
        <ListingGrid items={listings.items} />
      ) : (
        <Notice title={t("homeEmpty")} message={t("homeEmptyMessage")} />
      )}
      <View style={styles.footer}>
        <ArchitecturalMark size={28} />
        <Text style={styles.footerText}>Pachi · {t("regions")}</Text>
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  hero: {
    borderRadius: 26,
    backgroundColor: colors.forest,
    overflow: "hidden",
  },
  heroMark: { position: "absolute", right: -15, top: 35, opacity: 0.12 },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,28,21,0.67)",
  },
  heroContent: {
    padding: 26,
    minHeight: 345,
    justifyContent: "center",
    gap: 17,
    paddingBottom: 50,
  },
  eyebrow: {
    fontFamily: typography.body,
    fontWeight: "700",
    fontSize: 10,
    lineHeight: 17,
    letterSpacing: 1.7,
    color: colors.ivory,
  },
  heroTitle: {
    fontFamily: typography.heading,
    fontWeight: "700",
    fontSize: 36,
    lineHeight: 44,
    letterSpacing: -1.5,
    color: colors.ivory,
  },
  heroSubtitle: {
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: colors.ivory,
    maxWidth: 340,
  },
  region: {
    alignSelf: "flex-start",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.sage,
  },
  regionText: {
    fontFamily: typography.body,
    fontSize: 10,
    color: colors.ivory,
    letterSpacing: 0.5,
  },
  searchCard: {
    marginTop: -53,
    marginHorizontal: 12,
    backgroundColor: colors.ivory,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.sage,
    padding: 18,
    gap: 18,
    boxShadow: "0px 8px 28px rgba(14,59,46,0.06)",
  },
  tabs: {
    flexDirection: "row",
    padding: 4,
    gap: 4,
    backgroundColor: colors.sage,
    borderRadius: 14,
  },
  tab: {
    flex: 1,
    minHeight: 46,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    borderRadius: 11,
  },
  activeTab: { backgroundColor: colors.forest },
  tabText: {
    fontFamily: typography.body,
    color: colors.forest,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },
  searchRow: { flexDirection: "row", gap: 12 },
  half: { flex: 1, minWidth: 0 },
  searchHint: {
    fontFamily: typography.body,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    color: colors.muted,
  },
  latestHeading: { marginTop: 7, gap: 8, alignItems: "flex-start" },
  footer: {
    borderTopWidth: 1,
    borderColor: colors.sage,
    paddingTop: 26,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  footerText: {
    fontFamily: typography.body,
    fontSize: 12,
    color: colors.muted,
  },
});
