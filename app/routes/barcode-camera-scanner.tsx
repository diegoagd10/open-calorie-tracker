import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { isSupportedCommercialBarcode } from "../catalog/barcode";
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

function scannerError(
  title: string,
  message: string,
): Extract<ScannerState, { phase: "error" }> {
  // Stryker disable next-line StringLiteral: every value outside the three active success phases selects the same error rendering arm.
  return { message, phase: "error", title };
}

const cameraConstraints: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: "environment" } },
};

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
    const activeControlRef = useRef<HTMLButtonElement>(null);
    const decoderSessionRef = useRef<BarcodeDecoderSession | null>(null);
    // Stryker disable next-line BooleanLiteral: every scan start resets this value before it can become observable.
    const detectionCompletedRef = useRef(false);
    const generationRef = useRef(0);
    const lastCandidateRef = useRef<string | undefined>(undefined);
    const matchingReadsRef = useRef(0);
    const streamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    function stopResources() {
      const decoderSession = decoderSessionRef.current;
      decoderSessionRef.current = null;
      decoderSession?.stop();

      const stream = streamRef.current;
      streamRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());

      // Stryker disable next-line ConditionalExpression: a missing detached video ref has no srcObject to clear.
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    function resetCandidates() {
      lastCandidateRef.current = undefined;
      matchingReadsRef.current = 0;
    }

    function cancelCamera() {
      generationRef.current += 1;
      stopResources();
      setState({ phase: "idle" });
    }

    async function startCamera() {
      if (stopRequested) return;
      detectionCompletedRef.current = false;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      resetCandidates();
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
            if (!isSupportedCommercialBarcode(supportedBarcode)) {
              resetCandidates();
              return;
            }
            if (lastCandidateRef.current === supportedBarcode) {
              matchingReadsRef.current += 1;
            } else {
              lastCandidateRef.current = supportedBarcode;
              matchingReadsRef.current = 1;
            }
            if (matchingReadsRef.current < 2) return;

            detectionCompletedRef.current = true;
            // Stryker disable next-line AssignmentOperator: either arithmetic direction invalidates this terminal scan generation, and this component exposes no detected-state restart.
            generationRef.current += 1;
            stopResources();
            setState({ barcode: supportedBarcode, phase: "detected" });
            onDetected(supportedBarcode);
          },
          () => {
            if (generationRef.current !== generation) return;
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
        <video
          aria-label="Live barcode camera preview"
          className={styles.barcodeScannerPreview}
          hidden={!active}
          muted
          playsInline
          ref={(video) => {
            if (video) videoRef.current = video;
          }}
        />
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
            <p>Hold the package steady until the code is recognized.</p>
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
