import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import React, { useRef, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { scanBridge } from '../scanBridge';

// IMPORTANT — why this screen uses explicit width/height instead of flex:1
// ------------------------------------------------------------------------
// Earlier versions styled the container as { flex: 1 } and the CameraView as
// StyleSheet.absoluteFillObject. On this setup that container was collapsing to
// (near) zero height — the giveaway was that the centred scan frame always
// rendered at the TOP of the screen instead of the middle. A zero-height
// container means the camera's native surface gets laid out at ~0px, so it
// never paints a frame: permission granted, no error, just black.
//
// Sizing the container and the camera from useWindowDimensions() removes the
// dependency on the parent's layout entirely, so the camera always gets real
// pixels to draw into.

export default function ScanCamera() {
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [checking, setChecking]         = useState(true);
  const [cameraReady, setCameraReady]   = useState(false);
  const [mountError, setMountError]     = useState<string | null>(null);
  const lockRef = useRef(false); // prevents double-firing on the same scan burst

  useEffect(() => {
    (async () => {
      if (!permission || !permission.granted) {
        await requestPermission();
      }
      setChecking(false);
    })();
  }, []); // eslint-disable-line

  const close = () => router.back();

  const onBarcodeDetected = (result: { data: string }) => {
    if (lockRef.current) return;
    lockRef.current = true;
    scanBridge.emit(result.data);
    router.back();
  };

  if (checking) {
    return (
      <View style={[styles.center, { width, height }]}>
        <ActivityIndicator color="#17B9A1" size="large" />
      </View>
    );
  }

  if (!permission?.granted) {
    return (
      <View style={[styles.center, { width, height }]}>
        <Text style={styles.permText}>Camera permission is needed to scan barcodes.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.closeLink} onPress={close}>
          <Text style={styles.closeLinkText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { width, height }]}>
      <CameraView
        style={{ width, height }}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['code128', 'code39', 'codabar', 'ean13', 'ean8', 'upc_a', 'upc_e', 'qr', 'itf14'],
        }}
        onBarcodeScanned={onBarcodeDetected}
        onCameraReady={() => setCameraReady(true)}
        onMountError={(e: any) => setMountError(e?.message ?? 'Unknown camera mount error')}
      />

      {/* Scan frame + hint, absolutely positioned over the camera */}
      <View style={[styles.overlay, { width, height }]} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.hint}>Align the barcode within the frame</Text>
      </View>

      {/* Diagnostics — if the camera never becomes ready or fails to mount,
          say so on screen instead of silently showing a black rectangle. */}
      {!cameraReady && !mountError && (
        <View style={styles.statusBox} pointerEvents="none">
          <ActivityIndicator color="#17B9A1" size="small" />
          <Text style={styles.statusText}>Starting camera…</Text>
        </View>
      )}
      {!!mountError && (
        <View style={[styles.statusBox, { borderColor: '#EF4444' }]} pointerEvents="none">
          <Text style={[styles.statusText, { color: '#EF4444' }]}>Camera error: {mountError}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.closeBtn} onPress={close}>
        <Text style={styles.closeBtnText}>✕  Close</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { backgroundColor: '#000' },
  center:       { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 },
  permText:     { color: '#fff', fontSize: 15, textAlign: 'center', marginBottom: 20 },
  permBtn:      { backgroundColor: '#17B9A1', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  permBtnText:  { color: '#fff', fontWeight: '700' },
  closeLink:    { marginTop: 16 },
  closeLinkText:{ color: '#94A3B8', fontSize: 13 },
  overlay:      { position: 'absolute', top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  frame:        { width: '78%', height: 140, borderWidth: 3, borderColor: '#17B9A1', borderRadius: 16, backgroundColor: 'transparent' },
  hint:         { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 16, textShadowColor: '#000', textShadowRadius: 4 },
  statusBox:    { position: 'absolute', bottom: 90, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
                  backgroundColor: 'rgba(0,0,0,0.7)', borderWidth: 1, borderColor: '#17B9A155',
                  paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  statusText:   { color: '#fff', fontSize: 13, fontWeight: '600' },
  closeBtn:     { position: 'absolute', top: 56, right: 20, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  closeBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
