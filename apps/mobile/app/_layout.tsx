import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { LocaleProvider, useLocale } from "../src/locale";
import { MarketplaceProvider, useMarketplace } from "../src/api";
import { useReducedMotion } from "../src/useReducedMotion";
import { colors } from "../src/ui";
function AppStack() {
  const reducedMotion = useReducedMotion();
  const { isTestPreview } = useMarketplace();
  const { t } = useLocale();
  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.top}>
        {isTestPreview && (
          <View style={styles.banner}>
            <Text style={styles.testTitle}>{t("testLabel")}</Text>
            <Text style={styles.testText}>{t("testDescription")}</Text>
          </View>
        )}
      </SafeAreaView>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.ivory },
          animation: reducedMotion ? "none" : "slide_from_right",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="listings/index" />
        <Stack.Screen name="listings/[id]" />
      </Stack>
    </View>
  );
}
export default function RootLayout() {
  const [loaded, error] = useFonts({
    Manrope: require("../assets/fonts/manrope.ttf"),
    DMSans: require("../assets/fonts/dmsans.ttf"),
  });
  if (!loaded && !error)
    return (
      <View style={styles.loader}>
        <ActivityIndicator accessibilityLabel="Pachi" color={colors.forest} />
      </View>
    );
  return (
    <SafeAreaProvider>
      <LocaleProvider>
        <MarketplaceProvider>
          <AppStack />
        </MarketplaceProvider>
      </LocaleProvider>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ivory },
  top: { backgroundColor: colors.ivory },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ivory,
  },
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.forest,
    gap: 3,
    alignItems: "center",
  },
  testTitle: {
    fontFamily: "DMSans",
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 1.1,
    color: colors.ivory,
  },
  testText: {
    fontFamily: "DMSans",
    fontSize: 10,
    lineHeight: 15,
    color: colors.ivory,
    textAlign: "center",
  },
});
