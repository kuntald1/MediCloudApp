// A minimal event bridge for passing a scanned barcode value back from the
// full-screen camera route (src/app/scan-camera.tsx) to whichever screen
// opened it. expo-router doesn't support passing live callbacks between
// routes, so this in-memory pub/sub fills that gap for a single scalar value.
//
// WHY THE PENDING BUFFER MATTERS
// ------------------------------
// The receiving screen subscribes on focus and unsubscribes on blur. But when
// it navigates to the camera it BLURS — so at the moment the camera actually
// decodes a barcode, there is no listener attached. A plain pub/sub drops that
// value on the floor: camera closes, nothing happens, no error.
//
// So emit() stores the code when nobody is listening, and subscribe() drains
// any pending code immediately on attach. That makes the handoff order-
// independent: it works whether the receiver is listening at emit time or only
// resubscribes afterwards.
type ScanListener = (code: string) => void;

let listener: ScanListener | null = null;
let pending: string | null = null;

export const scanBridge = {
  // Called by the screen that wants to receive the next scanned code.
  // Returns an unsubscribe function — call it on unmount / blur.
  subscribe(fn: ScanListener) {
    listener = fn;
    // Drain anything that arrived while nobody was listening.
    if (pending !== null) {
      const code = pending;
      pending = null;
      // Deliver on the next tick so the subscribing screen has finished
      // mounting//focusing before its handler runs.
      setTimeout(() => fn(code), 0);
    }
    return () => { if (listener === fn) listener = null; };
  },

  // Called by the camera screen once it has a decoded barcode.
  emit(code: string) {
    if (listener) {
      listener(code);
    } else {
      pending = code; // receiver is mid-navigation; it'll pick this up on focus
    }
  },

  // Clear any buffered code — call when opening the scanner so a stale value
  // from an abandoned scan can't fire on the next open.
  clear() {
    pending = null;
  },
};
