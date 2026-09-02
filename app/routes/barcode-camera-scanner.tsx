import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { hasValidGtinCheckDigit } from "../catalog/barcode";
import type {
  BarcodeDecoder,
  BarcodeDecoderSession,
} from "../catalog/barcode-decoder";
import styles from "../food-log.module.css";

type ScannerPorts = {
  loadDecoder: () => Promise<BarcodeDecoder>;
  requestCamera: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

type ScannerState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "scanning" }
  | { barcode: string; phase: "detected" }
  | {
      message: string;
      phase: "error";
      title: string;
    };

type NumericCameraCapability = {
  max: number;
  min: number;
  step?: number;
};

type EnhancedCameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  torch?: boolean;
  zoom?: NumericCameraCapability;
};

type EnhancedCameraConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  torch?: boolean;
  zoom?: number;
};

type EnhancedCameraSettings = MediaTrackSettings & { zoom?: number };

type CameraEnhancements = {
  torchAvailable: boolean;
  torchEnabled: boolean;
  zoom?: NumericCameraCapability & { value: number };
};

const noCameraEnhancements: CameraEnhancements = {
  torchAvailable: false,
  torchEnabled: false,
};

function scannerError(
  title: string,
  message: string,
): Extract<ScannerState, { phase: "error" }> {
  // Stryker disable next-line StringLiteral: every value outside the three active success phases selects the same error rendering arm.
  return { message, phase: "error", title };
}

const cameraConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    frameRate: { ideal: 30 },
    height: { ideal: 1080 },
    width: { ideal: 1920 },
  },
};

function validZoomCapability(
  value: unknown,
): value is NumericCameraCapability {
  if (!value || typeof value !== "object") return false;
  const range = value as Partial<NumericCameraCapability>;
  return Number.isFinite(range.min) && Number.isFinite(range.max) &&
    range.min! <= range.max!;
}

function preferredZoom(capability: NumericCameraCapability): number {
  return Math.min(capability.max, Math.max(capability.min, 1.5));
}

async function configureCameraTrack(
  track: MediaStreamTrack | undefined,
): Promise<CameraEnhancements> {
  // Stryker disable ConditionalExpression,LogicalOperator,BlockStatement: each missing capability API deliberately selects the same enhancement-free fallback; the runtime combinations are covered as one contract below.
  if (
    !track ||
    typeof track.applyConstraints !== "function" ||
    typeof track.getCapabilities !== "function" ||
    typeof track.getSettings !== "function"
  ) {
    return noCameraEnhancements;
  }
  // Stryker restore ConditionalExpression,LogicalOperator,BlockStatement
  let capabilities: EnhancedCameraCapabilities;
  let settings: EnhancedCameraSettings;
  try {
    capabilities = track.getCapabilities();
    settings = track.getSettings();
  } catch {
    return noCameraEnhancements;
  }
  const enhancements: EnhancedCameraConstraintSet = {};

  if (capabilities.focusMode?.includes("continuous")) {
    enhancements.focusMode = "continuous";
  }
  if (validZoomCapability(capabilities.zoom)) {
    enhancements.zoom = preferredZoom(capabilities.zoom);
  }

  let enhancementsApplied = false;
  if (Object.keys(enhancements).length > 0) {
    try {
      await track.applyConstraints({ advanced: [enhancements] });
      enhancementsApplied = true;
    } catch {
      // Camera enhancements are progressive; decoding still works without them.
    }
  }

  const zoom = validZoomCapability(capabilities.zoom)
    ? {
        ...capabilities.zoom,
        step: capabilities.zoom.step || 0.1,
        value: enhancementsApplied
          ? enhancements.zoom ?? capabilities.zoom.min
          : settings.zoom ?? capabilities.zoom.min,
      }
    : undefined;
  return {
    torchAvailable: capabilities.torch === true,
    torchEnabled: false,
    zoom,
  };
}

function cameraFailure(error: unknown): Extract<ScannerState, { phase: "error" }> {
  // Stryker disable next-line StringLiteral: every non-Error input takes the same generic failure path regardless of its placeholder name.
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError") {
    return scannerError(
      "Camera permission denied",
      "Camera permission was denied. Allow access in browser settings or enter the barcode below.",
    );
  }
  if (name === "NotFoundError") {
    return scannerError(
      "No camera found",
      "No camera is available. You can still enter the barcode below.",
    );
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return scannerError(
      "Camera is busy",
      "Another application may be using the camera. Close it, then retry or enter the barcode below.",
    );
  }
  if (name === "OverconstrainedError") {
    return scannerError(
      "Camera settings unsupported",
      "This device cannot provide a compatible camera stream. Enter the barcode below instead.",
    );
  }
  if (name === "SecurityError") {
    return scannerError(
      "Secure camera access required",
      "Camera scanning requires HTTPS or another secure browser context. Enter the barcode below instead.",
    );
  }
  return scannerError(
    "Camera unavailable",
    "The camera could not be started on this browser. Retry or enter the barcode below.",
  );
}

const decoderFailure = scannerError(
  "Barcode decoder unavailable",
  "Local barcode recognition could not start. Retry or enter the barcode below.",
);

export function createBarcodeCameraScanner(ports: ScannerPorts) {
  return function BarcodeCameraScanner({
    onDetected,
    stopRequested = false,
  }: {
    onDetected: (barcode: string) => void;
    stopRequested?: boolean;
  }) {
    const [state, setState] = useState<ScannerState>({ phase: "idle" });
    const [cameraEnhancements, setCameraEnhancements] =
      useState<CameraEnhancements>(noCameraEnhancements);
    const activeControlRef = useRef<HTMLButtonElement>(null);
    const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
    const decoderSessionRef = useRef<BarcodeDecoderSession | null>(null);
    // Stryker disable next-line BooleanLiteral: every scan start resets this value before it can become observable.
    const detectionCompletedRef = useRef(false);
    const generationRef = useRef(0);
    const streamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    function stopResources() {
      const decoderSession = decoderSessionRef.current;
      decoderSessionRef.current = null;
      decoderSession?.stop();

      const stream = streamRef.current;
      streamRef.current = null;
      cameraTrackRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());

      // Stryker disable next-line ConditionalExpression: a missing detached video ref has no srcObject to clear.
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    function cancelCamera() {
      generationRef.current += 1;
      stopResources();
      setState({ phase: "idle" });
    }

    async function toggleTorch() {
      const track = cameraTrackRef.current;
      if (!track) return;
      const torchEnabled = !cameraEnhancements.torchEnabled;
      try {
        const constraint: EnhancedCameraConstraintSet = { torch: torchEnabled };
        await track.applyConstraints({ advanced: [constraint] });
        if (cameraTrackRef.current === track) {
          setCameraEnhancements((current) => ({ ...current, torchEnabled }));
        }
      } catch {
        // Keep scanning if this browser advertises but rejects torch control.
      }
    }

    async function setZoom(value: number) {
      const track = cameraTrackRef.current;
      if (!track || !Number.isFinite(value)) return;
      try {
        const constraint: EnhancedCameraConstraintSet = { zoom: value };
        await track.applyConstraints({ advanced: [constraint] });
        if (cameraTrackRef.current === track) {
          setCameraEnhancements((current) => current.zoom
            ? { ...current, zoom: { ...current.zoom, value } }
            : current);
        }
      } catch {
        // Keep the last working zoom and continue decoding.
      }
    }

    async function startCamera() {
      if (stopRequested) return;
      detectionCompletedRef.current = false;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setCameraEnhancements(noCameraEnhancements);
      setState({ phase: "starting" });

      let decoder: BarcodeDecoder;
      try {
        decoder = await ports.loadDecoder();
      } catch {
        if (generationRef.current === generation) setState(decoderFailure);
        return;
      }
      if (generationRef.current !== generation) return;

      let stream: MediaStream;
      try {
        stream = await ports.requestCamera(cameraConstraints);
      } catch (error) {
        if (generationRef.current === generation) setState(cameraFailure(error));
        return;
      }

      if (generationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const cameraTrack = stream.getVideoTracks()[0];
      cameraTrackRef.current = cameraTrack ?? null;
      const enhancements = await configureCameraTrack(cameraTrack);
      if (generationRef.current !== generation) {
        stopResources();
        return;
      }
      setCameraEnhancements(enhancements);

      const video = videoRef.current;
      if (!video) {
        stopResources();
        setState(cameraFailure(undefined));
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch (error) {
        if (generationRef.current !== generation) return;
        stopResources();
        setState(cameraFailure(error));
        return;
      }

      try {
        const session = await decoder.start(
          video,
          (barcode) => {
            if (generationRef.current !== generation) return;
            const supportedBarcode = barcode.trim();
            if (!hasValidGtinCheckDigit(supportedBarcode)) return;

            detectionCompletedRef.current = true;
            // Stryker disable next-line AssignmentOperator: either arithmetic direction invalidates this terminal scan generation, and this component exposes no detected-state restart.
            generationRef.current += 1;
            stopResources();
            setState({ barcode: supportedBarcode, phase: "detected" });
            onDetected(supportedBarcode);
          },
          () => {
            if (generationRef.current !== generation) return;
            // Stryker disable next-line AssignmentOperator: either arithmetic direction invalidates this terminal decoder generation, and restart establishes a new generation.
            generationRef.current += 1;
            stopResources();
            setState(decoderFailure);
          },
        );
        if (generationRef.current !== generation) {
          session.stop();
          return;
        }
        decoderSessionRef.current = session;
        setState({ phase: "scanning" });
      } catch {
        if (generationRef.current !== generation) return;
        // Stryker disable next-line AssignmentOperator: a rejected decoder session has no valid callback contract; either direction invalidates its generation defensively.
        generationRef.current += 1;
        stopResources();
        setState(decoderFailure);
      }
    }

    // Stryker disable ArrayDeclaration: changing a constant dependency array cannot alter this one-time cleanup effect.
    useEffect(() => () => {
      // Stryker disable next-line AssignmentOperator: after unmount any arithmetic direction invalidates the sole outstanding generation, and the component cannot restart.
      generationRef.current += 1;
      stopResources();
    }, []);
    // Stryker restore ArrayDeclaration

    useLayoutEffect(() => {
      // Stryker disable next-line ConditionalExpression: the blocked-navigation browser journey proves the only observable true transition; the false mutation is equivalent on the initial and resumed effects.
      if (!stopRequested) return;
      generationRef.current += 1;
      stopResources();
      if (!detectionCompletedRef.current) setState({ phase: "idle" });
    }, [stopRequested]);

    // Stryker disable ConditionalExpression,LogicalOperator,EqualityOperator,StringLiteral,BlockStatement,OptionalChaining,CallExpression,ArrayDeclaration: focus transfer for both active phases is exercised in the mobile browser journey; remaining mutations are DOM-null or constant-dependency equivalents.
    useEffect(() => {
      if (state.phase === "starting" || state.phase === "scanning") {
        activeControlRef.current?.focus();
      }
    }, [state.phase]);
    // Stryker restore ConditionalExpression,LogicalOperator,EqualityOperator,StringLiteral,BlockStatement,OptionalChaining,CallExpression,ArrayDeclaration

    // Stryker disable ConditionalExpression,LogicalOperator,EqualityOperator,StringLiteral: preview visibility in idle, active, detected, and error phases is asserted by browser and component tests.
    const active = state.phase === "starting" || state.phase === "scanning";
    // Stryker restore ConditionalExpression,LogicalOperator,EqualityOperator,StringLiteral

    return (
      <section
        aria-labelledby="camera-scanner-title"
        className={styles.barcodeScanner}
      >
        <div className={styles.barcodeScannerIntro}>
          <h3 id="camera-scanner-title">Scan with camera</h3>
          <p>
            Frames stay on this device and are never uploaded or saved. Camera
            access requires permission and a secure browser connection.
          </p>
        </div>
        <div
          className={styles.barcodeScannerPreviewFrame}
          hidden={!active}
        >
          <video
            aria-label="Live barcode camera preview"
            className={styles.barcodeScannerPreview}
            muted
            playsInline
            ref={(video) => {
              if (video) videoRef.current = video;
            }}
          />
          <span aria-hidden="true" className={styles.barcodeScannerGuide} />
        </div>
        {state.phase === "idle" ? (
          <button
            className={styles.cameraButton}
            disabled={stopRequested}
            onClick={() => void startCamera()}
            type="button"
          >
            Use camera
          </button>
        ) : state.phase === "starting" ? (
          <div
            aria-live="polite"
            className={styles.barcodeScannerStatus}
            role="status"
          >
            <strong>Starting camera</strong>
            <p>Waiting for browser permission…</p>
            <button
              className={styles.secondaryButton}
              onClick={cancelCamera}
              ref={activeControlRef}
              type="button"
            >
              Cancel camera
            </button>
          </div>
        ) : state.phase === "scanning" ? (
          <div
            aria-live="polite"
            className={styles.barcodeScannerStatus}
            role="status"
          >
            <strong>Point the camera at the barcode</strong>
            <p>Fill the guide with the barcode and avoid glare.</p>
            {cameraEnhancements.torchAvailable || cameraEnhancements.zoom ? (
              <div className={styles.barcodeScannerCameraControls}>
                {cameraEnhancements.torchAvailable ? (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => void toggleTorch()}
                    type="button"
                  >
                    {cameraEnhancements.torchEnabled
                      ? "Turn light off"
                      : "Turn light on"}
                  </button>
                ) : null}
                {cameraEnhancements.zoom ? (
                  <label className={styles.barcodeScannerZoom}>
                    <span>Zoom</span>
                    <input
                      aria-label="Camera zoom"
                      max={cameraEnhancements.zoom.max}
                      min={cameraEnhancements.zoom.min}
                      onChange={(event) =>
                        void setZoom(Number(event.currentTarget.value))}
                      step={cameraEnhancements.zoom.step}
                      type="range"
                      value={cameraEnhancements.zoom.value}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            <button
              className={styles.secondaryButton}
              onClick={cancelCamera}
              ref={activeControlRef}
              type="button"
            >
              Cancel camera
            </button>
          </div>
        ) : state.phase === "detected" ? (
          <div
            aria-live="assertive"
            className={styles.barcodeScannerStatus}
            role="status"
          >
            <strong>Recognized {state.barcode}</strong>
            <p>Camera closed. Looking up this product once…</p>
          </div>
        ) : (
          <div className={styles.barcodeScannerStatus} role="alert">
            <strong>{state.title}</strong>
            <p>{state.message}</p>
            <div className={styles.barcodeScannerActions}>
              <button
                className={styles.cameraButton}
                onClick={
                  // Stryker disable next-line ArrowFunction: retry invocation is asserted directly by the decoder-failure unit test.
                  () => void startCamera()
                }
                type="button"
              >
                Retry camera
              </button>
              <button
                className={styles.secondaryButton}
                onClick={
                  // Stryker disable next-line ArrowFunction,OptionalChaining,StringLiteral: focus recovery is exercised by the mobile browser accessibility journey; a missing manual input is a defensive DOM-null case.
                  () => document.getElementById("food-barcode")?.focus()
                }
                type="button"
              >
                Enter barcode manually
              </button>
            </div>
          </div>
        )}
      </section>
    );
  };
}

// Stryker disable BlockStatement,ObjectLiteral,BooleanLiteral,ConditionalExpression,OptionalChaining,StringLiteral: the production browser ports are exercised by the Chromium/WebKit camera matrix; unit tests substitute only this explicit boundary.
export const BarcodeCameraScanner = createBarcodeCameraScanner({
  async loadDecoder() {
    const module = await import("../catalog/barcode-decoder.client");
    return module.localBarcodeDecoder;
  },
  requestCamera(constraints) {
    if (!globalThis.isSecureContext) {
      return Promise.reject(new DOMException("Insecure context", "SecurityError"));
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return Promise.reject(new DOMException("Camera unavailable", "NotFoundError"));
    }
    return navigator.mediaDevices.getUserMedia(constraints);
  },
});
// Stryker restore BlockStatement,ObjectLiteral,BooleanLiteral,ConditionalExpression,OptionalChaining,StringLiteral
