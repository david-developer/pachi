import { useEffect, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  validateQuery,
  type Query,
  type QueryErrors,
} from "../data/marketplace";
import { furnishingLabel, propertyLabel } from "../format";
import { useReducedMotion } from "../useReducedMotion";
import { useLocale } from "../locale";
import { Button, Choice, colors, Field, s } from "../ui";

export function FiltersSheet({
  visible,
  query,
  onClose,
  onApply,
}: {
  visible: boolean;
  query: Query;
  onClose: () => void;
  onApply: (query: Query) => void;
}) {
  const reducedMotion = useReducedMotion();
  const { t, locale } = useLocale();
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState<Query>(query);
  const [errors, setErrors] = useState<QueryErrors>({});
  useEffect(() => {
    if (visible) {
      setDraft(query);
      setErrors(validateQuery(query).errors);
    }
  }, [visible, query]);
  const change = (key: keyof Query, value: string) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  };
  const apply = () => {
    const input = { ...draft };
    delete input.cursor;
    const result = validateQuery(input);
    setErrors(result.errors);
    if (!Object.keys(result.errors).length) onApply(result.query);
  };
  const cell = width >= 650 ? styles.half : styles.full;
  const field = (
    key: keyof Query,
    label: string,
    numeric = false,
    placeholder?: string,
  ) => (
    <View style={cell}>
      <Field
        label={t(label)}
        maxLength={key === "neighborhood" ? 160 : 120}
        value={draft[key] ?? ""}
        onChangeText={(v) => change(key, v)}
        numeric={numeric}
        placeholder={placeholder}
        error={errors[key] ? t(errors[key]!) : undefined}
      />
    </View>
  );
  return (
    <Modal
      visible={visible}
      animationType={reducedMotion ? "none" : "slide"}
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <SafeAreaView
          edges={["top", "bottom"]}
          style={styles.sheet}
          accessibilityViewIsModal
        >
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={s.noticeTitle}>
              {t("filterTitle")}
            </Text>
            <Button label={t("close")} variant="ghost" onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <Text style={s.body}>{t("filterSubtitle")}</Text>
            {Object.values(errors).some(Boolean) && (
              <Text accessibilityRole="alert" style={s.error}>
                {t("invalid")}
              </Text>
            )}
            <View style={styles.fields}>
              <View style={cell}>
                <Choice
                  label={t("purpose")}
                  value={draft.purpose ?? ""}
                  options={[
                    { value: "", label: t("anyPurpose") },
                    { value: "RENT", label: t("rent") },
                    { value: "SALE", label: t("buy") },
                    { value: "SHORT_LET", label: t("shortLet") },
                  ]}
                  onChange={(v) => change("purpose", v)}
                />
              </View>
              <View style={cell}>
                <Choice
                  label={t("region")}
                  value={draft.region ?? ""}
                  options={[
                    { value: "", label: t("anyRegion") },
                    { value: "Southwest", label: t("southwest") },
                    { value: "Littoral", label: t("littoral") },
                  ]}
                  onChange={(v) => change("region", v)}
                />
              </View>
              {field("city", "city", false, t("cityPlaceholder"))}
              {field(
                "neighborhood",
                "neighborhood",
                false,
                t("neighborhoodPlaceholder"),
              )}
              <View style={styles.full}>
                <Choice
                  label={t("propertyType")}
                  value={draft.property_type ?? ""}
                  options={[
                    { value: "", label: t("anyType") },
                    ...["HOUSE", "APARTMENT", "ROOM", "LAND", "COMMERCIAL"].map(
                      (value) => ({
                        value,
                        label: propertyLabel(value, locale),
                      }),
                    ),
                  ]}
                  onChange={(v) => change("property_type", v)}
                />
              </View>
              {field("min_price", "minPrice", true)}
              {field("max_price", "maxPrice", true)}
              {field("min_bedrooms", "minBedrooms", true)}
              {field("min_bathrooms", "minBathrooms", true)}
              <View style={cell}>
                <Choice
                  label={t("furnishing")}
                  value={draft.furnishing ?? ""}
                  options={[
                    { value: "", label: t("anyFurnishing") },
                    ...["FURNISHED", "PARTLY_FURNISHED", "UNFURNISHED"].map(
                      (value) => ({
                        value,
                        label: furnishingLabel(value, locale),
                      }),
                    ),
                  ]}
                  onChange={(v) => change("furnishing", v)}
                />
              </View>
              {field("available_from", "availableFrom", false, t("dateHint"))}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Button
              label={t("reset")}
              variant="ghost"
              onPress={() => {
                setDraft({ sort: query.sort ?? "newest" });
                setErrors({});
              }}
            />
            <View style={{ flex: 1 }}>
              <Button
                label={t("apply")}
                testID="filters-apply"
                onPress={apply}
              />
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(14,59,46,0.45)",
  },
  sheet: {
    maxHeight: "95%",
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    backgroundColor: colors.ivory,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },
  heading: {
    padding: 20,
    paddingBottom: 10,
    gap: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  content: { padding: 20, gap: 22 },
  fields: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 20,
  },
  full: { width: "100%" },
  half: { width: "48%" },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderColor: colors.sage,
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.ivory,
  },
});
