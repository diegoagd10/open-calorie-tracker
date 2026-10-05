import {
  BarcodeFormat,
  type BrowserMultiFormatReader,
} from "@zxing/browser";
import {
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException,
} from "@zxing/library";
import { afterEach, expect, test, vi } from "vitest";

const zxingHarness = vi.hoisted(() => ({
  callback: undefined as DecodeContinuouslyCallback | undefined,
  hints: undefined as Map<DecodeHintType, BarcodeFormat[]> | undefined,
  options: undefined as Record<string, number> | undefined,
  sessionStop: vi.fn(),
}));

vi.mock("@zxing/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zxing/browser")>();
  return {
    ...actual,
    BrowserMultiFormatReader: class BrowserMultiFormatReaderDouble {
      constructor(
        hints: Map<DecodeHintType, BarcodeFormat[]>,
        options: Record<string, number>,
      ) {
        zxingHarness.hints = hints;
        zxingHarness.options = options;
      }

      scan(_video: HTMLVideoElement, callback: DecodeContinuouslyCallback) {
        zxingHarness.callback = callback;
        return { stop: zxingHarness.sessionStop };
      }
    },
  };
});

import { localBarcodeDecoder } from "../app/barcode/barcode-decoder.client";

type DecodeContinuouslyCallback = Parameters<
  BrowserMultiFormatReader["scan"]
>[1];

const originalBarcodeDetector = Object.getOwnPropertyDescriptor(
  globalThis,
  "BarcodeDetector",
);
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

function restoreGlobal(name: string, descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}

afterEach(() => {
  restoreGlobal("BarcodeDetector", originalBarcodeDetector);
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  zxingHarness.callback = undefined;
  zxingHarness.hints = undefined;
  zxingHarness.options = undefined;
  zxingHarness.sessionStop.mockReset();
});

test("the local decoder requests the complete commercial format set and emits only manual-valid values", async () => {
  let requestedFormats: readonly string[] = [];
  const detect = vi.fn(async () => [
    { rawValue: "frame:data:image/png" },
    { rawValue: " 034000470693 " },
  ]);
  class BarcodeDetectorDouble {
    static async getSupportedFormats() {
      return ["ean_8", "ean_13", "itf", "upc_a", "upc_e"];
    }

    constructor(options: { formats: readonly string[] }) {
      requestedFormats = options.formats;
    }

    detect = detect;
  }
  Object.defineProperty(globalThis, "BarcodeDetector", {
    configurable: true,
    value: BarcodeDetectorDouble,
  });
  const frames: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  globalThis.cancelAnimationFrame = vi.fn();
  const candidates: string[] = [];
  const terminalErrors: unknown[] = [];

  const session = await localBarcodeDecoder.start(
    {} as HTMLVideoElement,
    (barcode) => candidates.push(barcode),
    (error) => terminalErrors.push(error),
  );
  expect(requestedFormats).toEqual([
    "ean_8",
    "ean_13",
    "itf",
    "upc_a",
    "upc_e",
  ]);
  expect(candidates).toEqual([]);

  frames.shift()!(0);
  await vi.waitFor(() => expect(candidates).toEqual(["034000470693"]));
  expect(terminalErrors).toEqual([]);

  frames.shift()!(1);
  await vi.waitFor(() => expect(candidates).toEqual([
    "034000470693",
    "034000470693",
  ]));

  session.stop();
  expect(globalThis.cancelAnimationFrame).toHaveBeenCalledOnce();
  const detectCalls = detect.mock.calls.length;
  frames.shift()?.(1);
  expect(detect).toHaveBeenCalledTimes(detectCalls);
});

test("the bundled decoder receives every format and ignores ordinary misses", async () => {
  Reflect.deleteProperty(globalThis, "BarcodeDetector");
  const candidates: string[] = [];
  const terminalErrors: unknown[] = [];

  const session = await localBarcodeDecoder.start(
    {} as HTMLVideoElement,
    (barcode) => candidates.push(barcode),
    (error) => terminalErrors.push(error),
  );

  expect(zxingHarness.hints?.get(DecodeHintType.POSSIBLE_FORMATS)).toEqual([
    BarcodeFormat.EAN_8,
    BarcodeFormat.EAN_13,
    BarcodeFormat.ITF,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ]);
  expect(zxingHarness.options).toEqual({
    delayBetweenScanAttempts: 100,
    delayBetweenScanSuccess: 100,
  });
  const controls = {} as never;
  zxingHarness.callback?.(undefined, new NotFoundException(), controls);
  zxingHarness.callback?.(undefined, new ChecksumException(), controls);
  zxingHarness.callback?.(undefined, new FormatException(), controls);
  expect(candidates).toEqual([]);
  expect(terminalErrors).toEqual([]);
  session.stop();
  expect(zxingHarness.sessionStop).toHaveBeenCalledOnce();
});

test("the bundled decoder emits valid results and reports unexpected failures", async () => {
  Reflect.deleteProperty(globalThis, "BarcodeDetector");
  const candidates: string[] = [];
  const terminalErrors: unknown[] = [];

  await localBarcodeDecoder.start(
    {} as HTMLVideoElement,
    (barcode) => candidates.push(barcode),
    (error) => terminalErrors.push(error),
  );

  const controls = {} as never;
  zxingHarness.callback?.({
    getText: () => "not-a-barcode",
  } as never, undefined, controls);
  zxingHarness.callback?.({
    getText: () => " 034000470693 ",
  } as never, undefined, controls);
  const frameFailure = new Error("canvas failed");
  zxingHarness.callback?.(undefined, frameFailure as never, controls);

  expect(candidates).toEqual(["034000470693"]);
  expect(terminalErrors).toEqual([frameFailure]);
});

test("an incomplete native detector falls back without constructing it", async () => {
  const constructed = vi.fn();
  class PartialBarcodeDetectorDouble {
    static async getSupportedFormats() {
      return ["ean_13"];
    }

    constructor() {
      constructed();
    }
  }
  Object.defineProperty(globalThis, "BarcodeDetector", {
    configurable: true,
    value: PartialBarcodeDetectorDouble,
  });

  await localBarcodeDecoder.start(
    {} as HTMLVideoElement,
    () => undefined,
    () => undefined,
  );

  expect(constructed).not.toHaveBeenCalled();
  expect(zxingHarness.callback).toBeTypeOf("function");
});

test("native transient and terminal errors have distinct frame behavior", async () => {
  const transient = new Error("not ready");
  transient.name = "InvalidStateError";
  const terminal = new Error("detector failed");
  const detect = vi.fn()
    .mockRejectedValueOnce(transient)
    .mockRejectedValueOnce(terminal);
  class BarcodeDetectorDouble {
    static async getSupportedFormats() {
      return ["ean_8", "ean_13", "itf", "upc_a", "upc_e"];
    }

    detect = detect;
  }
  Object.defineProperty(globalThis, "BarcodeDetector", {
    configurable: true,
    value: BarcodeDetectorDouble,
  });
  const frames: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const terminalErrors: unknown[] = [];

  await localBarcodeDecoder.start(
    {} as HTMLVideoElement,
    () => undefined,
    (error) => terminalErrors.push(error),
  );
  frames.shift()!(0);
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  expect(terminalErrors).toEqual([]);
  frames.shift()!(1);
  await vi.waitFor(() => expect(terminalErrors).toEqual([terminal]));
  expect(frames).toHaveLength(0);
});
