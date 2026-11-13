import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useState, type ReactNode } from "react";
import { useLocale } from "./locale";
import { useReducedMotion } from "./useReducedMotion";
export { Brand } from "./brand";
export const colors = {
  forest: "#0E3B2E",
  copper: "#C47F56",
  ivory: "#F8F6EE",
  sage: "#D6DECF",
  muted: "#4D6257",
  border: "#718073",
  error: "#9D352D",
  white: "#FFFFFF",
};
export const typography = { heading: "Manrope", body: "DMSans" };
export function Screen({
  children,
  scroll = true,
  style,
  contentStyle,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <SafeAreaView style={[s.screen, style]} edges={["left", "right", "bottom"]}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.content, contentStyle]}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.forest}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[s.content, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === "secondary" && s.secondary,
        variant === "ghost" && s.ghost,
        { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading && (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? colors.ivory : colors.forest}
        />
      )}
      <Text
        style={[
          s.buttonText,
          variant !== "primary" && { color: colors.forest },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={s.sectionHeading}>
      {eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}
      <Text accessibilityRole="header" style={s.title}>
        {title}
      </Text>
      {subtitle && <Text style={s.body}>{subtitle}</Text>}
    </View>
  );
}
export function Notice({
  title,
  message,
  action,
  onAction,
  kind = "neutral",
}: {
  title: string;
  message?: string;
  action?: string | undefined;
  onAction?: () => void;
  kind?: "error" | "neutral";
}) {
  return (
    <View
      accessibilityRole={kind === "error" ? "alert" : undefined}
      style={[s.notice, kind === "error" && { borderColor: colors.error }]}
    >
      <ArchitecturalMark size={36} />
      <Text accessibilityRole="header" style={s.noticeTitle}>
        {title}
      </Text>
      {message && <Text style={s.body}>{message}</Text>}
      {action && onAction && (
        <Button label={action} onPress={onAction} variant="secondary" />
      )}
    </View>
  );
}
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  numeric = false,
  testID,
  maxLength = 120,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string | undefined;
  error?: string | undefined;
  numeric?: boolean;
  testID?: string;
  maxLength?: number;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={error}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        inputMode={numeric ? "numeric" : "text"}
        keyboardType={numeric ? "number-pad" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={numeric ? 16 : maxLength}
        style={[s.input, error && { borderColor: colors.error }]}
      />
      {error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
    </View>
  );
}
export function Choice({
  label,
  value,
  options,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const { t } = useLocale();
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${options.find((o) => o.value === value)?.label ?? value}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          s.input,
          s.choice,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[s.body, { flex: 1 }]}>
          {options.find((o) => o.value === value)?.label ?? value}
        </Text>
        <Icon name="chevron" size={16} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={() => setOpen(false)}
      >
        <View style={s.scrim}>
          <View style={s.choiceSheet} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={s.noticeTitle}>
              {label}
            </Text>
            <ScrollView>
              {options.map((o) => (
                <Pressable
                  key={o.value || "all"}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: o.value === value }}
                  accessibilityLabel={o.label}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    s.choiceOption,
                    {
                      backgroundColor:
                        pressed || o.value === value
                          ? colors.sage
                          : colors.ivory,
                    },
                  ]}
                >
                  <Text style={s.body}>{o.label}</Text>
                  {o.value === value && <Text style={s.body}>✓</Text>}
                </Pressable>
              ))}
            </ScrollView>
            <Button
              label={t("close")}
              onPress={() => setOpen(false)}
              variant="ghost"
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
export function ArchitecturalMark({
  size = 70,
  reversed = false,
}: {
  size?: number;
  reversed?: boolean;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="385 324 243 192"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <Path
        d="M385 516L509 324L628 516H562V458L514 380L451 458V516ZM463 516V463L480 446V516ZM533 516V446L550 463V516Z"
        fill={reversed ? colors.ivory : colors.forest}
        fillRule="evenodd"
      />
      <Path d="M491 516V422L521 403V516Z" fill={colors.copper} />
    </Svg>
  );
}
type IconName =
  | "search"
  | "chevron"
  | "back"
  | "close"
  | "filters"
  | "pin"
  | "bed"
  | "bath"
  | "area";
const paths: Record<IconName, string> = {
  search: "M21 21l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  chevron: "m6 9 6 6 6-6",
  back: "m14 6-6 6 6 6M8 12h12",
  close: "m6 6 12 12M18 6 6 18",
  filters: "M4 6h16M7 12h10M10 18h4",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  bed: "M3 17v4M21 17v4M3 8v9h18V8M3 13h18M6 13V8h12v5",
  bath: "M4 11h16v3a7 7 0 0 1-14 0v-3ZM6 11V5a3 3 0 0 1 6 0M7 20v2M17 20v2",
  area: "M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6",
};
export function Icon({
  name,
  size = 20,
  color = colors.forest,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <Path
        d={paths[name]}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
export function useColumns() {
  const { width } = useWindowDimensions();
  return width >= 1000 ? 3 : width >= 650 ? 2 : 1;
}
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ivory },
  content: {
    width: "100%",
    maxWidth: 1140,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 24,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: colors.forest,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
  },
  secondary: {
    backgroundColor: colors.ivory,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: { backgroundColor: "transparent", paddingHorizontal: 10 },
  buttonText: {
    fontFamily: typography.body,
    fontWeight: "700",
    fontSize: 15,
    lineHeight: 22,
    color: colors.ivory,
    textAlign: "center",
  },
  sectionHeading: { gap: 9 },
  eyebrow: {
    fontFamily: typography.body,
    fontWeight: "700",
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1.9,
    color: colors.muted,
  },
  title: {
    fontFamily: typography.heading,
    fontWeight: "700",
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -1,
    color: colors.forest,
  },
  body: {
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: colors.muted,
  },
  notice: {
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.sage,
    gap: 14,
    alignItems: "flex-start",
  },
  noticeTitle: {
    fontFamily: typography.heading,
    fontWeight: "700",
    fontSize: 21,
    lineHeight: 29,
    color: colors.forest,
  },
  label: {
    fontFamily: typography.body,
    fontWeight: "600",
    fontSize: 12,
    lineHeight: 18,
    color: colors.forest,
  },
  field: { gap: 7, flexGrow: 1 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.forest,
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 23,
    backgroundColor: colors.ivory,
  },
  error: {
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.error,
  },
  choice: { flexDirection: "row", alignItems: "center", gap: 8 },
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(14,59,46,0.4)",
    padding: 16,
  },
  choiceSheet: {
    backgroundColor: colors.ivory,
    borderRadius: 24,
    padding: 20,
    gap: 16,
    maxHeight: "80%",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  choiceOption: {
    minHeight: 50,
    padding: 14,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
