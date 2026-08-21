import { StatusBar } from "expo-status-bar";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { PuzzleConfig, Point, getLevelConfig, rotateShape, flipShape, TOTAL_LEVELS } from "./src/game";
import {
  continueAsGuest,
  fetchCurrentUser,
  fetchProgress,
  loginGoogle,
  loginNickname,
  registerNickname,
  saveProgress,
  signOut,
} from "./src/api/client";
import { CloudProgress, CloudUser } from "./src/api/types";

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? "";
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() ?? "";
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? "";

type Screen = "home" | "game" | "profile" | "levels" | "stats" | "arena" | "multiplayer";
type ThemeMode = "light" | "dark";
type AuthMode = "login" | "register";

function GoogleAuthButton({
  busy,
  onIdToken,
  onError,
}: {
  busy: boolean;
  onIdToken: (idToken: string) => void;
  onError: (message: string) => void;
}) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    selectAccount: true,
  });
  const handledResponseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!response || (response.type !== "success" && response.type !== "error")) return;
    const responseKey = `${response.type}:${response.url}`;
    if (handledResponseRef.current === responseKey) return;
    handledResponseRef.current = responseKey;

    if (response.type === "error") {
      onError(response.error?.message ?? "Google sign-in could not be completed.");
      return;
    }

    const idToken = response.params.id_token;
    if (!idToken) {
      onError("Google did not return an identity token.");
      return;
    }
    onIdToken(idToken);
  }, [onError, onIdToken, response]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      disabled={!request || busy}
      style={({ pressed }) => [
        styles.googleButton,
        { opacity: !request || busy ? 0.58 : pressed ? 0.88 : 1 },
      ]}
      onPress={() => {
        onError("");
        void promptAsync().catch(() => onError("Google sign-in could not be opened."));
      }}
    >
      {busy ? (
        <ActivityIndicator color="#4285f4" />
      ) : (
        <MaterialCommunityIcons name="google" size={21} color="#4285f4" />
      )}
      <Text style={styles.googleButtonText}>Continue with Google</Text>
    </Pressable>
  );
}

function GoogleSignInSection({
  busy,
  onIdToken,
  onError,
}: {
  busy: boolean;
  onIdToken: (idToken: string) => void;
  onError: (message: string) => void;
}) {
  const configured = Platform.select({
    android: Boolean(GOOGLE_ANDROID_CLIENT_ID),
    ios: Boolean(GOOGLE_IOS_CLIENT_ID),
    default: Boolean(GOOGLE_WEB_CLIENT_ID),
  });

  if (configured) {
    return <GoogleAuthButton busy={busy} onIdToken={onIdToken} onError={onError} />;
  }

  return (
    <>
      <View style={[styles.googleButton, styles.googleButtonDisabled]}>
        <MaterialCommunityIcons name="google" size={21} color="#8b96aa" />
        <Text style={[styles.googleButtonText, styles.googleButtonTextDisabled]}>Continue with Google</Text>
      </View>
      <Text style={styles.googleConfigHint}>Google sign-in needs the Android OAuth client ID.</Text>
    </>
  );
}

interface PieceState {
  id: string;
  color: string;
  shape: Point[];
  originalShape: Point[];
  placement: { x: number; y: number } | null;
  stagingPosition: { x: number; y: number } | null;
}

const GAME_COLORS = {
  bg: "#050d1b",
  panel: "#101a2b",
  panelSoft: "#0c1525",
  border: "#27354c",
  grid: "#2d3a50",
  frame: "#435069",
  cell: "#101a2a",
  text: "#f5f7ff",
  muted: "#8c9ab5",
  blue: "#7189ff",
  cyan: "#11d5ff",
  amber: "#ffb72b",
};

const LIGHT_GAME_COLORS = {
  bg: "#eef3fb",
  panel: "#ffffff",
  panelSoft: "#f5f7fc",
  border: "#cbd6e6",
  grid: "#c7d1df",
  frame: "#8d9ab0",
  cell: "#f7f9fc",
  text: "#10192b",
  muted: "#60708d",
  blue: "#4569e8",
  cyan: "#079fc9",
  amber: "#b96d00",
};

// A real finger moves a few pixels during a tap. Keep that jitter from
// turning board taps into accidental drags while preserving quick pickup.
const TOUCH_DRAG_THRESHOLD_PX = 8;
const TOUCH_LONG_PRESS_MS = 420;
const TOUCH_TAP_MAX_DISTANCE_PX = 14;
const TOUCH_TAP_MAX_DURATION_MS = 320;

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function PentaBlocksWordmark({ hero = false, dark = true }: { hero?: boolean; dark?: boolean }) {
  const coloredLetters = [
    { letter: "B", color: "#ff9f1a" },
    { letter: "L", color: "#ff3b68" },
    { letter: "O", color: "#b43cff" },
    { letter: "C", color: "#18bfff" },
    { letter: "K", color: "#04d76a" },
    { letter: "S", color: "#ffd21a" },
  ];
  const blockColors = ["#ff3864", "#ff9718", "#ffdc18", "#25d929", "#16b9ff"];
  const outlineOffsets = [
    { x: -1.35, y: 0 },
    { x: 1.35, y: 0 },
    { x: 0, y: -1.35 },
    { x: 0, y: 1.35 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: 1, y: 1 },
  ];

  return (
    <View style={styles.wordmarkLockup}>
      <View style={styles.wordmarkTextStack}>
        {!dark
          ? outlineOffsets.map(({ x, y }, index) => (
              <Text
                key={`wordmark-outline-${index}`}
                pointerEvents="none"
                style={[
                  styles.wordmark,
                  hero && styles.wordmarkHero,
                  styles.wordmarkOutline,
                  { transform: [{ translateX: x }, { translateY: y }] },
                ]}
                numberOfLines={1}
              >
                PENTABLOCKS
              </Text>
            ))
          : null}
        <Text style={[styles.wordmark, hero && styles.wordmarkHero, !dark && styles.wordmarkLight]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          <Text style={[styles.wordmarkBase, !dark && styles.wordmarkBaseLight]}>PENTA</Text>
          {coloredLetters.map(({ letter, color }) => (
            <Text key={letter} style={{ color }}>{letter}</Text>
          ))}
        </Text>
      </View>
      <View style={[styles.wordmarkOrnaments, hero && styles.wordmarkOrnamentsHero]}>
        <View style={[styles.wordmarkRule, hero && styles.wordmarkRuleHero, styles.wordmarkRuleWarm]} />
        <View style={styles.wordmarkBlocks}>
          {blockColors.map((color, index) => (
            <View key={`${color}-${index}`} style={[styles.wordmarkBlock, { backgroundColor: color }]} />
          ))}
        </View>
        <View style={[styles.wordmarkRule, hero && styles.wordmarkRuleHero, styles.wordmarkRuleCool]} />
      </View>
    </View>
  );
}

function HomeMenuButton({
  label,
  icon,
  backgroundColor,
  textColor = "#ffffff",
  borderColor = "transparent",
  badge,
  onPress,
}: {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  backgroundColor: string;
  textColor?: string;
  borderColor?: string;
  badge?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.homeMenuButton,
        { backgroundColor, borderColor, transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}
      onPress={onPress}
    >
      <MaterialCommunityIcons name={icon} size={25} color={textColor} />
      <Text style={[styles.homeMenuButtonText, { color: textColor }]}>{label}</Text>
      {badge ? (
        <View style={styles.homeMenuBadge}>
          <Text style={styles.homeMenuBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function PiecePreview({
  piece,
  cellSize,
  availableWidth,
  availableHeight,
  preserveCellSize = false,
  selected = false,
  dragging = false,
}: {
  piece: PieceState;
  cellSize: number;
  availableWidth: number;
  availableHeight: number;
  preserveCellSize?: boolean;
  selected?: boolean;
  dragging?: boolean;
}) {
  const { maxX, maxY, fittedCellSize } = getPiecePreviewMetrics(
    piece,
    cellSize,
    availableWidth,
    availableHeight,
    preserveCellSize
  );
  return (
    <View style={{ width: (maxX + 1) * fittedCellSize, height: (maxY + 1) * fittedCellSize }}>
      {piece.shape.map((cell, index) => (
        <View
          key={`${piece.id}-preview-${index}`}
          style={[
            styles.previewCell,
            {
              width: fittedCellSize - 2,
              height: fittedCellSize - 2,
              left: cell.x * fittedCellSize,
              top: cell.y * fittedCellSize,
              backgroundColor: piece.color,
              shadowColor: piece.color,
              shadowOpacity: dragging ? 0 : 0.55,
              shadowRadius: dragging ? 0 : 5,
              elevation: dragging ? 0 : 3,
              borderColor: selected ? "#dbe2ff" : "rgba(255,255,255,0.34)",
              borderWidth: selected ? 2 : 1,
            },
          ]}
        />
      ))}
    </View>
  );
}

function getPiecePreviewMetrics(
  piece: PieceState,
  cellSize: number,
  availableWidth = 96,
  availableHeight = 56,
  preserveCellSize = false
) {
  const maxX = Math.max(...piece.shape.map((cell) => cell.x));
  const maxY = Math.max(...piece.shape.map((cell) => cell.y));
  const fittedCellSize = preserveCellSize
    ? cellSize
    : Math.max(
        9,
        Math.min(
          cellSize,
          Math.floor(availableWidth / (maxX + 1)),
          Math.floor(availableHeight / (maxY + 1))
        )
      );
  return {
    maxX,
    maxY,
    fittedCellSize,
    width: (maxX + 1) * fittedCellSize,
    height: (maxY + 1) * fittedCellSize,
  };
}

function DraggablePiece({
  piece,
  cellSize,
  slotHeight = 60,
  slotWidth,
  preserveCellSize = false,
  selected,
  disabled,
  stagingPosition,
  boardPosition,
  onSelect,
  onDrop,
  onRotate,
  onFlip,
}: {
  piece: PieceState;
  cellSize: number;
  slotHeight?: number;
  slotWidth?: number;
  preserveCellSize?: boolean;
  selected: boolean;
  disabled: boolean;
  stagingPosition?: { x: number; y: number } | null;
  boardPosition?: { x: number; y: number } | null;
  onSelect: (pieceId: string) => void;
  onDrop: (
    pieceId: string,
    pageX: number,
    pageY: number,
    grabOffsetCol: number,
    grabOffsetRow: number,
    dragOffsetX: number,
    dragOffsetY: number
  ) => void;
  onRotate: (pieceId: string) => void;
  onFlip: (pieceId: string) => void;
}) {
  const shapeWidth = Math.max(...piece.shape.map((cell) => cell.x)) + 1;
  const shapeHeight = Math.max(...piece.shape.map((cell) => cell.y)) + 1;
  const floatingWidth = shapeWidth * cellSize;
  const floatingHeight = shapeHeight * cellSize;
  const floatingPosition = stagingPosition ?? boardPosition;
  const floating = Boolean(floatingPosition);
  const pan = useRef(new Animated.ValueXY()).current;
  const [dragging, setDragging] = useState(false);
  const [measuredSlotSize, setMeasuredSlotSize] = useState({ width: 96, height: slotHeight });
  const slotSize = useRef({ width: 96, height: slotHeight });
  const grabOffset = useRef({ col: 0.5, row: 0.5 });
  const movedRef = useRef(false);
  const maxMoveDistanceRef = useRef(0);
  const touchStartedAtRef = useRef(0);
  const touchStartPageRef = useRef({ x: 0, y: 0 });
  const latestTouchPageRef = useRef({ x: 0, y: 0 });
  const latestGestureOffsetRef = useRef({ x: 0, y: 0 });
  const furthestTouchPageRef = useRef({ x: 0, y: 0 });
  const furthestGestureOffsetRef = useRef({ x: 0, y: 0 });
  const longPressTriggeredRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pieceRef = useRef(piece);
  const cellSizeRef = useRef(cellSize);
  const disabledRef = useRef(disabled);
  const onSelectRef = useRef(onSelect);
  const onDropRef = useRef(onDrop);
  const onRotateRef = useRef(onRotate);
  const onFlipRef = useRef(onFlip);

  pieceRef.current = piece;
  cellSizeRef.current = cellSize;
  disabledRef.current = disabled;
  onSelectRef.current = onSelect;
  onDropRef.current = onDrop;
  onRotateRef.current = onRotate;
  onFlipRef.current = onFlip;

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => () => clearLongPressTimer(), []);

  const resetPosition = () => {
    setDragging(false);
    Animated.spring(pan, {
      toValue: { x: 0, y: 0 },
      speed: 24,
      bounciness: 5,
      useNativeDriver: false,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        clearLongPressTimer();
        movedRef.current = false;
        maxMoveDistanceRef.current = 0;
        touchStartedAtRef.current = Date.now();
        touchStartPageRef.current = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
        };
        latestTouchPageRef.current = touchStartPageRef.current;
        latestGestureOffsetRef.current = { x: 0, y: 0 };
        furthestTouchPageRef.current = touchStartPageRef.current;
        furthestGestureOffsetRef.current = { x: 0, y: 0 };
        longPressTriggeredRef.current = false;
        const currentPiece = pieceRef.current;
        const metrics = getPiecePreviewMetrics(
          currentPiece,
          cellSizeRef.current,
          slotSize.current.width - 6,
          slotSize.current.height - 4,
          floating || preserveCellSize
        );
        const previewLeft = (slotSize.current.width - metrics.width) / 2;
        const previewTop = (slotSize.current.height - metrics.height) / 2;
        const localX = Math.max(0, Math.min(metrics.width - 1, event.nativeEvent.locationX - previewLeft));
        const localY = Math.max(0, Math.min(metrics.height - 1, event.nativeEvent.locationY - previewTop));
        // Keep the exact point inside the piece. Assuming the center of the
        // touched cell can shift the calculated drop origin by half a cell.
        grabOffset.current = {
          col: localX / metrics.fittedCellSize,
          row: localY / metrics.fittedCellSize,
        };
        pan.stopAnimation();
        pan.setValue({ x: 0, y: 0 });
        onSelectRef.current(currentPiece.id);
        longPressTimerRef.current = setTimeout(() => {
          if (movedRef.current || longPressTriggeredRef.current || disabledRef.current) return;
          longPressTriggeredRef.current = true;
          onFlipRef.current(pieceRef.current.id);
        }, TOUCH_LONG_PRESS_MS);
      },
      onPanResponderMove: (event, gesture) => {
        const currentTouchPage = {
          x: Number.isFinite(event.nativeEvent.pageX) ? event.nativeEvent.pageX : gesture.moveX,
          y: Number.isFinite(event.nativeEvent.pageY) ? event.nativeEvent.pageY : gesture.moveY,
        };
        latestGestureOffsetRef.current = { x: gesture.dx, y: gesture.dy };
        latestTouchPageRef.current = currentTouchPage;
        const distance = Math.hypot(gesture.dx, gesture.dy);
        if (distance >= maxMoveDistanceRef.current) {
          maxMoveDistanceRef.current = distance;
          furthestGestureOffsetRef.current = { x: gesture.dx, y: gesture.dy };
          furthestTouchPageRef.current = currentTouchPage;
        }
        if (!movedRef.current && distance >= TOUCH_DRAG_THRESHOLD_PX) {
          movedRef.current = true;
          clearLongPressTimer();
          setDragging(true);
        }
        if (movedRef.current) pan.setValue({ x: gesture.dx, y: gesture.dy });
      },
      onPanResponderRelease: () => {
        clearLongPressTimer();
        const gestureDuration = Date.now() - touchStartedAtRef.current;
        const isTap =
          !longPressTriggeredRef.current &&
          gestureDuration <= TOUCH_TAP_MAX_DURATION_MS &&
          maxMoveDistanceRef.current <= TOUCH_TAP_MAX_DISTANCE_PX;

        if (isTap) {
          onRotateRef.current(pieceRef.current.id);
        } else if (movedRef.current) {
          // Android can report stale coordinates on the release event. Use the
          // last move event, which is also what rendered the visible position.
          const latestOffset = latestGestureOffsetRef.current;
          const furthestOffset = furthestGestureOffsetRef.current;
          const latestDistance = Math.hypot(latestOffset.x, latestOffset.y);
          const furthestDistance = Math.hypot(furthestOffset.x, furthestOffset.y);
          // Some Android devices emit one final move sample close to (0, 0)
          // after a real drag. That sample previously erased the actual drag
          // and made the piece snap back to its old cell.
          const gestureRecovered =
            latestDistance < TOUCH_DRAG_THRESHOLD_PX &&
            furthestDistance >= TOUCH_DRAG_THRESHOLD_PX;
          const releaseOffset = gestureRecovered ? furthestOffset : latestOffset;
          const releasePage = gestureRecovered ? furthestTouchPageRef.current : latestTouchPageRef.current;
          onDropRef.current(
            pieceRef.current.id,
            releasePage.x,
            releasePage.y,
            grabOffset.current.col,
            grabOffset.current.row,
            releaseOffset.x,
            releaseOffset.y
          );
        } else if (!longPressTriggeredRef.current) {
          onRotateRef.current(pieceRef.current.id);
        }
        resetPosition();
      },
      onPanResponderTerminate: () => {
        clearLongPressTimer();
        resetPosition();
      },
    })
  ).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      pointerEvents="box-only"
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${piece.id} puzzle piece`}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        slotSize.current = { width, height };
        setMeasuredSlotSize((current) =>
          current.width === width && current.height === height ? current : { width, height }
        );
      }}
      style={[
        floating ? styles.stagedPiece : styles.pieceSlot,
        !floating && { height: slotHeight, ...(slotWidth ? { width: slotWidth } : {}) },
        floating && {
          left: floatingPosition?.x ?? 0,
          top: floatingPosition?.y ?? 0,
          width: floatingWidth,
          height: floatingHeight,
        },
        selected && styles.pieceSlotSelected,
        disabled && styles.pieceSlotPlaced,
        dragging && styles.pieceSlotDragging,
        { transform: pan.getTranslateTransform() },
      ]}
    >
      <PiecePreview
        piece={piece}
        cellSize={cellSize}
        availableWidth={floating ? floatingWidth : measuredSlotSize.width - 6}
        availableHeight={floating ? floatingHeight : measuredSlotSize.height - 4}
        preserveCellSize={floating || preserveCellSize}
        selected={selected}
        dragging={dragging}
      />
    </Animated.View>
  );
}

function cloneShape(shape: Point[]) {
  return shape.map((cell) => ({ ...cell }));
}

function orientShapeForStash(shape: Point[]) {
  let current = cloneShape(shape);
  let best = current;
  let bestWidth = Math.max(...best.map((cell) => cell.x)) + 1;
  let bestHeight = Math.max(...best.map((cell) => cell.y)) + 1;

  for (let turn = 0; turn < 4; turn += 1) {
    const width = Math.max(...current.map((cell) => cell.x)) + 1;
    const height = Math.max(...current.map((cell) => cell.y)) + 1;
    if (height < bestHeight || (height === bestHeight && width > bestWidth)) {
      best = current;
      bestWidth = width;
      bestHeight = height;
    }
    current = rotateShape(current);
  }

  return cloneShape(best);
}

function canPlacePiece(
  boardWidth: number,
  boardHeight: number,
  piece: PieceState,
  x: number,
  y: number,
  allPieces: PieceState[]
) {
  for (const cell of piece.shape) {
    const col = x + cell.x;
    const row = y + cell.y;
    if (col < 0 || row < 0 || col >= boardWidth || row >= boardHeight) return false;
    for (const other of allPieces) {
      if (other.id === piece.id || !other.placement) continue;
      for (const otherCell of other.shape) {
        const otherCol = other.placement.x + otherCell.x;
        const otherRow = other.placement.y + otherCell.y;
        if (otherCol === col && otherRow === row) return false;
      }
    }
  }
  return true;
}

function AppContent() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const boardCardRef = useRef<View>(null);
  const boardFrameRef = useRef<View>(null);
  const stashPanelRef = useRef<View>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [level, setLevel] = useState(1);
  const [puzzle, setPuzzle] = useState<PuzzleConfig | null>(null);
  const [pieces, setPieces] = useState<PieceState[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "paused" | "won" | "lost" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const [bestTimes, setBestTimes] = useState<Record<number, number>>({});
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const [cloudProgress, setCloudProgress] = useState<CloudProgress | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showHowTo, setShowHowTo] = useState(false);

  const dark = themeMode === "dark";
  const colors = dark
    ? {
        bg: "#071024",
        card: "#121f36",
        text: "#f4f7ff",
        muted: "#95a6c8",
        accent: "#16d8a0",
        border: "#2a3b59",
      }
    : {
        bg: "#f2f5fb",
        card: "#ffffff",
        text: "#0c1528",
        muted: "#5f6f8f",
        accent: "#0aa879",
        border: "#d9e1f0",
      };
  const gameColors = dark ? GAME_COLORS : LIGHT_GAME_COLORS;

  const completedCount = useMemo(() => Object.keys(bestTimes).length, [bestTimes]);
  const completedLevels = useMemo(
    () => Object.keys(bestTimes).map(Number).filter(Number.isFinite),
    [bestTimes]
  );
  const unlockedLevel = Math.min(
    TOTAL_LEVELS,
    Math.max(1, level, (completedLevels.length ? Math.max(...completedLevels) : 0) + 1)
  );
  const playerStats = cloudProgress?.playerStats ?? {
    gamesStarted: completedCount,
    wins: completedCount,
    losses: 0,
    restarts: 0,
    hintsUsed: 0,
    totalPlaySeconds: 0,
  };
  const bestCompletion = completedLevels.length
    ? Math.min(...completedLevels.map((completedLevel) => bestTimes[completedLevel]))
    : null;
  const placedCount = useMemo(() => pieces.filter((piece) => piece.placement).length, [pieces]);
  const gameContentWidth = Math.min(viewportWidth - 24, 760);
  const compactGame = viewportHeight < 780;
  const roomyGame = viewportHeight >= 860;
  const boardHeightBudget = compactGame
    ? Math.min(154, Math.floor(viewportHeight * 0.21))
    : Math.min(roomyGame ? 220 : 196, Math.floor(viewportHeight * 0.24));
  const maxBoardCellSize = viewportWidth >= 400 ? (roomyGame ? 36 : 34) : 32;
  const boardCellSize = puzzle
    ? Math.max(
        9,
        Math.min(
          maxBoardCellSize,
          Math.floor((gameContentWidth - 28) / puzzle.width),
          Math.floor(boardHeightBudget / puzzle.height)
        )
      )
    : 20;
  const sparseStash = pieces.length <= 4;
  const baseStashSlotHeight = compactGame
    ? (sparseStash ? 68 : 62)
    : (sparseStash ? (roomyGame ? 82 : 76) : (roomyGame ? 72 : 68));
  const previewCellLimit = compactGame
    ? (sparseStash ? 27 : 24)
    : (sparseStash ? (roomyGame ? 32 : 30) : 28);
  const stashMaxSpan = Math.max(
    1,
    ...pieces.map((piece) => {
      const width = Math.max(...piece.shape.map((cell) => cell.x)) + 1;
      const height = Math.max(...piece.shape.map((cell) => cell.y)) + 1;
      return Math.max(width, height);
    })
  );
  const stashColumnCount = pieces.length >= 7 ? 4 : pieces.length >= 5 ? 3 : 2;
  const stashSlotWidthBudget = Math.max(68, Math.floor((gameContentWidth - 52) / stashColumnCount));
  const stashSlotWidth = stashSlotWidthBudget - 4;
  const previewCellSize = Math.max(
    14,
    Math.min(boardCellSize, previewCellLimit, Math.floor((stashSlotWidthBudget - 6) / stashMaxSpan))
  );
  const stashSlotHeight = Math.max(baseStashSlotHeight, previewCellSize * stashMaxSpan + 6);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const user = await fetchCurrentUser();
        if (!active || !user) return;
        const progress = await fetchProgress();
        if (!active) return;
        setCloudUser(user);
        setCloudProgress(progress);
        setBestTimes(progress.bestTimes ?? {});
        setLevel(progress.lastLevel ?? 1);
      } catch (error) {
        if (active) setAuthError(error instanceof Error ? error.message : "Could not restore your session.");
      } finally {
        if (active) setSessionLoading(false);
      }
    }
    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (status !== "playing") return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setStatus("lost");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  function startLevel(nextLevel: number) {
    const config = getLevelConfig(nextLevel);
    if (!config) {
      setStatus("error");
      setErrorText(`Level ${nextLevel} could not be generated. Please retry.`);
      return;
    }

    const nextPieces: PieceState[] = config.pieces.map((piece, index) => {
      const initialShape = orientShapeForStash(piece.shape);
      return {
        id: `${piece.id}-${index}`,
        color: piece.color,
        shape: initialShape,
        originalShape: cloneShape(initialShape),
        placement: null,
        stagingPosition: null,
      };
    });

    setPuzzle(config);
    setPieces(nextPieces);
    setSelectedPieceId(nextPieces[0]?.id ?? null);
    setTimeLeft(config.timeLimit);
    setStatus("playing");
    setErrorText("");
    setScreen("game");
  }

  function placePiece(pieceId: string, row: number, col: number) {
    if (!puzzle || status !== "playing") return false;

    const selected = pieces.find((piece) => piece.id === pieceId);
    if (!selected) return;

    if (!canPlacePiece(puzzle.width, puzzle.height, selected, col, row, pieces)) return false;

    const updated = pieces.map((piece) =>
      piece.id === pieceId
        ? { ...piece, placement: { x: col, y: row }, stagingPosition: null }
        : piece
    );
    setPieces(updated);

    const remaining = updated.filter((piece) => !piece.placement);
    if (remaining.length === 0) {
      const elapsed = (puzzle.timeLimit - timeLeft) || 0;
      const nextBestTimes = { ...bestTimes };
      const currentBest = nextBestTimes[level];
      if (currentBest == null || elapsed < currentBest) nextBestTimes[level] = elapsed;
      setBestTimes(nextBestTimes);
      if (cloudUser && cloudProgress) {
        const nextProgress: CloudProgress = {
          ...cloudProgress,
          completedLevels: [...new Set([...cloudProgress.completedLevels, level])].sort((a, b) => a - b),
          bestTimes: nextBestTimes,
          lastLevel: Math.min(level + 1, TOTAL_LEVELS),
          playerStats: {
            ...cloudProgress.playerStats,
            wins: cloudProgress.playerStats.wins + 1,
            totalPlaySeconds: cloudProgress.playerStats.totalPlaySeconds + elapsed,
          },
        };
        setCloudProgress(nextProgress);
        void saveProgress(nextProgress).then(setCloudProgress).catch(() => undefined);
      }
      setStatus("won");
      return true;
    }

    setSelectedPieceId(remaining[0]?.id ?? null);
    return true;
  }

  function handlePlace(row: number, col: number) {
    if (!selectedPieceId) return;
    placePiece(selectedPieceId, row, col);
  }

  function handlePieceDrop(
    pieceId: string,
    pageX: number,
    pageY: number,
    grabOffsetCol: number,
    grabOffsetRow: number,
    dragOffsetX: number,
    dragOffsetY: number
  ) {
    if (!puzzle || status !== "playing") return;
    boardCardRef.current?.measureInWindow((cardX, cardY, cardWidth, cardHeight) => {
      boardFrameRef.current?.measureInWindow((boardX, boardY, boardWidth, boardHeight) => {
        const piece = pieces.find((candidate) => candidate.id === pieceId);
        if (!piece) return;

        // On Android, PanResponder pageY includes the top system inset while
        // measureInWindow() is relative to the app window below that inset.
        // Normalize touch coordinates before comparing them with measured views.
        const coordinateInsetY = Platform.OS === "android" ? safeAreaInsets.top : 0;
        const windowPageX = pageX;
        const windowPageY = pageY - coordinateInsetY;
        const frameBorder = 2;
        const gridX = boardX + frameBorder;
        const gridY = boardY + frameBorder;
        const measuredCellWidth = (boardWidth - frameBorder * 2) / puzzle.width;
        const measuredCellHeight = (boardHeight - frameBorder * 2) / puzzle.height;
        const shapeWidth = Math.max(...piece.shape.map((cell) => cell.x)) + 1;
        const shapeHeight = Math.max(...piece.shape.map((cell) => cell.y)) + 1;
        const pointerPieceLeft = windowPageX - grabOffsetCol * measuredCellWidth;
        const pointerPieceTop = windowPageY - grabOffsetRow * measuredCellHeight;
        const pieceLeft = piece.placement
          ? gridX + piece.placement.x * measuredCellWidth + dragOffsetX
          : pointerPieceLeft;
        const pieceTop = piece.placement
          ? gridY + piece.placement.y * measuredCellHeight + dragOffsetY
          : pointerPieceTop;
        const pieceRight = pieceLeft + shapeWidth * measuredCellWidth;
        const pieceBottom = pieceTop + shapeHeight * measuredCellHeight;
        const fingerNearBoard =
          windowPageX >= gridX - measuredCellWidth * 1.5 &&
          windowPageX <= gridX + measuredCellWidth * puzzle.width + measuredCellWidth * 1.5 &&
          windowPageY >= gridY - measuredCellHeight * 1.5 &&
          windowPageY <= gridY + measuredCellHeight * puzzle.height + measuredCellHeight * 1.5;
        const overlapsBoard =
          pieceRight > gridX - measuredCellWidth * 0.5 &&
          pieceLeft < gridX + measuredCellWidth * puzzle.width + measuredCellWidth * 0.5 &&
          pieceBottom > gridY - measuredCellHeight * 0.5 &&
          pieceTop < gridY + measuredCellHeight * puzzle.height + measuredCellHeight * 0.5;
        if (overlapsBoard || fingerNearBoard) {
          // A placed piece already has an exact grid origin. Derive its visual
          // drop origin directly from the rendered drag delta so Android touch
          // coordinate differences cannot shift it into the wrong row/column.
          const originCol = piece.placement
            ? piece.placement.x + dragOffsetX / measuredCellWidth
            : (pieceLeft - gridX) / measuredCellWidth;
          const originRow = piece.placement
            ? piece.placement.y + dragOffsetY / measuredCellHeight
            : (pieceTop - gridY) / measuredCellHeight;
          const dragCol = piece.placement ? originCol - piece.placement.x : 0;
          const dragRow = piece.placement ? originRow - piece.placement.y : 0;
          const dragMagnitude = Math.hypot(dragCol, dragRow);
          const directionCol = dragMagnitude > 0 ? dragCol / dragMagnitude : 0;
          const directionRow = dragMagnitude > 0 ? dragRow / dragMagnitude : 0;
          const directionalSnapTolerance = piece.placement ? 0.2 : 0;
          const biasedOriginCol = originCol + directionCol * directionalSnapTolerance;
          const biasedOriginRow = originRow + directionRow * directionalSnapTolerance;
          const snapCandidates: Array<{ row: number; col: number; distance: number }> = [];

          for (let row = 0; row <= puzzle.height - shapeHeight; row += 1) {
            for (let col = 0; col <= puzzle.width - shapeWidth; col += 1) {
              if (!canPlacePiece(puzzle.width, puzzle.height, piece, col, row, pieces)) continue;
              const moveCol = piece.placement ? col - piece.placement.x : 0;
              const moveRow = piece.placement ? row - piece.placement.y : 0;
              const directionalProgress = moveCol * directionCol + moveRow * directionRow;
              // Shift the half-cell boundary 20% toward the drag direction so
              // grid-to-grid movement feels magnetic without causing jumps.
              const directionTieBreaker = piece.placement
                ? -directionalProgress * 0.001
                : 0;
              snapCandidates.push({
                row,
                col,
                distance: Math.hypot(col - biasedOriginCol, row - biasedOriginRow) + directionTieBreaker,
              });
            }
          }

          snapCandidates.sort((a, b) => a.distance - b.distance);
          const nearestCandidate = snapCandidates[0];
          const fingerInsideBoard =
            windowPageX >= gridX &&
            windowPageX <= gridX + measuredCellWidth * puzzle.width &&
            windowPageY >= gridY &&
            windowPageY <= gridY + measuredCellHeight * puzzle.height;
          const snapDistance =
            fingerInsideBoard || overlapsBoard
              ? Number.POSITIVE_INFINITY
              : 2.25;

          if (nearestCandidate && nearestCandidate.distance <= snapDistance) {
            placePiece(pieceId, nearestCandidate.row, nearestCandidate.col);
            return;
          }
        }

        const cardDropMargin = 24;
        const insideStagingArea =
          windowPageX >= cardX - cardDropMargin &&
          windowPageX <= cardX + cardWidth + cardDropMargin &&
          windowPageY >= cardY - cardDropMargin &&
          windowPageY <= cardY + cardHeight + cardDropMargin;

        if (insideStagingArea) {
          const pieceWidth = (Math.max(...piece.shape.map((cell) => cell.x)) + 1) * boardCellSize;
          const pieceHeight = (Math.max(...piece.shape.map((cell) => cell.y)) + 1) * boardCellSize;
          const nextX = Math.max(
            4,
            Math.min(cardWidth - pieceWidth - 4, windowPageX - cardX - grabOffsetCol * boardCellSize)
          );
          const nextY = Math.max(
            4,
            Math.min(cardHeight - pieceHeight - 4, windowPageY - cardY - grabOffsetRow * boardCellSize)
          );
          setPieces((current) =>
            current.map((candidate) =>
              candidate.id === pieceId
                ? { ...candidate, placement: null, stagingPosition: { x: nextX, y: nextY } }
                : candidate
            )
          );
          setSelectedPieceId(pieceId);
          return;
        }

        stashPanelRef.current?.measureInWindow((stashX, stashY, stashWidth, stashHeight) => {
          const insideStash =
            windowPageX >= stashX &&
            windowPageX <= stashX + stashWidth &&
            windowPageY >= stashY &&
            windowPageY <= stashY + stashHeight;
          if (!insideStash) return;
          setPieces((current) =>
            current.map((candidate) =>
              candidate.id === pieceId
                ? { ...candidate, placement: null, stagingPosition: null }
                : candidate
            )
          );
        });
      });
    });
  }

  function rotatePiece(pieceId: string) {
    if (status !== "playing") return;
    setPieces((prev) => {
      const piece = prev.find((candidate) => candidate.id === pieceId);
      if (!piece) return prev;
      const transformed = { ...piece, shape: rotateShape(piece.shape) };
      return prev.map((candidate) => (candidate.id === pieceId ? transformed : candidate));
    });
    setSelectedPieceId(pieceId);
  }

  function flipPiece(pieceId: string) {
    if (status !== "playing") return;
    setPieces((prev) => {
      const piece = prev.find((candidate) => candidate.id === pieceId);
      if (!piece) return prev;
      const transformed = { ...piece, shape: flipShape(piece.shape) };
      return prev.map((candidate) => (candidate.id === pieceId ? transformed : candidate));
    });
    setSelectedPieceId(pieceId);
  }

  function rotateSelected() {
    if (!selectedPieceId) return;
    rotatePiece(selectedPieceId);
  }

  function flipSelected() {
    if (!selectedPieceId) return;
    flipPiece(selectedPieceId);
  }

  function returnSelectedToStash() {
    if (!selectedPieceId) return;
    setPieces((prev) =>
      prev.map((piece) =>
        piece.id === selectedPieceId
          ? { ...piece, placement: null, stagingPosition: null }
          : piece
      )
    );
  }

  function resetLevelPieces() {
    setPieces((prev) =>
      prev.map((piece) => ({
        ...piece,
        placement: null,
        stagingPosition: null,
        shape: cloneShape(piece.originalShape),
      }))
    );
  }

  function clearBoardPieces() {
    setPieces((prev) =>
      prev.map((piece) => ({
        ...piece,
        placement: null,
        stagingPosition: null,
      }))
    );
  }

  function togglePause() {
    setStatus((current) => current === "playing" ? "paused" : current === "paused" ? "playing" : current);
  }

  function goToNextLevel() {
    const nextLevel = Math.min(level + 1, TOTAL_LEVELS);
    setLevel(nextLevel);
    startLevel(nextLevel);
  }

  async function applyAuthenticatedUser(user: CloudUser) {
    const progress = await fetchProgress();
    setCloudUser(user);
    setCloudProgress(progress);
    setBestTimes(progress.bestTimes ?? {});
    setLevel(progress.lastLevel ?? 1);
    setPassword("");
    setAuthError("");
    setScreen("home");
  }

  async function submitNicknameAuth() {
    setAuthBusy(true);
    setAuthError("");
    try {
      const user = authMode === "register"
        ? await registerNickname(nickname.trim(), password)
        : await loginNickname(nickname.trim(), password);
      await applyAuthenticatedUser(user);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitGoogleAuth(idToken: string) {
    setAuthBusy(true);
    setAuthError("");
    try {
      const user = await loginGoogle(idToken);
      await applyAuthenticatedUser(user);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Google authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitGuest() {
    setAuthBusy(true);
    setAuthError("");
    try {
      const guestName = nickname.trim() || `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
      const user = await continueAsGuest(guestName);
      await applyAuthenticatedUser(user);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Guest profile could not be created.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    setCloudUser(null);
    setCloudProgress(null);
    setBestTimes({});
    setLevel(1);
    setScreen("home");
  }

  if (screen === "profile") {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <StatusBar style={dark ? "light" : "dark"} />
        <ScrollView contentContainerStyle={styles.profileContainer} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => setScreen("home")}>
            <Text style={[styles.backLink, { color: colors.accent }]}>Back to game</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Player Profile</Text>

          {cloudUser ? (
            <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.profileName, { color: colors.text }]}>{cloudUser.displayName}</Text>
              <Text style={[styles.subtitle, { color: colors.muted }]}>
                {cloudUser.provider === "guest" ? "Guest profile on this device" : "Synced PentaBlocks account"}
              </Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>Arena rating: {cloudUser.arenaRating}</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{completedCount} levels completed</Text>
              <Pressable style={[styles.dangerButton, { borderColor: colors.border }]} onPress={() => void handleSignOut()}>
                <Text style={styles.dangerText}>Sign Out</Text>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.authCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.authIntro}>
                <Text style={[styles.authEyebrow, { color: colors.accent }]}>PENTABLOCKS ACCOUNT</Text>
                <Text style={[styles.authHeading, { color: colors.text }]}>Keep your progress</Text>
                <Text style={[styles.authDescription, { color: colors.muted }]}>
                  Sign in to sync levels, stats, and Arena progress across web and Android.
                </Text>
              </View>
              <GoogleSignInSection
                busy={authBusy}
                onIdToken={(idToken) => void submitGoogleAuth(idToken)}
                onError={setAuthError}
              />
              <View style={styles.authDividerRow}>
                <View style={[styles.authDividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.authDividerText, { color: colors.muted }]}>OR</Text>
                <View style={[styles.authDividerLine, { backgroundColor: colors.border }]} />
              </View>
              <View style={styles.authTabs}>
                {(["login", "register"] as AuthMode[]).map((mode) => (
                  <Pressable
                    key={mode}
                    style={[styles.authTab, authMode === mode && { backgroundColor: colors.accent }]}
                    onPress={() => {
                      setAuthMode(mode);
                      setAuthError("");
                    }}
                  >
                    <Text style={[styles.authTabText, { color: authMode === mode ? "#ffffff" : colors.text }]}>
                      {mode === "login" ? "Sign In" : "Create Profile"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={nickname}
                onChangeText={setNickname}
                placeholder="Nickname"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password (min 8 characters)"
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
              />
              {authError ? <Text style={styles.authError}>{authError}</Text> : null}
              <Pressable
                disabled={authBusy || nickname.trim().length < 3 || password.length < 8}
                style={[
                  styles.ctaButton,
                  {
                    backgroundColor: colors.accent,
                    opacity: authBusy || nickname.trim().length < 3 || password.length < 8 ? 0.56 : 1,
                  },
                ]}
                onPress={() => void submitNicknameAuth()}
              >
                {authBusy ? <ActivityIndicator color="#ffffff" /> : (
                  <Text style={styles.ctaText}>{authMode === "login" ? "Sign In" : "Create Profile"}</Text>
                )}
              </Pressable>
              <View style={styles.authDividerRow}>
                <View style={[styles.authDividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.authDividerText, { color: colors.muted }]}>PLAY WITHOUT AN ACCOUNT</Text>
                <View style={[styles.authDividerLine, { backgroundColor: colors.border }]} />
              </View>
              <Pressable
                disabled={authBusy}
                style={[styles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.bg }]}
                onPress={() => void submitGuest()}
              >
                <Text style={[styles.secondaryText, { color: colors.text }]}>Continue as Guest</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "levels") {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <StatusBar style={dark ? "light" : "dark"} />
        <ScrollView contentContainerStyle={styles.sectionScreenContainer}>
          <View style={styles.sectionScreenHeader}>
            <Pressable style={[styles.sectionBackButton, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setScreen("home")}>
              <MaterialCommunityIcons name="chevron-left" size={28} color={colors.text} />
            </Pressable>
            <View style={styles.sectionHeaderCopy}>
              <Text style={[styles.sectionScreenTitle, { color: colors.text }]}>Single Player</Text>
              <Text style={[styles.sectionScreenSubtitle, { color: colors.muted }]}>{completedCount}/{TOTAL_LEVELS} levels completed</Text>
            </View>
          </View>
          <View style={styles.levelGrid}>
            {Array.from({ length: TOTAL_LEVELS }, (_, index) => index + 1).map((levelNumber) => {
              const completed = bestTimes[levelNumber] != null;
              const unlocked = levelNumber <= unlockedLevel;
              return (
                <Pressable
                  key={levelNumber}
                  disabled={!unlocked}
                  onPress={() => startLevel(levelNumber)}
                  style={({ pressed }) => [
                    styles.levelTile,
                    { backgroundColor: colors.card, borderColor: completed ? colors.accent : colors.border },
                    !unlocked && styles.levelTileLocked,
                    pressed && unlocked && { transform: [{ scale: 0.96 }] },
                  ]}
                >
                  <Text style={[styles.levelTileNumber, { color: unlocked ? colors.text : colors.muted }]}>{levelNumber}</Text>
                  {completed ? (
                    <Text style={[styles.levelTileMeta, { color: colors.accent }]}>{formatTime(bestTimes[levelNumber])}</Text>
                  ) : (
                    <MaterialCommunityIcons name={unlocked ? "play" : "lock-outline"} size={14} color={colors.muted} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "stats") {
    const winRate = playerStats.gamesStarted > 0
      ? Math.round((playerStats.wins / playerStats.gamesStarted) * 100)
      : 0;
    const statItems = [
      { label: "Levels", value: `${completedCount}/${TOTAL_LEVELS}`, icon: "map-check-outline" as const, color: colors.accent },
      { label: "Games", value: String(playerStats.gamesStarted), icon: "gamepad-variant-outline" as const, color: "#7189ff" },
      { label: "Win Rate", value: `${winRate}%`, icon: "trophy-outline" as const, color: "#ffb72b" },
      { label: "Best Time", value: bestCompletion == null ? "--" : formatTime(bestCompletion), icon: "timer-star-outline" as const, color: "#ff526d" },
      { label: "Play Time", value: formatTime(playerStats.totalPlaySeconds), icon: "clock-outline" as const, color: "#19bfff" },
      { label: "Restarts", value: String(playerStats.restarts), icon: "restart" as const, color: colors.muted },
    ];
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <StatusBar style={dark ? "light" : "dark"} />
        <ScrollView contentContainerStyle={styles.sectionScreenContainer}>
          <View style={styles.sectionScreenHeader}>
            <Pressable style={[styles.sectionBackButton, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setScreen("home")}>
              <MaterialCommunityIcons name="chevron-left" size={28} color={colors.text} />
            </Pressable>
            <View style={styles.sectionHeaderCopy}>
              <Text style={[styles.sectionScreenTitle, { color: colors.text }]}>Player Stats</Text>
              <Text style={[styles.sectionScreenSubtitle, { color: colors.muted }]}>Your single-player progress</Text>
            </View>
          </View>
          <View style={styles.statsGrid}>
            {statItems.map((item) => (
              <View key={item.label} style={[styles.statSummaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <MaterialCommunityIcons name={item.icon} size={25} color={item.color} />
                <Text style={[styles.statSummaryValue, { color: colors.text }]}>{item.value}</Text>
                <Text style={[styles.statSummaryLabel, { color: colors.muted }]}>{item.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "arena" || screen === "multiplayer") {
    const isArena = screen === "arena";
    const arenaNeedsAccount = isArena && (!cloudUser || cloudUser.provider === "guest");
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <StatusBar style={dark ? "light" : "dark"} />
        <ScrollView contentContainerStyle={styles.featureScreenContainer}>
          <View style={styles.sectionScreenHeader}>
            <Pressable style={[styles.sectionBackButton, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setScreen("home")}>
              <MaterialCommunityIcons name="chevron-left" size={28} color={colors.text} />
            </Pressable>
            <View style={styles.sectionHeaderCopy}>
              <Text style={[styles.sectionScreenTitle, { color: colors.text }]}>{isArena ? "Arena" : "Multiplayer"}</Text>
              <Text style={[styles.sectionScreenSubtitle, { color: colors.muted }]}>{isArena ? "Ranked head-to-head matches" : "Private cross-platform rooms"}</Text>
            </View>
          </View>
          <View style={[styles.featureHeroCard, { backgroundColor: colors.card, borderColor: isArena ? "#ff6238" : colors.border }]}>
            <View style={[styles.featureIconCircle, { backgroundColor: isArena ? "rgba(255, 82, 61, 0.14)" : "rgba(22, 216, 160, 0.14)" }]}>
              <MaterialCommunityIcons name={isArena ? "sword-cross" : "account-group-outline"} size={42} color={isArena ? "#ff6238" : colors.accent} />
            </View>
            <View style={styles.crossPlatformBadge}>
              <Text style={styles.crossPlatformBadgeText}>CROSS-PLATFORM</Text>
            </View>
            <Text style={[styles.featureTitle, { color: colors.text }]}>{isArena ? "Compete for rating" : "Play together on any device"}</Text>
            <Text style={[styles.featureDescription, { color: colors.muted }]}>
              {isArena
                ? "The mobile Arena will use the same account, rating and opponents as pentablocks.live."
                : "Mobile and web players will share room codes, synchronized puzzles and tournament scores."}
            </Text>
            {isArena && cloudUser ? (
              <View style={styles.arenaRatingRow}>
                <Text style={[styles.arenaRatingLabel, { color: colors.muted }]}>CURRENT RATING</Text>
                <Text style={[styles.arenaRatingValue, { color: colors.text }]}>{cloudUser.arenaRating}</Text>
              </View>
            ) : null}
          </View>
          <Pressable
            style={[styles.featureActionButton, { backgroundColor: arenaNeedsAccount ? colors.accent : colors.card, borderColor: colors.border }]}
            onPress={() => arenaNeedsAccount ? setScreen("profile") : setScreen("home")}
          >
            <Text style={[styles.featureActionText, { color: arenaNeedsAccount ? "#ffffff" : colors.muted }]}>
              {arenaNeedsAccount ? "Sign In to Play Arena" : "Native matchmaking is next"}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "home") {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <StatusBar style={dark ? "light" : "dark"} />
        <View pointerEvents="none" style={styles.ambientGlowTop} />
        <View pointerEvents="none" style={styles.ambientGlowBottom} />
        <ScrollView contentContainerStyle={styles.homeContainer} showsVerticalScrollIndicator={false}>
          <View style={styles.homeAccountRow}>
            <Pressable
              style={[styles.homeAccountPill, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setScreen("profile")}
            >
              {sessionLoading ? <ActivityIndicator size="small" color={colors.accent} /> : (
                <>
                  <MaterialCommunityIcons name={cloudUser ? "account-circle-outline" : "login"} size={19} color={colors.accent} />
                  <Text style={[styles.homeAccountName, { color: colors.text }]} numberOfLines={1}>
                    {cloudUser ? cloudUser.displayName : "Sign in or create account"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={styles.homeHero}>
            <PentaBlocksWordmark hero dark={dark} />
            <Text style={[styles.homeTagline, { color: colors.muted }]}>TETROMINO PUZZLE CHALLENGE</Text>
          </View>

          <View style={styles.homeMenu}>
            <HomeMenuButton label={`Continue LV ${level}`} icon="chevron-right" backgroundColor={colors.accent} onPress={() => startLevel(level)} />
            <HomeMenuButton
              label="Single Player"
              icon="account-outline"
              backgroundColor={colors.card}
              borderColor={colors.border}
              textColor={colors.text}
              onPress={() => completedCount === 0 ? startLevel(1) : setScreen("levels")}
            />
            <HomeMenuButton label="Stats" icon="chart-bar" backgroundColor={colors.accent} onPress={() => setScreen("stats")} />
            <HomeMenuButton label="Arena" icon="sword-cross" backgroundColor="#ff4938" badge="RANKED" onPress={() => setScreen("arena")} />
            <HomeMenuButton
              label="Multiplayer"
              icon="account-group-outline"
              backgroundColor={dark ? "#171a20" : colors.card}
              borderColor={colors.border}
              textColor={colors.text}
              badge="BETA"
              onPress={() => setScreen("multiplayer")}
            />
          </View>

          <View style={styles.homeFooter}>
            <Text style={[styles.homeFooterBrand, { color: colors.muted }]}>A GAME BY TGS LABS</Text>
            <Pressable onPress={() => setThemeMode((prev) => (prev === "light" ? "dark" : "light"))}>
              <Text style={[styles.homeThemeLink, { color: colors.muted }]}>{themeMode === "light" ? "Light" : "Dark"} theme</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: gameColors.bg }]}>
      <StatusBar style={dark ? "light" : "dark"} backgroundColor={gameColors.bg} />
      <View pointerEvents="none" style={styles.ambientGlowTop} />
      <View pointerEvents="none" style={styles.ambientGlowBottom} />
      <View style={[styles.gameContainer, { width: gameContentWidth }]}>
        <View style={[styles.gameHeader, { backgroundColor: gameColors.panel, borderColor: gameColors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open main menu"
            style={[styles.squareIconButton, { backgroundColor: gameColors.panelSoft, borderColor: gameColors.border }]}
            onPress={() => setScreen("home")}
          >
            <MaterialCommunityIcons name="menu" size={25} color={gameColors.text} />
          </Pressable>
          <View style={styles.brandBlock}>
            <PentaBlocksWordmark dark={dark} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open profile and settings"
            style={[styles.squareIconButton, { backgroundColor: gameColors.panelSoft, borderColor: gameColors.border }]}
            onPress={() => setScreen("profile")}
          >
            <MaterialCommunityIcons name="cog" size={24} color={gameColors.text} />
          </Pressable>
        </View>

        <View style={[styles.gameStatsCard, { backgroundColor: gameColors.panel, borderColor: gameColors.border }]}>
          <View style={styles.gameStatItem}>
            <View style={[styles.statIconBox, styles.levelIconBox]}>
              <MaterialCommunityIcons name="crown" size={23} color="#d77bff" />
            </View>
            <View style={styles.levelStatContent}>
              <Text style={[styles.gameStatLabel, { color: gameColors.muted }]}>LEVEL</Text>
              <Text style={[styles.gameStatValue, { color: gameColors.text }]}>{level}</Text>
              <View style={[styles.levelProgressTrack, { backgroundColor: dark ? "#15243b" : "#dbe3ef" }]}>
                <View style={[styles.levelProgressFill, { width: `${Math.max(4, level)}%` }]} />
              </View>
            </View>
          </View>
          <View style={[styles.statDivider, { backgroundColor: gameColors.border }]} />
          <View style={styles.gameStatItem}>
            <View style={[styles.statIconBox, styles.targetIconBox]}>
              <MaterialCommunityIcons name="crosshairs-gps" size={23} color="#21b8ff" />
            </View>
            <View>
              <Text style={[styles.gameStatLabel, { color: gameColors.muted }]}>TARGET</Text>
              <Text style={[styles.gameStatValue, { color: gameColors.text }]}>{puzzle ? `${puzzle.width} x ${puzzle.height}` : "--"}</Text>
            </View>
          </View>
          <View style={[styles.statDivider, { backgroundColor: gameColors.border }]} />
          <View style={styles.gameStatItem}>
            <View style={[styles.statIconBox, styles.timeIconBox]}>
              <MaterialCommunityIcons name="timer-outline" size={24} color={timeLeft <= 10 ? "#ff526d" : "#28e696"} />
            </View>
            <View>
              <Text style={[styles.gameStatLabel, { color: gameColors.muted }]}>TIME</Text>
              <Text style={[styles.gameStatValue, { color: gameColors.text }]}>{formatTime(timeLeft)}</Text>
            </View>
          </View>
          <Pressable style={[styles.pauseButton, { backgroundColor: gameColors.panelSoft }]} onPress={togglePause}>
            <MaterialCommunityIcons name={status === "paused" ? "play" : "pause"} size={24} color={gameColors.text} />
          </Pressable>
        </View>

        {puzzle ? (
          <View ref={boardCardRef} collapsable={false} style={[styles.boardCard, { backgroundColor: gameColors.panel, borderColor: gameColors.border }]}>
            <View style={styles.boardCoordinates}>
              {Array.from({ length: puzzle.width }).map((_, index) => (
                <Text key={`coordinate-${index}`} style={[styles.coordinateText, { width: boardCellSize, color: gameColors.muted }]}>{index + 1}</Text>
              ))}
            </View>
            <View ref={boardFrameRef} collapsable={false} style={[styles.boardFrame, { backgroundColor: gameColors.panelSoft, borderColor: dark ? "#435069" : gameColors.frame }]}>
              {Array.from({ length: puzzle.height }).map((_, row) => (
                <View key={`row-${row}`} style={styles.boardRow}>
                  {Array.from({ length: puzzle.width }).map((__, col) => (
                    <Pressable
                      key={`cell-${row}-${col}`}
                      onPress={() => handlePlace(row, col)}
                      style={[
                        styles.cell,
                        {
                          width: boardCellSize,
                          height: boardCellSize,
                          backgroundColor: dark ? "#101a2a" : gameColors.cell,
                          borderColor: gameColors.grid,
                          shadowColor: "transparent",
                        },
                      ]}
                    />
                  ))}
                </View>
              ))}
              {pieces
                .filter((piece) => piece.placement)
                .map((piece) => (
                  <DraggablePiece
                    key={`placed-${piece.id}`}
                    piece={piece}
                    cellSize={boardCellSize}
                    selected={selectedPieceId === piece.id}
                    disabled={false}
                    boardPosition={{
                      x: (piece.placement?.x ?? 0) * boardCellSize,
                      y: (piece.placement?.y ?? 0) * boardCellSize,
                    }}
                    onSelect={setSelectedPieceId}
                    onDrop={handlePieceDrop}
                    onRotate={rotatePiece}
                    onFlip={flipPiece}
                  />
                ))}
            </View>
            {pieces
              .filter((piece) => piece.stagingPosition && !piece.placement)
              .map((piece) => (
                <DraggablePiece
                  key={`staged-${piece.id}`}
                  piece={piece}
                  cellSize={boardCellSize}
                  selected={selectedPieceId === piece.id}
                  disabled={false}
                  stagingPosition={piece.stagingPosition}
                  onSelect={setSelectedPieceId}
                  onDrop={handlePieceDrop}
                  onRotate={rotatePiece}
                  onFlip={flipPiece}
                />
              ))}
            {status === "paused" ? (
              <Pressable style={[styles.pauseOverlay, { backgroundColor: dark ? "rgba(5, 13, 27, 0.88)" : "rgba(255, 255, 255, 0.92)" }]} onPress={togglePause}>
                <MaterialCommunityIcons name="play-circle-outline" size={48} color={gameColors.text} />
                <Text style={[styles.pauseOverlayText, { color: gameColors.text }]}>RESUME GAME</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View ref={stashPanelRef} collapsable={false} style={[styles.stashPanel, { backgroundColor: gameColors.panel, borderColor: gameColors.border }]}>
          <View style={[styles.sectionHeading, { borderBottomColor: gameColors.border }]}>
            <MaterialCommunityIcons name="gesture-tap" size={20} color={gameColors.muted} />
            <View>
              <Text style={[styles.sectionTitle, { color: gameColors.text }]}>PIECES</Text>
              <Text style={[styles.sectionSubtitle, { color: gameColors.muted }]}>DRAG · TAP ROTATES · HOLD FLIPS</Text>
            </View>
          </View>
          <View style={styles.piecesWrap}>
            {pieces.map((piece) => {
              const selected = selectedPieceId === piece.id;
              if (piece.stagingPosition || piece.placement) {
                return (
                  <View
                    key={`placeholder-${piece.id}`}
                    style={[styles.pieceSlot, { width: stashSlotWidth, height: stashSlotHeight }]}
                    pointerEvents="none"
                  />
                );
              }
              return (
                <DraggablePiece
                  key={piece.id}
                  piece={piece}
                  cellSize={previewCellSize}
                  slotHeight={stashSlotHeight}
                  slotWidth={stashSlotWidth}
                  preserveCellSize
                  selected={selected}
                  disabled={Boolean(piece.placement)}
                  onSelect={setSelectedPieceId}
                  onDrop={handlePieceDrop}
                  onRotate={rotatePiece}
                  onFlip={flipPiece}
                />
              );
            })}
          </View>

          <View style={styles.controlsGrid}>
            <Pressable style={[styles.controlButton, { backgroundColor: gameColors.panelSoft, borderColor: gameColors.border }]} onPress={rotateSelected}>
              <MaterialCommunityIcons name="rotate-right" size={25} color={gameColors.muted} />
              <Text style={[styles.controlText, { color: gameColors.muted }]}>ROTATE</Text>
            </Pressable>
            <Pressable style={[styles.controlButton, { backgroundColor: gameColors.panelSoft, borderColor: gameColors.border }]} onPress={flipSelected}>
              <MaterialCommunityIcons name="flip-horizontal" size={25} color={gameColors.muted} />
              <Text style={[styles.controlText, { color: gameColors.muted }]}>FLIP</Text>
            </Pressable>
            <View style={[styles.usedCounter, { backgroundColor: gameColors.panelSoft, borderColor: gameColors.border }]}>
              <Text style={[styles.gameStatLabel, { color: gameColors.muted }]}>PIECES USED</Text>
              <Text style={[styles.usedCounterValue, { color: gameColors.text }]}>{placedCount} / {pieces.length}</Text>
            </View>
            <Pressable style={[styles.controlButton, styles.controlButtonWide, styles.clearButton, { backgroundColor: gameColors.panelSoft }]} onPress={clearBoardPieces}>
              <MaterialCommunityIcons name="trash-can-outline" size={23} color="#ff526d" />
              <Text style={[styles.controlText, { color: gameColors.muted }]}>CLEAR BOARD</Text>
            </Pressable>
            <Pressable style={[styles.controlButton, styles.controlButtonWide, styles.resetButton]} onPress={resetLevelPieces}>
              <MaterialCommunityIcons name="restart" size={24} color="#d8ffe8" />
              <Text style={styles.controlText}>RESTART</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.bottomNav, { backgroundColor: gameColors.panel, borderColor: gameColors.border }]}>
          <Pressable style={styles.navItem} onPress={() => setScreen("home")}>
            <MaterialCommunityIcons name="home-outline" size={27} color={gameColors.muted} />
            <Text style={[styles.navText, { color: gameColors.muted }]}>HOME</Text>
          </Pressable>
          <View style={[styles.navItem, styles.navItemActive]}>
            <MaterialCommunityIcons name="puzzle" size={30} color={gameColors.blue} />
            <Text style={[styles.navText, styles.navTextActive, { color: gameColors.blue }]}>PLAY</Text>
          </View>
          <Pressable style={styles.navItem} onPress={() => setScreen("arena")}>
            <MaterialCommunityIcons name="trophy-outline" size={27} color={gameColors.muted} />
            <Text style={[styles.navText, { color: gameColors.muted }]}>ARENA</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={showHowTo} transparent animationType="fade" onRequestClose={() => setShowHowTo(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowHowTo(false)} />
          <View style={[styles.modalCard, { backgroundColor: gameColors.panel, borderColor: gameColors.border }]}>
            <View style={[styles.modalHeader, { borderBottomColor: gameColors.border }]}>
              <View>
                <Text style={[styles.howToTitle, { color: gameColors.muted }]}>HOW TO PLAY</Text>
                <Text style={[styles.modalSubtitle, { color: gameColors.muted }]}>Fill the target before time runs out.</Text>
              </View>
              <Pressable style={[styles.modalCloseButton, { borderColor: gameColors.border }]} onPress={() => setShowHowTo(false)}>
                <MaterialCommunityIcons name="close" size={23} color={gameColors.text} />
              </Pressable>
            </View>
            <View style={styles.howToRow}><Text style={[styles.stepNumber, { color: gameColors.muted, borderColor: gameColors.border }]}>1</Text><Text style={[styles.howToText, { color: gameColors.muted }]}>Select a piece, then tap a board cell to place it.</Text></View>
            <View style={styles.howToRow}><Text style={[styles.stepNumber, { color: gameColors.muted, borderColor: gameColors.border }]}>2</Text><Text style={[styles.howToText, { color: gameColors.muted }]}>Rotate or flip the selected piece when needed.</Text></View>
            <View style={styles.howToRow}><Text style={[styles.stepNumber, { color: gameColors.muted, borderColor: gameColors.border }]}>3</Text><Text style={[styles.howToText, { color: gameColors.muted }]}>Use every piece to fill the complete target.</Text></View>
            <Pressable style={styles.bannerButton} onPress={() => setShowHowTo(false)}>
              <Text style={styles.bannerButtonText}>Got It</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={status === "won" || status === "lost" || status === "error"}
        transparent
        animationType="fade"
        onRequestClose={() => undefined}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.resultCard, { backgroundColor: gameColors.panel, borderColor: gameColors.border }]}>
            <MaterialCommunityIcons
              name={status === "won" ? "trophy-outline" : status === "lost" ? "timer-alert-outline" : "alert-circle-outline"}
              size={46}
              color={status === "won" ? "#1fe2a5" : status === "lost" ? "#ff526d" : gameColors.amber}
            />
            <Text
              style={[
                styles.bannerTitle,
                status === "lost" && { color: "#ff526d" },
                status === "error" && { color: gameColors.amber },
              ]}
            >
              {status === "won" ? "LEVEL CLEARED" : status === "lost" ? "TIME IS UP" : errorText}
            </Text>
            <Pressable style={styles.bannerButton} onPress={status === "won" ? goToNextLevel : () => startLevel(level)}>
              <Text style={styles.bannerButtonText}>{status === "won" ? "Next Level" : status === "lost" ? "Try Again" : "Retry"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingTop: 4,
    paddingBottom: 6,
  },
  homeContainer: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 18,
  },
  homeAccountRow: {
    minHeight: 42,
    alignItems: "flex-end",
  },
  homeAccountPill: {
    maxWidth: "82%",
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  homeAccountName: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  homeHero: {
    flex: 1,
    minHeight: 150,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 22,
  },
  homeTagline: {
    marginTop: 13,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 3.1,
    textAlign: "center",
  },
  homeMenu: {
    width: "100%",
    maxWidth: 390,
    alignSelf: "center",
    gap: 10,
  },
  homeMenuButton: {
    position: "relative",
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  homeMenuButtonText: {
    fontSize: 18,
    fontWeight: "900",
  },
  homeMenuBadge: {
    position: "absolute",
    top: 9,
    right: 10,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  homeMenuBadgeText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  homeFooter: {
    alignItems: "center",
    gap: 8,
    paddingTop: 22,
  },
  homeFooterBrand: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 3,
  },
  homeThemeLink: {
    fontSize: 11,
    fontWeight: "700",
  },
  sectionScreenContainer: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    padding: 20,
    gap: 22,
  },
  featureScreenContainer: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    padding: 20,
    gap: 20,
  },
  sectionScreenHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  sectionBackButton: {
    width: 46,
    height: 46,
    borderWidth: 1,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeaderCopy: {
    flex: 1,
  },
  sectionScreenTitle: {
    fontSize: 27,
    fontWeight: "900",
  },
  sectionScreenSubtitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
  },
  levelGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  levelTile: {
    width: "17.5%",
    minWidth: 56,
    aspectRatio: 1,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  levelTileLocked: {
    opacity: 0.42,
  },
  levelTileNumber: {
    fontSize: 17,
    fontWeight: "900",
  },
  levelTileMeta: {
    fontSize: 8,
    fontWeight: "800",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statSummaryCard: {
    width: "48%",
    minHeight: 132,
    borderWidth: 1,
    borderRadius: 18,
    padding: 17,
    justifyContent: "center",
    gap: 6,
  },
  statSummaryValue: {
    marginTop: 3,
    fontSize: 25,
    fontWeight: "900",
  },
  statSummaryLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  featureHeroCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    gap: 13,
  },
  featureIconCircle: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: "center",
    justifyContent: "center",
  },
  crossPlatformBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(113, 137, 255, 0.16)",
  },
  crossPlatformBadgeText: {
    color: "#7189ff",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  featureTitle: {
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  featureDescription: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  arenaRatingRow: {
    width: "100%",
    marginTop: 5,
    borderTopWidth: 1,
    borderTopColor: "rgba(140, 154, 181, 0.22)",
    paddingTop: 15,
    alignItems: "center",
  },
  arenaRatingLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  arenaRatingValue: {
    fontSize: 34,
    fontWeight: "900",
  },
  featureActionButton: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  featureActionText: {
    fontSize: 15,
    fontWeight: "900",
  },
  profileContainer: {
    flexGrow: 1,
    padding: 24,
    justifyContent: "center",
    gap: 16,
  },
  backLink: {
    fontSize: 15,
    fontWeight: "800",
  },
  accountCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    minHeight: 76,
    justifyContent: "center",
    gap: 5,
  },
  authCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  authIntro: {
    gap: 5,
    marginBottom: 3,
  },
  authEyebrow: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.7,
  },
  authHeading: {
    fontSize: 25,
    fontWeight: "900",
  },
  authDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  googleButton: {
    minHeight: 52,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#d9dee8",
    backgroundColor: "#ffffff",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
  },
  googleButtonDisabled: {
    backgroundColor: "#f2f4f8",
  },
  googleButtonText: {
    color: "#182033",
    fontSize: 16,
    fontWeight: "800",
  },
  googleButtonTextDisabled: {
    color: "#7c879b",
  },
  googleConfigHint: {
    color: "#8c6270",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  authDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 2,
  },
  authDividerLine: {
    flex: 1,
    height: 1,
  },
  authDividerText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  authTabs: {
    flexDirection: "row",
    gap: 8,
  },
  authTab: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  authTabText: {
    fontSize: 14,
    fontWeight: "800",
  },
  input: {
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
  },
  authError: {
    color: "#d22643",
    fontWeight: "700",
  },
  profileName: {
    fontSize: 24,
    fontWeight: "900",
  },
  dangerButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 8,
  },
  dangerText: {
    color: "#d22643",
    fontSize: 16,
    fontWeight: "800",
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 12,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: "600",
  },
  ctaButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#ffffff",
  },
  secondaryButton: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: {
    fontSize: 16,
    fontWeight: "700",
  },
  gameContainer: {
    flex: 1,
    alignSelf: "center",
    paddingVertical: 6,
    gap: 7,
  },
  ambientGlowTop: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(48, 91, 188, 0.10)",
    top: -160,
    left: -90,
  },
  ambientGlowBottom: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(0, 210, 190, 0.05)",
    bottom: -180,
    right: -180,
  },
  gameHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    borderRadius: 16,
    backgroundColor: "rgba(5, 16, 31, 0.98)",
  },
  squareIconButton: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    backgroundColor: "rgba(15, 25, 42, 0.94)",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  brandBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  wordmarkLockup: {
    alignItems: "center",
    justifyContent: "center",
  },
  wordmarkTextStack: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.7,
    textShadowColor: "rgba(56, 125, 255, 0.48)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  wordmarkHero: {
    fontSize: 34,
    letterSpacing: 1.1,
    textShadowRadius: 7,
  },
  wordmarkLight: {
    textShadowColor: "rgba(5, 13, 27, 0.72)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1.2,
  },
  wordmarkOutline: {
    position: "absolute",
    top: 0,
    left: 0,
    color: "#17233a",
    textShadowColor: "transparent",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  wordmarkBase: {
    color: "#f7f9ff",
  },
  wordmarkBaseLight: {
    color: "#ffffff",
    textShadowColor: "rgba(20, 33, 58, 0.72)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1.2,
  },
  wordmarkOrnaments: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 1,
  },
  wordmarkOrnamentsHero: {
    marginTop: 5,
    gap: 7,
  },
  wordmarkRule: {
    width: 31,
    height: 2,
    borderRadius: 2,
  },
  wordmarkRuleHero: {
    width: 54,
    height: 3,
  },
  wordmarkRuleWarm: {
    backgroundColor: "#ff7b1a",
  },
  wordmarkRuleCool: {
    backgroundColor: "#18bfff",
  },
  wordmarkBlocks: {
    flexDirection: "row",
    gap: 3,
  },
  wordmarkBlock: {
    width: 7,
    height: 7,
    borderRadius: 2,
    borderWidth: 0.7,
    borderColor: "rgba(255,255,255,0.7)",
    shadowColor: "#000000",
    shadowOpacity: 0.8,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  brandTitle: {
    color: GAME_COLORS.text,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2.2,
  },
  brandSubtitle: {
    color: GAME_COLORS.blue,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 2,
    marginTop: 3,
  },
  headerActions: {
    flexDirection: "row",
    gap: 7,
  },
  gameStatsCard: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    borderRadius: 16,
    backgroundColor: "rgba(8, 20, 36, 0.98)",
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  gameStatItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexShrink: 1,
  },
  statIconBox: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  levelIconBox: {
    backgroundColor: "rgba(124, 39, 188, 0.22)",
    borderColor: "rgba(194, 91, 255, 0.34)",
  },
  targetIconBox: {
    backgroundColor: "rgba(0, 130, 210, 0.18)",
    borderColor: "rgba(33, 184, 255, 0.28)",
  },
  timeIconBox: {
    backgroundColor: "rgba(0, 170, 105, 0.16)",
    borderColor: "rgba(40, 230, 150, 0.28)",
  },
  levelStatContent: {
    minWidth: 52,
  },
  levelProgressTrack: {
    width: 52,
    height: 4,
    marginTop: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "#15243b",
  },
  levelProgressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: "#bd3cff",
  },
  gameStatLabel: {
    color: GAME_COLORS.muted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  gameStatValue: {
    color: GAME_COLORS.text,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 2,
  },
  gameStatMuted: {
    color: GAME_COLORS.muted,
    fontSize: 13,
  },
  statDivider: {
    width: 1,
    height: 34,
    backgroundColor: GAME_COLORS.border,
  },
  pauseButton: {
    width: 40,
    height: 42,
    borderRadius: 15,
    backgroundColor: GAME_COLORS.panelSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  boardCard: {
    flex: 0.94,
    minHeight: 146,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    borderRadius: 21,
    backgroundColor: "rgba(8, 20, 36, 0.98)",
    padding: 8,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  boardCoordinates: {
    flexDirection: "row",
    marginBottom: 5,
  },
  coordinateText: {
    color: GAME_COLORS.muted,
    fontSize: 9,
    fontWeight: "700",
    textAlign: "center",
  },
  boardFrame: {
    borderWidth: 2,
    borderColor: "#435069",
    backgroundColor: "#0b1423",
    position: "relative",
    overflow: "visible",
  },
  boardRow: {
    flexDirection: "row",
  },
  cell: {
    borderWidth: 1,
    shadowOpacity: 0.55,
    shadowRadius: 5,
    elevation: 2,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    backgroundColor: "rgba(5, 13, 27, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pauseOverlayText: {
    color: GAME_COLORS.text,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  stashPanel: {
    flex: 1.28,
    minHeight: 232,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    borderRadius: 21,
    backgroundColor: "rgba(8, 20, 36, 0.98)",
    padding: 9,
    gap: 6,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: GAME_COLORS.border,
  },
  sectionTitle: {
    color: GAME_COLORS.text,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  sectionSubtitle: {
    color: "#526078",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginTop: 1,
  },
  piecesWrap: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignContent: "center",
    columnGap: 3,
    rowGap: 2,
    minHeight: 86,
    paddingVertical: 1,
  },
  pieceSlot: {
    width: "23.5%",
    minWidth: 68,
    height: 60,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  stagedPiece: {
    position: "absolute",
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  pieceSlotSelected: {
    backgroundColor: "transparent",
  },
  pieceSlotPlaced: {
    opacity: 0.16,
  },
  pieceSlotDragging: {
    zIndex: 1000,
    elevation: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    opacity: 1,
  },
  previewCell: {
    position: "absolute",
    borderRadius: 5,
    shadowOpacity: 0.75,
    shadowRadius: 7,
    elevation: 6,
  },
  controlsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  controlButton: {
    flexGrow: 1,
    flexBasis: "29%",
    minHeight: 48,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    borderRadius: 14,
    backgroundColor: "#09172a",
    paddingVertical: 6,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  controlText: {
    color: GAME_COLORS.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  usedCounter: {
    flexGrow: 1,
    flexBasis: "29%",
    minHeight: 48,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    borderRadius: 14,
    backgroundColor: GAME_COLORS.panelSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  usedCounterValue: {
    color: GAME_COLORS.text,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 2,
  },
  controlButtonWide: {
    flexBasis: "46%",
  },
  clearButton: {
    borderColor: "rgba(255, 82, 109, 0.22)",
  },
  resetButton: {
    borderColor: "rgba(37, 229, 116, 0.48)",
    backgroundColor: "#087c3b",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(1, 6, 16, 0.76)",
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    width: "100%",
    maxWidth: 430,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    borderRadius: 22,
    backgroundColor: GAME_COLORS.panel,
    padding: 18,
    gap: 14,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: GAME_COLORS.border,
  },
  modalSubtitle: {
    color: GAME_COLORS.muted,
    fontSize: 12,
    marginTop: 5,
  },
  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  resultCard: {
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    borderRadius: 22,
    backgroundColor: GAME_COLORS.panel,
    padding: 22,
    gap: 16,
    alignItems: "center",
  },
  howToTitle: {
    color: GAME_COLORS.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  howToRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepNumber: {
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    color: GAME_COLORS.muted,
    textAlign: "center",
    lineHeight: 21,
    fontSize: 11,
    fontWeight: "800",
  },
  howToText: {
    flex: 1,
    color: GAME_COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  bannerTitle: {
    fontWeight: "900",
    fontSize: 18,
    color: "#1fe2a5",
    textAlign: "center",
    letterSpacing: 1,
  },
  bannerButton: {
    width: "100%",
    backgroundColor: GAME_COLORS.blue,
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: "center",
  },
  bannerButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 15,
  },
  bottomNav: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: GAME_COLORS.border,
    borderRadius: 18,
    backgroundColor: "rgba(8, 20, 36, 0.99)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 8,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  navItemActive: {
    alignSelf: "stretch",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(38, 111, 255, 0.34)",
    backgroundColor: "rgba(23, 73, 170, 0.10)",
  },
  navText: {
    color: GAME_COLORS.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  navTextActive: {
    color: GAME_COLORS.blue,
  },
});
