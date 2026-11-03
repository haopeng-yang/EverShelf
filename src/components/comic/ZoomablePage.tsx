import { useEffect, type ReactNode } from 'react';
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDecay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const MAX_SCALE = 4;
/** A pinch may stretch a little past the limits, then settles back when the fingers lift. */
const MIN_STRETCH = 0.8;
const MAX_STRETCH = 5;
const SETTLE_MS = 200;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

interface Props {
  width: number;
  height: number;
  /** When false the page goes back to its normal size, e.g. once it is turned away from. */
  active: boolean;
  onTap: (x: number) => void;
  onZoomChange: (zoomed: boolean) => void;
  children: ReactNode;
}

/**
 * A comic page that zooms with two fingers around the point between them.
 * While zoomed in, one finger drags the page around; pinching back out to the
 * normal size lets the list scroll again.
 */
export function ZoomablePage({ width, height, active, onTap, onZoomChange, children }: Props) {
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const zoomed = useSharedValue(false);
  // Where the gesture started, so each update is worked out from there.
  const start = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 });

  /** How far the page can move each way at this scale without showing past its edges. */
  const limitX = (s: number) => {
    'worklet';
    return (width * (s - 1)) / 2;
  };
  const limitY = (s: number) => {
    'worklet';
    return (height * (s - 1)) / 2;
  };

  const setZoomed = (next: boolean) => {
    'worklet';
    if (zoomed.get() === next) return;
    zoomed.set(next);
    scheduleOnRN(onZoomChange, next);
  };

  const reset = () => {
    'worklet';
    scale.set(withTiming(1, { duration: SETTLE_MS }));
    x.set(withTiming(0, { duration: SETTLE_MS }));
    y.set(withTiming(0, { duration: SETTLE_MS }));
    setZoomed(false);
  };

  useEffect(() => {
    if (active) return;
    scale.set(1);
    x.set(0);
    y.set(0);
    if (zoomed.get()) {
      zoomed.set(false);
      onZoomChange(false);
    }
  }, [active, onZoomChange, scale, x, y, zoomed]);

  const pinch = usePinchGesture({
    onActivate: (e) => {
      // Focal points are measured from the page's centre, where the scaling happens.
      start.set({
        scale: scale.get(),
        x: x.get(),
        y: y.get(),
        focalX: e.focalX - width / 2,
        focalY: e.focalY - height / 2,
      });
    },
    onUpdate: (e) => {
      const from = start.get();
      const s = clamp(from.scale * e.scale, MIN_STRETCH, MAX_STRETCH);
      // Keep the bit of the page that was under the fingers under them, following them as they move.
      scale.set(s);
      x.set(e.focalX - width / 2 - ((from.focalX - from.x) / from.scale) * s);
      y.set(e.focalY - height / 2 - ((from.focalY - from.y) / from.scale) * s);
    },
    onDeactivate: () => {
      if (scale.get() <= 1) {
        reset();
        return;
      }
      const s = Math.min(scale.get(), MAX_SCALE);
      scale.set(withTiming(s, { duration: SETTLE_MS }));
      x.set(withTiming(clamp(x.get(), -limitX(s), limitX(s)), { duration: SETTLE_MS }));
      y.set(withTiming(clamp(y.get(), -limitY(s), limitY(s)), { duration: SETTLE_MS }));
      setZoomed(true);
    },
  });

  // Only drags while zoomed in; otherwise the swipe belongs to the list.
  const pan = usePanGesture({
    enabled: zoomed,
    onActivate: () => {
      start.set({ ...start.get(), x: x.get(), y: y.get() });
    },
    onUpdate: (e) => {
      const s = scale.get();
      x.set(clamp(start.get().x + e.translationX, -limitX(s), limitX(s)));
      y.set(clamp(start.get().y + e.translationY, -limitY(s), limitY(s)));
    },
    onDeactivate: (e) => {
      const s = scale.get();
      x.set(withDecay({ velocity: e.velocityX, clamp: [-limitX(s), limitX(s)] }));
      y.set(withDecay({ velocity: e.velocityY, clamp: [-limitY(s), limitY(s)] }));
    },
  });

  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (e) => onTap(e.x),
  });

  // A pinch or drag that gets going wins over a tap, and the other way round.
  const gesture = useCompetingGestures(useSimultaneousGestures(pinch, pan), tap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={{ width, height, overflow: 'hidden' }}>
        <Animated.View style={[{ width, height }, animatedStyle]}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
