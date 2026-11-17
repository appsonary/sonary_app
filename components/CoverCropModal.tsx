import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
  FlipHorizontal,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react-native';
import { AmbientGlowBackground } from './AmbientGlowBackground';
import { AtmosphericGradient } from './AtmosphericGradient';
import { cropPlaylistCoverImage, PickedCoverAsset } from '../services/storage';
import { useModalEnterAnimation } from './sheetMotion';
import { getEaseOutCubic, theme } from '../theme';
import { useBackModalLock } from '../services/backNavigation';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CROP_BOX_SIZE = Math.min(SCREEN_WIDTH - 40, 340);
const ANDROID_STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

export interface CropGeometryInput {
  imageWidth: number;
  imageHeight: number;
  viewportSize: number;
  rotation: number;
  panX: number;
  panY: number;
  zoom: number;
}

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * Calcula a caixa de recorte 1:1 em pixels reais da imagem após rotação,
 * correspondendo exatamente à janela quadrada visível na tela.
 */
export function computeCropRect({
  imageWidth,
  imageHeight,
  viewportSize,
  rotation,
  panX,
  panY,
  zoom,
}: CropGeometryInput): CropRect | undefined {
  if (imageWidth <= 0 || imageHeight <= 0 || viewportSize <= 0) {
    return undefined;
  }

  const normalizedRot = ((rotation % 360) + 360) % 360;
  const rotated90 = normalizedRot === 90 || normalizedRot === 270;
  const effW = rotated90 ? imageHeight : imageWidth;
  const effH = rotated90 ? imageWidth : imageHeight;

  const safeZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const baseScale = Math.max(viewportSize / effW, viewportSize / effH);
  const totalScale = baseScale * safeZoom;

  const cropSide = Math.min(Math.round(viewportSize / totalScale), effW, effH);
  const centerX = effW / 2 - panX / totalScale;
  const centerY = effH / 2 - panY / totalScale;

  const maxOriginX = Math.max(0, effW - cropSide);
  const maxOriginY = Math.max(0, effH - cropSide);
  const originX = Math.max(0, Math.min(maxOriginX, Math.round(centerX - cropSide / 2)));
  const originY = Math.max(0, Math.min(maxOriginY, Math.round(centerY - cropSide / 2)));

  return {
    originX,
    originY,
    width: cropSide,
    height: cropSide,
  };
}

function getPanBounds(
  effW: number,
  effH: number,
  viewportSize: number,
  zoom: number
): { maxX: number; maxY: number; baseScale: number } {
  if (effW <= 0 || effH <= 0) {
    return { maxX: 0, maxY: 0, baseScale: 1 };
  }
  const baseScale = Math.max(viewportSize / effW, viewportSize / effH);
  const dispW = effW * baseScale * zoom;
  const dispH = effH * baseScale * zoom;
  return {
    baseScale,
    maxX: Math.max(0, (dispW - viewportSize) / 2),
    maxY: Math.max(0, (dispH - viewportSize) / 2),
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function getTouchDistance(touches: Array<{ pageX: number; pageY: number }>): number {
  if (touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

export interface CoverCropModalProps {
  visible: boolean;
  asset: PickedCoverAsset | null;
  onCancel: () => void;
  onConfirm: (croppedUri: string) => void;
}

export const CoverCropModal: React.FC<CoverCropModalProps> = ({
  visible,
  asset,
  onCancel,
  onConfirm,
}) => {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({
    width: asset?.width || 0,
    height: asset?.height || 0,
  });
  const [rotation, setRotation] = useState(0);
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const entryOpacity = useRef(new Animated.Value(0)).current;
  const gestureStartRef = useRef({
    panX: 0,
    panY: 0,
    zoom: MIN_ZOOM,
    pinchDistance: 0,
  });

  // Mantém refs atuais para o PanResponder não fechar sobre valores antigos
  const stateRef = useRef({
    effW: 0,
    effH: 0,
    zoom: MIN_ZOOM,
    panX: 0,
    panY: 0,
  });

  useBackModalLock(Boolean(visible && asset));

  const { onModalShow } = useModalEnterAnimation({
    visible: Boolean(visible && asset),
    onReset: () => {
      entryOpacity.setValue(0);
    },
    onAnimateIn: () => {
      const anim = Animated.timing(entryOpacity, {
        toValue: 1,
        duration: theme.transitions.screenInMs,
        easing: getEaseOutCubic(Easing),
        useNativeDriver: true,
      });
      anim.start();
      return anim;
    },
  });

  useEffect(() => {
    if (!visible || !asset) return;
    setRotation(0);
    setFlipHorizontal(false);
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
    setIsProcessing(false);
    setErrorMessage(null);

    if (asset.width > 0 && asset.height > 0) {
      setNaturalSize({ width: asset.width, height: asset.height });
    } else if (typeof Image.getSize === 'function') {
      Image.getSize(
        asset.uri,
        (w, h) => setNaturalSize({ width: w, height: h }),
        () => setNaturalSize({ width: 1000, height: 1000 })
      );
    }
  }, [visible, asset?.uri]);

  const rotated90 = ((rotation % 360) + 360) % 360 === 90 ||
    ((rotation % 360) + 360) % 360 === 270;
  const effW = rotated90 ? naturalSize.height : naturalSize.width;
  const effH = rotated90 ? naturalSize.width : naturalSize.height;
  const { baseScale, maxX, maxY } = getPanBounds(effW, effH, CROP_BOX_SIZE, zoom);

  stateRef.current = {
    effW,
    effH,
    zoom,
    panX: pan.x,
    panY: pan.y,
  };

  const updateZoomClamped = (nextZoom: number) => {
    const clampedZoom = clamp(Math.round(nextZoom * 100) / 100, MIN_ZOOM, MAX_ZOOM);
    const bounds = getPanBounds(effW, effH, CROP_BOX_SIZE, clampedZoom);
    setZoom(clampedZoom);
    setPan((prev) => ({
      x: clamp(prev.x, -bounds.maxX, bounds.maxX),
      y: clamp(prev.y, -bounds.maxY, bounds.maxY),
    }));
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const touches = (evt?.nativeEvent?.touches || []) as Array<{
            pageX: number;
            pageY: number;
          }>;
          gestureStartRef.current = {
            panX: stateRef.current.panX,
            panY: stateRef.current.panY,
            zoom: stateRef.current.zoom,
            pinchDistance: touches.length >= 2 ? getTouchDistance(touches) : 0,
          };
        },
        onPanResponderMove: (evt, gs) => {
          const touches = (evt?.nativeEvent?.touches || []) as Array<{
            pageX: number;
            pageY: number;
          }>;
          const { effW: curW, effH: curH } = stateRef.current;

          if (touches.length >= 2) {
            const curDist = getTouchDistance(touches);
            if (gestureStartRef.current.pinchDistance > 0 && curDist > 0) {
              const ratio = curDist / gestureStartRef.current.pinchDistance;
              const nextZ = clamp(
                gestureStartRef.current.zoom * ratio,
                MIN_ZOOM,
                MAX_ZOOM
              );
              const bounds = getPanBounds(curW, curH, CROP_BOX_SIZE, nextZ);
              setZoom(nextZ);
              setPan({
                x: clamp(gestureStartRef.current.panX, -bounds.maxX, bounds.maxX),
                y: clamp(gestureStartRef.current.panY, -bounds.maxY, bounds.maxY),
              });
            } else {
              gestureStartRef.current.pinchDistance = curDist;
            }
            return;
          }

          const bounds = getPanBounds(
            curW,
            curH,
            CROP_BOX_SIZE,
            stateRef.current.zoom
          );
          setPan({
            x: clamp(gestureStartRef.current.panX + gs.dx, -bounds.maxX, bounds.maxX),
            y: clamp(gestureStartRef.current.panY + gs.dy, -bounds.maxY, bounds.maxY),
          });
        },
        onPanResponderRelease: () => {
          gestureStartRef.current.pinchDistance = 0;
        },
      }),
    []
  );

  if (!visible || !asset) return null;

  const isModified =
    zoom !== MIN_ZOOM || pan.x !== 0 || pan.y !== 0 || rotation !== 0 || flipHorizontal;

  const handleRotate = () => {
    const nextRot = (rotation + 90) % 360;
    setRotation(nextRot);
    setPan({ x: 0, y: 0 });
  };

  const handleReset = () => {
    setRotation(0);
    setFlipHorizontal(false);
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  };

  const handleConfirmCrop = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const cropRect = computeCropRect({
        imageWidth: naturalSize.width,
        imageHeight: naturalSize.height,
        viewportSize: CROP_BOX_SIZE,
        rotation,
        panX: pan.x,
        panY: pan.y,
        zoom,
      });

      const croppedUri = await cropPlaylistCoverImage(asset.uri, {
        rotation,
        flipHorizontal,
        crop: cropRect,
      });
      onConfirm(croppedUri);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Não foi possível aplicar o recorte nesta imagem.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const rawDispW = naturalSize.width > 0 ? naturalSize.width * baseScale : CROP_BOX_SIZE;
  const rawDispH = naturalSize.height > 0 ? naturalSize.height * baseScale : CROP_BOX_SIZE;
  const zoomPercent = ((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100;

  return (
    <Modal
      visible={visible}
      transparent={true}
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      animationType="none"
      onShow={onModalShow}
      onRequestClose={() => !isProcessing && onCancel()}
    >
      <Animated.View style={[styles.container, { opacity: entryOpacity }]}>
        <StatusBar
          barStyle="light-content"
          backgroundColor="transparent"
          translucent={true}
        />

        {/* Glow atmosférico no padrão do Sonary Pro */}
        <View pointerEvents="none" style={styles.glowBackdrop}>
          {asset.uri ? (
            <AmbientGlowBackground
              artworkUri={asset.uri}
              crossfadeDurationMs={theme.transitions.glowEntryMs}
            />
          ) : (
            <AtmosphericGradient height={520} />
          )}
        </View>

        {/* Top Bar minimalista em Português */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.iconCircleBtn}
            onPress={onCancel}
            disabled={isProcessing}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Cancelar ajuste da capa"
          >
            <ArrowLeft color="#FFFFFF" size={20} />
          </TouchableOpacity>

          <View style={styles.titleBlock}>
            <Text style={styles.headerTitle}>Ajustar capa</Text>
            <Text style={styles.headerSubtitle}>Enquadramento 1:1</Text>
          </View>

          <TouchableOpacity
            style={[styles.confirmPill, isProcessing && styles.confirmPillDisabled]}
            onPress={handleConfirmCrop}
            disabled={isProcessing}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Confirmar recorte da capa"
          >
            {isProcessing ? (
              <ActivityIndicator color="#030303" size="small" />
            ) : (
              <Text style={styles.confirmPillText}>Usar capa</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Área central de recorte */}
        <View style={styles.stageContainer}>
          <View style={styles.cropStageShadow}>
            <View
              style={styles.cropViewport}
              {...panResponder.panHandlers}
              testID="cover-crop-viewport"
            >
              <View
                style={[
                  styles.imageTransformLayer,
                  {
                    transform: [
                      { translateX: clamp(pan.x, -maxX, maxX) },
                      { translateY: clamp(pan.y, -maxY, maxY) },
                      { scale: zoom },
                    ],
                  },
                ]}
              >
                <Image
                  source={{ uri: asset.uri }}
                  style={{
                    width: rawDispW,
                    height: rawDispH,
                    transform: [
                      { scaleX: flipHorizontal ? -1 : 1 },
                      { rotate: `${rotation}deg` },
                    ],
                  }}
                  resizeMode="cover"
                />
              </View>

              {/* Grade sutil 3x3 de composição (não bloqueia gestos) */}
              <View pointerEvents="none" style={styles.gridOverlay}>
                <View style={[styles.gridLineV, { left: '33.33%' }]} />
                <View style={[styles.gridLineV, { left: '66.66%' }]} />
                <View style={[styles.gridLineH, { top: '33.33%' }]} />
                <View style={[styles.gridLineH, { top: '66.66%' }]} />
              </View>

              {/* Borda luminosa da capa 1:1 */}
              <View pointerEvents="none" style={styles.frameBorder} />
            </View>
          </View>

          <Text style={styles.hintText}>
            Arraste para enquadrar • Use pinça ou os botões de zoom
          </Text>

          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
        </View>

        {/* Dock inferior de controles com linguagem Sonary */}
        <View style={styles.controlsDock}>
          {/* Barra de Zoom */}
          <View style={styles.zoomRow}>
            <TouchableOpacity
              style={[
                styles.zoomBtn,
                zoom <= MIN_ZOOM && styles.zoomBtnDisabled,
              ]}
              onPress={() => updateZoomClamped(zoom - ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM || isProcessing}
              accessibilityRole="button"
              accessibilityLabel="Diminuir zoom da capa"
            >
              <ZoomOut
                color={zoom <= MIN_ZOOM ? '#717171' : '#FFFFFF'}
                size={18}
              />
            </TouchableOpacity>

            <View style={styles.zoomTrackWrap}>
              <View style={styles.zoomTrackBg}>
                <View
                  style={[
                    styles.zoomTrackFill,
                    { width: `${Math.max(4, zoomPercent)}%` },
                  ]}
                />
              </View>
              <Text style={styles.zoomBadge}>{zoom.toFixed(1)}x</Text>
            </View>

            <TouchableOpacity
              style={[
                styles.zoomBtn,
                zoom >= MAX_ZOOM && styles.zoomBtnDisabled,
              ]}
              onPress={() => updateZoomClamped(zoom + ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM || isProcessing}
              accessibilityRole="button"
              accessibilityLabel="Aumentar zoom da capa"
            >
              <ZoomIn
                color={zoom >= MAX_ZOOM ? '#717171' : '#FFFFFF'}
                size={18}
              />
            </TouchableOpacity>
          </View>

          {/* Ações de rotação / espelho / redefinir */}
          <View style={styles.toolsRow}>
            <TouchableOpacity
              style={styles.toolChip}
              onPress={handleRotate}
              disabled={isProcessing}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Girar capa 90 graus"
            >
              <RotateCw color="#FFFFFF" size={16} />
              <Text style={styles.toolChipText}>Girar 90°</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolChip, flipHorizontal && styles.toolChipActive]}
              onPress={() => setFlipHorizontal((prev) => !prev)}
              disabled={isProcessing}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Espelhar capa horizontalmente"
            >
              <FlipHorizontal
                color={flipHorizontal ? '#030303' : '#FFFFFF'}
                size={16}
              />
              <Text
                style={[
                  styles.toolChipText,
                  flipHorizontal && styles.toolChipTextActive,
                ]}
              >
                Espelhar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolChip, !isModified && styles.toolChipDisabled]}
              onPress={handleReset}
              disabled={!isModified || isProcessing}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Redefinir ajuste da capa"
            >
              <RotateCcw color={isModified ? '#FFFFFF' : '#717171'} size={16} />
              <Text
                style={[
                  styles.toolChipText,
                  !isModified && styles.toolChipTextDisabled,
                ]}
              >
                Redefinir
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  glowBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUS_BAR_HEIGHT + 12 : 52,
    paddingBottom: 12,
    zIndex: 2,
  },
  iconCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 1,
  },
  confirmPill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    paddingHorizontal: 16,
    height: 36,
    minWidth: 94,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmPillDisabled: {
    opacity: 0.6,
  },
  confirmPillText: {
    color: '#030303',
    fontSize: 14,
    fontWeight: '700',
  },
  stageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    zIndex: 1,
  },
  cropStageShadow: {
    width: CROP_BOX_SIZE,
    height: CROP_BOX_SIZE,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.65,
    shadowRadius: 24,
    elevation: 14,
  },
  cropViewport: {
    width: CROP_BOX_SIZE,
    height: CROP_BOX_SIZE,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageTransformLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  frameBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.72)',
  },
  hintText: {
    color: '#AAAAAA',
    fontSize: 12,
    marginTop: 18,
    textAlign: 'center',
  },
  errorText: {
    color: '#FF4E45',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  controlsDock: {
    backgroundColor: '#121214',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 32 : 24,
    gap: 16,
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  zoomBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBtnDisabled: {
    opacity: 0.45,
  },
  zoomTrackWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  zoomTrackBg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    overflow: 'hidden',
  },
  zoomTrackFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  zoomBadge: {
    color: '#AAAAAA',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'right',
  },
  toolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 9999,
    backgroundColor: theme.colors.elevated,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  toolChipActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  toolChipDisabled: {
    opacity: 0.45,
  },
  toolChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  toolChipTextActive: {
    color: '#030303',
  },
  toolChipTextDisabled: {
    color: '#717171',
  },
});

