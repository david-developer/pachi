import { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMarketplace } from "../../src/api";
import {
  DiscoveryHeader,
  ListingGrid,
  Loading,
} from "../../src/components/DiscoveryParts";
import { FiltersSheet } from "../../src/components/FiltersSheet";
import {
  parseQueryParams,
  serializeQuery,
  validateQuery,
  type Query,
} from "../../src/data/marketplace";
import { furnishingLabel, propertyLabel, purposeLabel } from "../../src/format";
import { useLocale } from "../../src/locale";
import {
  Button,
  Choice,
  colors,
  Icon,
  Notice,
  Screen,
  SectionHeading,
  typography,
} from "../../src/ui";
import { useDiscovery } from "../../src/useDiscovery";

function withoutCursor(query: Query): Query {
  const next = { ...query };
  delete next.cursor;
  return next;
}

export default function Results() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const raw = JSON.stringify(params);
  const validated = useMemo(
    () => validateQuery(parseQueryParams(JSON.parse(raw))),
    [raw],
  );
  const valid = !Object.keys(validated.errors).length;
  const query = validated.query;
  const listings = useDiscovery(withoutCursor(query), valid);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { configured } = useMarketplace();
  const router = useRouter();
  const { t, locale } = useLocale();
  const apply = (next: Query) => {
    if (Object.keys(validateQuery(next).errors).length) {
      setFiltersOpen(true);
      return;
    }
    setFiltersOpen(false);
    const search = serializeQuery(withoutCursor(next)).toString();
    router.replace(`/listings${search ? `?${search}` : ""}`);
  };
  const chips = Object.entries(query).filter(
    ([key, value]) => value && !["sort", "limit", "cursor"].includes(key),
  );
  const chipLabel = (key: string, value: string) => {
    if (key === "purpose") return purposeLabel(value, locale);
    if (key === "property_type") return propertyLabel(value, locale);
    if (key === "furnishing") return furnishingLabel(value, locale);
    const labels: Record<string, string> = {
      min_price: "minPrice",
      max_price: "maxPrice",
      min_bedrooms: "minBedrooms",
      min_bathrooms: "minBathrooms",
      available_from: "availableFrom",
    };
    return labels[key]
      ? `${t(labels[key])}: ${value}`
      : key === "region" && value === "Southwest"
        ? t("southwest")
        : value;
  };
  return (
    <Screen onRefresh={listings.retry} refreshing={false}>
      <DiscoveryHeader back />
      <SectionHeading
        eyebrow={t("resultsEyebrow")}
        title={t("resultsTitle")}
        subtitle={t("resultsSubtitle")}
      />
      <View style={styles.controls}>
        <View style={{ flex: 1 }}>
          <Choice
            label={t("sort")}
            value={query.sort ?? "newest"}
            options={[
              { value: "newest", label: t("newest") },
              { value: "price_asc", label: t("priceAsc") },
              { value: "price_desc", label: t("priceDesc") },
            ]}
            onChange={(value) =>
              apply({ ...query, sort: value as NonNullable<Query["sort"]> })
            }
          />
        </View>
        <Pressable
          testID="filters-open"
          accessibilityRole="button"
          accessibilityLabel={t("filters")}
          onPress={() => setFiltersOpen(true)}
          style={styles.filters}
        >
          <Icon name="filters" />
          <Text style={styles.filterText}>
            {t("filters")}
            {chips.length ? ` · ${chips.length}` : ""}
          </Text>
        </Pressable>
      </View>
      {chips.length > 0 && (
        <View style={styles.chips}>
          {chips.map(([key, value]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${t("removeFilter")}: ${chipLabel(key, value!)}`}
              onPress={() => {
                const next = { ...query };
                delete next[key as keyof Query];
                apply(next);
              }}
              style={styles.chip}
            >
              <Text style={styles.chipText}>{chipLabel(key, value!)}</Text>
              <Icon name="close" size={13} />
            </Pressable>
          ))}
        </View>
      )}
      {!valid ? (
        <Notice
          title={t("invalid")}
          message={Object.values(validated.errors)
            .map((error) => t(error!))
            .join(" ")}
          action={t("reset")}
          onAction={() => apply({})}
          kind="error"
        />
      ) : !configured ? (
        <Notice
          title={t("configurationError")}
          message={t("configurationMessage")}
        />
      ) : listings.loading ? (
        <Loading />
      ) : listings.error ? (
        <Notice
          title={t("resultsError")}
          message={t("errorMessage")}
          action={t("retry")}
          onAction={listings.retry}
          kind="error"
        />
      ) : (
        <>
          <Text
            testID="results-count"
            accessibilityLiveRegion="polite"
            style={styles.count}
          >
            {listings.items.length} {t("resultsLoaded")}
          </Text>
          {listings.items.length ? (
            <ListingGrid
              items={listings.items}
              returnTo={`/listings?${serializeQuery(withoutCursor(query))}`}
            />
          ) : (
            <Notice
              title={t("noResults")}
              message={t("noResultsMessage")}
              action={chips.length ? t("reset") : undefined}
              onAction={() => apply({})}
            />
          )}
          {listings.pageError && (
            <Notice
              title={t("pageError")}
              message={t("pageErrorMessage")}
              action={t("retry")}
              onAction={() => {
                void listings.loadMore();
              }}
              kind="error"
            />
          )}
          {listings.more && !listings.pageError && (
            <Button
              testID="load-more"
              label={t(listings.paging ? "loadingMore" : "more")}
              onPress={() => {
                void listings.loadMore();
              }}
              loading={listings.paging}
              variant="secondary"
            />
          )}
          {!listings.more && listings.items.length > 0 && (
            <Text style={styles.end}>{t("endResults")}</Text>
          )}
        </>
      )}
      <FiltersSheet
        visible={filtersOpen}
        query={query}
        onClose={() => setFiltersOpen(false)}
        onApply={apply}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  filters: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 17,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.forest,
    backgroundColor: colors.sage,
  },
  filterText: {
    fontFamily: typography.body,
    fontSize: 13,
    fontWeight: "700",
    color: colors.forest,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: "100%",
  },
  chipText: {
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 20,
    color: colors.forest,
    flexShrink: 1,
  },
  count: { fontFamily: typography.body, fontSize: 12, color: colors.muted },
  end: {
    fontFamily: typography.body,
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    paddingVertical: 8,
  },
});
