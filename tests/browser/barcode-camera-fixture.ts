import type { Page } from "@playwright/test";

export async function installSimulatedBarcodeCamera(page: Page) {
  await page.addInitScript(() => {
    const scannerState = {
      appliedConstraints: [] as MediaTrackConstraints[],
      barcode: "034000470693",
      cameraStarts: 0,
      constraints: undefined as MediaStreamConstraints | undefined,
      emit: false,
      trackStops: 0,
    };
    const browserWindow = window as typeof window & {
      BarcodeDetector?: unknown;
      __scannerState: typeof scannerState;
    };
    browserWindow.__scannerState = scannerState;

    class SimulatedBarcodeDetector {
      static async getSupportedFormats() {
        return ["ean_8", "ean_13", "itf", "upc_a", "upc_e"];
      }

      async detect() {
        return scannerState.emit ? [{ rawValue: scannerState.barcode }] : [];
      }
    }
    Object.defineProperty(browserWindow, "BarcodeDetector", {
      configurable: true,
      value: SimulatedBarcodeDetector,
    });

    const track = {
      applyConstraints: async (constraints: MediaTrackConstraints) => {
        scannerState.appliedConstraints.push(constraints);
      },
      getCapabilities: () => ({
        focusMode: ["manual", "continuous"],
        torch: true,
        zoom: { max: 4, min: 1, step: 0.1 },
      }),
      getSettings: () => ({ zoom: 1 }),
      stop: () => { scannerState.trackStops += 1; },
    };
    const stream = new MediaStream();
    Object.defineProperty(stream, "getTracks", {
      value: () => [track],
    });
    Object.defineProperty(stream, "getVideoTracks", {
      value: () => [track],
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          scannerState.cameraStarts += 1;
          scannerState.constraints = constraints;
          return stream;
        },
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: async () => undefined,
    });
  });
}
