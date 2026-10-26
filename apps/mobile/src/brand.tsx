import Svg, { Path } from "react-native-svg";
import { View } from "react-native";
// Exact path geometry from the owner-selected web wordmark; no new logo design.
export function Brand({
  compact = false,
  reversed = false,
}: {
  compact?: boolean;
  reversed?: boolean;
}) {
  return (
    <View accessibilityLabel="Pachi" accessibilityRole="image">
      <Svg
        width={compact ? 100 : 128}
        height={compact ? 30 : 36}
        viewBox="256 316 752 208"
        aria-hidden
      >
        <Path
          d="M265 347H349C387 347 414 367 414 405C414 441 389 463 349 463H304V513H265ZM304 380V430H347C364 430 373 421 373 405C373 389 363 380 347 380Z"
          fill={reversed ? "#F8F6EE" : "#0E3B2E"}
          fillRule="evenodd"
        />
        <Path
          d="M385 516L509 324L628 516H562V458L514 380L451 458V516Z"
          fill={reversed ? "#F8F6EE" : "#0E3B2E"}
          fillRule="evenodd"
        />
        <Path
          d="M463 516V463L480 446V516Z"
          fill={reversed ? "#F8F6EE" : "#0E3B2E"}
          fillRule="evenodd"
        />
        <Path
          d="M533 516V446L550 463V516Z"
          fill={reversed ? "#F8F6EE" : "#0E3B2E"}
          fillRule="evenodd"
        />
        <Path
          d="M491 516V422L521 403V516Z"
          fill={"#C47F56"}
          fillRule="evenodd"
        />
        <Path
          d="M760 371L737 396C727 384 714 378 699 378C670 378 648 400 648 429C648 459 670 480 699 480C714 480 727 473 738 461L761 485C746 504 723 514 699 514C649 514 610 479 610 429C610 380 649 344 699 344C723 344 746 353 760 371Z"
          fill={reversed ? "#F8F6EE" : "#0E3B2E"}
          fillRule="evenodd"
        />
        <Path
          d="M785 347H822V413H895V347H933V513H895V448H822V513H785Z"
          fill={reversed ? "#F8F6EE" : "#0E3B2E"}
          fillRule="evenodd"
        />
        <Path
          d="M961 347H1000V513H961Z"
          fill={reversed ? "#F8F6EE" : "#0E3B2E"}
          fillRule="evenodd"
        />
      </Svg>
    </View>
  );
}
