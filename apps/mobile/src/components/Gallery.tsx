import type { PublicListing } from "@pachi/contracts";
import { useMemo, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMarketplace } from "../api";
import { detailCopy } from "../detail-copy";
import { useLocale } from "../locale";
import { colors as palette } from "../ui";

/** All images use public derivative URLs supplied by the existing marketplace contract. */
export function Gallery({ listing }: { listing: PublicListing }) {
  const { client } = useMarketplace();
  const { locale } = useLocale();
  const copy = detailCopy(locale);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const media = useMemo(
    () =>
      [...new Map(listing.media.map((item) => [item.id, item])).values()].sort(
        (a, b) => Number(b.is_cover) - Number(a.is_cover),
      ),
    [listing.media],
  );
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const active = media[selected] ?? media[0];
  const photoLabel = `${copy.photo} ${selected + 1} ${copy.of} ${media.length}`;
  const imageUrl = (index: number, size: 320 | 1280 | 1920) => {
    const item = media[index];
    return item ? client.mediaUrl(listing.id, item, size) : null;
  };
  const fail = (url: string) =>
    setFailed((previous) => new Set(previous).add(url));
  const next = () => setSelected((value) => (value + 1) % media.length);
  const previous = () =>
    setSelected((value) => (value - 1 + media.length) % media.length);

  const photo = (fullScreen: boolean) => {
    const url = imageUrl(selected, fullScreen ? 1920 : 1280);
    return url && !failed.has(url) ? (
      <Image
        source={{ uri: url }}
        style={fullScreen ? styles.fullImage : styles.image}
        resizeMode={fullScreen ? "contain" : "cover"}
        accessibilityLabel={`${listing.title}. ${photoLabel}`}
        onError={() => fail(url)}
      />
    ) : (
      <View style={[styles.placeholder, fullScreen && styles.fullPlaceholder]}>
        <View style={styles.architecture} accessible={false}>
          <View style={styles.architectureLine} />
          <View style={styles.architectureCopper} />
          <View style={styles.architectureLine} />
        </View>
        <Text style={styles.placeholderTitle}>
          {active ? copy.imageUnavailable : copy.noPhotos}
        </Text>
        <Text style={styles.placeholderText}>
          {active ? copy.imageUnavailableNote : copy.noPhotosNote}
        </Text>
      </View>
    );
  };

  const navigation = (fullScreen = false) => (
    <View style={[styles.controls, fullScreen && styles.fullControls]}>
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.counter, fullScreen && styles.lightText]}
      >
        {photoLabel}
      </Text>
      {media.length > 1 && (
        <View style={styles.arrows}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.previous}
            onPress={previous}
            style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
          >
            <Text style={styles.arrowText}>←</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.next}
            onPress={next}
            style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
          >
            <Text style={styles.arrowText}>→</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const thumbnails = (fullScreen = false) =>
    media.length > 1 && (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.thumbnailStrip}
        contentContainerStyle={[
          styles.thumbnails,
          fullScreen && styles.fullThumbnails,
        ]}
        accessibilityLabel={copy.gallery}
      >
        {media.map((item, index) => {
          const url = imageUrl(index, 320);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${copy.select} ${index + 1}`}
              accessibilityState={{ selected: selected === index }}
              onPress={() => setSelected(index)}
              style={[
                styles.thumbnail,
                selected === index && styles.selectedThumbnail,
              ]}
            >
              {url && !failed.has(url) ? (
                <Image
                  source={{ uri: url }}
                  style={styles.thumbnailImage}
                  accessible={false}
                  resizeMode="cover"
                  onError={() => fail(url)}
                />
              ) : (
                <Text style={styles.thumbnailFallback}>{index + 1}</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    );

  return (
    <View style={styles.gallery}>
      <View style={[styles.stage, width >= 900 && styles.wideStage]}>
        {media.length > 0 ? (
          <Pressable
            style={styles.imageButton}
            accessibilityRole="button"
            accessibilityLabel={`${copy.openGallery}. ${photoLabel}`}
            onPress={() => setOpen(true)}
          >
            {photo(false)}
          </Pressable>
        ) : (
          photo(false)
        )}
        {media.length > 0 && (
          <Pressable
            style={styles.expand}
            accessibilityRole="button"
            accessibilityLabel={copy.openGallery}
            onPress={() => setOpen(true)}
          >
            <Text style={styles.expandText}>↗ {copy.fullScreen}</Text>
          </Pressable>
        )}
      </View>
      {media.length > 0 && (
        <>
          {navigation()}
          {thumbnails()}
        </>
      )}
      <Modal
        visible={open}
        animationType="none"
        presentationStyle="fullScreen"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={[
            styles.modal,
            {
              paddingTop: Math.max(insets.top, 20),
              paddingBottom: Math.max(insets.bottom, 24),
            },
          ]}
          accessibilityViewIsModal
          onAccessibilityEscape={() => setOpen(false)}
        >
          <View style={styles.modalHeader}>
            <View style={styles.modalTitle}>
              <Text style={styles.modalEyebrow}>{copy.gallery}</Text>
              <Text style={styles.modalHeading} numberOfLines={2}>
                {listing.title}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.closeGallery}
              onPress={() => setOpen(false)}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <View style={styles.fullStage}>{photo(true)}</View>
          {navigation(true)}
          {thumbnails(true)}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { gap: 12 },
  stage: {
    aspectRatio: 4 / 3,
    borderRadius: 24,
    backgroundColor: palette.sage,
    overflow: "hidden",
    position: "relative",
  },
  wideStage: { aspectRatio: 2.1 },
  imageButton: { flex: 1 },
  image: { width: "100%", height: "100%" },
  placeholder: {
    flex: 1,
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 12,
    backgroundColor: palette.sage,
  },
  placeholderTitle: {
    fontFamily: "Manrope",
    fontSize: 18,
    fontWeight: "600",
    color: palette.forest,
    textAlign: "center",
  },
  placeholderText: {
    fontFamily: "DMSans",
    color: palette.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 290,
  },
  architecture: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 7,
    height: 50,
    marginBottom: 8,
  },
  architectureLine: {
    height: 34,
    width: 3,
    backgroundColor: palette.forest,
    transform: [{ skewY: "-18deg" }],
  },
  architectureCopper: {
    height: 48,
    width: 29,
    backgroundColor: palette.copper,
    transform: [{ skewY: "-18deg" }],
  },
  expand: {
    position: "absolute",
    bottom: 16,
    right: 16,
    minHeight: 44,
    borderRadius: 13,
    backgroundColor: palette.ivory,
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.forest,
  },
  expandText: {
    fontFamily: "DMSans",
    color: palette.forest,
    fontSize: 13,
    fontWeight: "700",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: 2,
  },
  counter: {
    fontFamily: "DMSans",
    color: palette.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  arrows: { flexDirection: "row", gap: 8 },
  arrow: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: palette.forest,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.ivory,
  },
  arrowText: { color: palette.forest, fontSize: 22 },
  pressed: { opacity: 0.65 },
  thumbnailStrip: { flexGrow: 0, maxHeight: 72 },
  thumbnails: { gap: 10, padding: 3 },
  thumbnail: {
    width: 76,
    height: 60,
    borderRadius: 11,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: palette.sage,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedThumbnail: { borderColor: palette.forest },
  thumbnailImage: { width: "100%", height: "100%" },
  thumbnailFallback: {
    fontFamily: "DMSans",
    color: palette.forest,
    fontSize: 15,
    fontWeight: "600",
  },
  modal: { flex: 1, backgroundColor: palette.forest },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  modalTitle: { flex: 1, gap: 6 },
  modalEyebrow: {
    fontFamily: "DMSans",
    color: palette.sage,
    fontSize: 12,
    letterSpacing: 1,
  },
  modalHeading: {
    fontFamily: "Manrope",
    color: palette.ivory,
    fontSize: 20,
    fontWeight: "600",
  },
  close: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.ivory,
  },
  closeText: { color: palette.forest, fontSize: 30 },
  fullStage: { flex: 1, minHeight: 160 },
  fullImage: { width: "100%", height: "100%" },
  fullPlaceholder: { marginHorizontal: 24, borderRadius: 20 },
  fullControls: { paddingHorizontal: 24, paddingVertical: 14 },
  lightText: { color: palette.ivory },
  fullThumbnails: { paddingHorizontal: 24, paddingVertical: 4 },
});
