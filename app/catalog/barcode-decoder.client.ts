import {
  BarcodeFormat,
  BrowserMultiFormatReader,
} from "@zxing/browser";
import {
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException,
} from "@zxing/library";

import { isSupportedCommercialBarcode } from "./barcode";
import type {
  BarcodeDecoder,
  BarcodeDecoderSession,
} from "./barcode-decoder";

const browserBarcodeFormats = [
  "ean_8",
  "ean_13",
  "itf",
  "upc_a",
  "upc_e",
] as const;

type DetectedBarcode = { rawValue: string };

type NativeBarcodeDetector = {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
};

type NativeBarcodeDetectorConstructor = {
  getSupportedFormats(): Promise<string[]>;
  new (options: { formats: readonly string[] }): NativeBarcodeDetector;
};

function nativeBarcodeDetector(): NativeBarcodeDetectorConstructor | undefined {
  return (
    globalThis as typeof globalThis & {
      BarcodeDetector?: NativeBarcodeDetectorConstructor;
    }
  ).BarcodeDetector;
}

async function startNativeDecoder(
  Detector: NativeBarcodeDetectorConstructor,
  video: HTMLVideoElement,
  onCandidate: (barcode: string) => void,
  onTerminalError: (error: unknown) => void,
): Promise<BarcodeDecoderSession | undefined> {
  const supportedFormats = await Detector.getSupportedFormats();
  if (!browserBarcodeFormats.every((format) => supportedFormats.includes(format))) {
    return undefined;
  }

  const detector = new Detector({ formats: browserBarcodeFormats });
  let active = true;
  let frame = 0;
  const detect = async () => {
    if (!active) return;
    try {
      const detections = await detector.detect(video);
      for (const detection of detections) {
        const barcode = detection.rawValue.trim();
        if (isSupportedCommercialBarcode(barcode)) onCandidate(barcode);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "InvalidStateError") {
        frame = requestAnimationFrame(() => void detect());
        return;
      }
      onTerminalError(error);
      return;
    }
    frame = requestAnimationFrame(() => void detect());
  };
  frame = requestAnimationFrame(() => void detect());

  return {
    stop() {
      active = false;
      cancelAnimationFrame(frame);
    },
  };
}

function startZxingDecoder(
  video: HTMLVideoElement,
  onCandidate: (barcode: string) => void,
  onTerminalError: (error: unknown) => void,
): BarcodeDecoderSession {
  const hints = new Map<DecodeHintType, BarcodeFormat[]>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_8,
    BarcodeFormat.EAN_13,
    BarcodeFormat.ITF,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ]);
  const reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 100,
    delayBetweenScanSuccess: 100,
  });
  return reader.scan(video, (result, error) => {
    if (result) {
      const barcode = result.getText().trim();
      if (isSupportedCommercialBarcode(barcode)) onCandidate(barcode);
      return;
    }
    if (
      error &&
      !(error instanceof NotFoundException) &&
      !(error instanceof ChecksumException) &&
      !(error instanceof FormatException)
    ) {
      onTerminalError(error);
    }
  });
}

export const localBarcodeDecoder: BarcodeDecoder = {
  async start(video, onCandidate, onTerminalError) {
    const Detector = nativeBarcodeDetector();
    if (Detector) {
      const nativeSession = await startNativeDecoder(
        Detector,
        video,
        onCandidate,
        onTerminalError,
      );
      if (nativeSession) return nativeSession;
    }
    return startZxingDecoder(video, onCandidate, onTerminalError);
  },
};
