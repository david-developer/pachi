import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useLocale } from "../locale";
import { Brand, colors, Icon, typography, useColumns } from "../ui";
import { ListingCard } from "./ListingCard";
import type { PublicListing } from "@pachi/contracts";

export function DiscoveryHeader({
  back = false,
  onBack,
}: {
  back?: boolean;
  onBack?: () => void;
}) {
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        {back && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("back")}
            onPress={
              onBack ??
              (() => (router.canGoBack() ? router.back() : router.replace("/")))
            }
            style={styles.back}
          >
            <Icon name="back" />
          </Pressable>
        )}
        <Brand />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("languageLabel")}
        onPress={() => setLocale(locale === "en" ? "fr" : "en")}
        style={styles.language}
      >
        <Text style={styles.languageText}>{t("language")}</Text>
      </Pressable>
    </View>
  );
}
export function ListingGrid({
  items,
  returnTo = "/",
}: {
  items: PublicListing[];
  returnTo?: string;
}) {
  const columns = useColumns();
  return (
    <View style={styles.grid}>
      {items.map((listing) => (
        <View
          key={listing.id}
          style={{
            width: columns === 1 ? "100%" : columns === 2 ? "49%" : "32%",
            flexGrow: 0,
          }}
        >
          <ListingCard listing={listing} returnTo={returnTo} />
        </View>
      ))}
    </View>
  );
}
export function Loading({ more = false }: { more?: boolean }) {
  const { t } = useLocale();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t(more ? "loadingMore" : "loading")}
      style={styles.loading}
    >
      <ActivityIndicator color={colors.forest} />
      <Text style={styles.loadingText}>
        {t(more ? "loadingMore" : "loading")}
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 52,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.sage,
    borderRadius: 14,
  },
  language: {
    minWidth: 65,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },
  languageText: {
    fontFamily: typography.body,
    color: colors.forest,
    fontSize: 12,
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    columnGap: "2%",
    rowGap: 20,
  },
  loading: {
    paddingVertical: 45,
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    fontFamily: typography.body,
    color: colors.muted,
    fontSize: 14,
  },
});
