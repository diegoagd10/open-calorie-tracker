/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- react-test-renderer host props are untyped */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test, vi } from "vitest";

import {
  createBarcodeCameraScanner,
} from "../../app/routes/barcode-camera-scanner";
import type { BarcodeDecoder } from "../../app/barcode";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class VideoElementDouble {
  srcObject: MediaStream | null = null;
  play = vi.fn(async () => undefined);
}

class TrackDouble {
  constructor(
    private readonly capabilities: Record<string, unknown> = {},
    private readonly settings: Record<string, unknown> = {},
  ) {}

  applyConstraints = vi.fn(async () => undefined);
  getCapabilities = vi.fn(() => this.capabilities);
  getSettings = vi.fn(() => this.settings);
  stop = vi.fn();
}

function text(node: ReactTestRenderer["root"]): string {
  return node.children
    .map((child) => typeof child === "string" ? child : text(child))
    .join("");
}

function button(renderer: ReactTestRenderer, name: string) {
  return renderer.root.findAllByType("button").find(
    (candidate) => text(candidate) === name,
  )!;
}

function scannerHarness(options?: {
  decoderFailure?: Error;
  mediaFailure?: Error;
  trackCapabilities?: Record<string, unknown>;
  trackSettings?: Record<string, unknown>;
  withoutVideo?: boolean;
}) {
  const video = new VideoElementDouble();
  const track = new TrackDouble(
    options?.trackCapabilities,
    options?.trackSettings,
  );
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  let reportCandidate: ((barcode: string) => void) | undefined;
  let reportTerminalError: ((error: unknown) => void) | undefined;
  const stopDecoder = vi.fn();
  const decoder: BarcodeDecoder = {
    start: vi.fn(async (
      _video: HTMLVideoElement,
      onCandidate: (barcode: string) => void,
      onTerminalError: (error: unknown) => void,
    ) => {
      reportCandidate = onCandidate;
      reportTerminalError = onTerminalError;
      return { stop: stopDecoder };
    }),
  };
  const requestCamera = vi.fn(async () => {
    if (options?.mediaFailure) throw options.mediaFailure;
    return stream;
  });
  const loadDecoder = vi.fn(async () => {
    if (options?.decoderFailure) throw options.decoderFailure;
    return decoder;
  });
  const onDetected = vi.fn();
  const Scanner = createBarcodeCameraScanner({ loadDecoder, requestCamera });
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(Scanner, { onDetected }), {
      createNodeMock: (element) =>
        element.type === "video"
          ? options?.withoutVideo ? null : video
          : { focus: vi.fn() },
    });
  });
  return {
    Scanner,
    decoder,
    loadDecoder,
    onDetected,
    renderer: renderer!,
    reportCandidate: () => reportCandidate!,
    reportTerminalError: () => reportTerminalError!,
    requestCamera,
    stream,
    stopDecoder,
    track,
    video,
  };
}

test("camera access starts only after the explicit action and never requests audio", async () => {
  const harness = scannerHarness();

  expect(harness.requestCamera).not.toHaveBeenCalled();
  expect(text(harness.renderer.root)).toContain("Use camera");

  await act(async () => button(harness.renderer, "Use camera").props.onClick());

  expect(harness.requestCamera).toHaveBeenCalledWith({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      frameRate: { ideal: 30 },
      height: { ideal: 1080 },
      width: { ideal: 1920 },
    },
  });
  expect(harness.video.srcObject).toBeTruthy();
  expect(harness.video.play).toHaveBeenCalledOnce();
  expect(harness.decoder.start).toHaveBeenCalledOnce();
  expect(text(harness.renderer.root)).toContain("Point the camera at the barcode");
  await act(async () => harness.renderer.unmount());
});

test("one checksum-valid local read delivers a barcode and stops every resource", async () => {
  const harness = scannerHarness();
  await act(async () => button(harness.renderer, "Use camera").props.onClick());

  const reportCandidate = harness.reportCandidate();
  const reportTerminalError = harness.reportTerminalError();
  await act(async () => reportCandidate("not-a-barcode"));
  await act(async () => reportCandidate("not-a-barcode"));
  expect(harness.onDetected).not.toHaveBeenCalled();
  await act(async () => reportCandidate("0000000000004"));
  await act(async () => reportCandidate("0000000000004"));
  expect(harness.onDetected).not.toHaveBeenCalled();

  await act(async () => reportCandidate(" 034000470693 "));

  expect(harness.onDetected).toHaveBeenCalledOnce();
  expect(harness.onDetected).toHaveBeenCalledWith("034000470693");
  expect(harness.stopDecoder).toHaveBeenCalledOnce();
  expect(harness.track.stop).toHaveBeenCalledOnce();
  expect(harness.video.srcObject).toBeNull();
  expect(text(harness.renderer.root)).toContain("Recognized 034000470693");
  await act(async () => reportCandidate("034000470693"));
  await act(async () => reportTerminalError(new Error("late decoder error")));
  expect(harness.onDetected).toHaveBeenCalledOnce();
  expect(text(harness.renderer.root)).toContain("Recognized 034000470693");
  act(() => {
    harness.renderer.update(createElement(harness.Scanner, {
      onDetected: harness.onDetected,
      stopRequested: true,
    }));
  });
  expect(text(harness.renderer.root)).toContain("Recognized 034000470693");
  await act(async () => harness.renderer.unmount());
});

test("supported cameras receive continuous focus, automatic zoom, and torch control", async () => {
  const harness = scannerHarness({
    trackCapabilities: {
      focusMode: ["manual", "continuous"],
      torch: true,
      zoom: { max: 4, min: 1, step: 0.25 },
    },
    trackSettings: { zoom: 1 },
  });

  await act(async () => button(harness.renderer, "Use camera").props.onClick());

  expect(harness.track.applyConstraints).toHaveBeenCalledWith({
    advanced: [{ focusMode: "continuous", zoom: 1.5 }],
  });
  expect(button(harness.renderer, "Turn light on")).toBeTruthy();
  expect(harness.renderer.root.findAllByProps({
    "aria-label": "Camera zoom",
  })).toHaveLength(0);

  await act(async () => button(harness.renderer, "Turn light on").props.onClick());
  expect(harness.track.applyConstraints).toHaveBeenLastCalledWith({
    advanced: [{ torch: true }],
  });
  expect(button(harness.renderer, "Turn light off")).toBeTruthy();
  await act(async () => harness.renderer.unmount());
});

test("preferred zoom is clamped to each camera's advertised range", async () => {
  const lowMaximum = scannerHarness({
    trackCapabilities: { zoom: { max: 1.25, min: 1 } },
  });
  await act(async () => button(
    lowMaximum.renderer,
    "Use camera",
  ).props.onClick());
  expect(lowMaximum.track.applyConstraints).toHaveBeenCalledWith({
    advanced: [{ zoom: 1.25 }],
  });
  await act(async () => lowMaximum.renderer.unmount());

  const highMinimum = scannerHarness({
    trackCapabilities: { zoom: { max: 4, min: 2 } },
  });
  await act(async () => button(
    highMinimum.renderer,
    "Use camera",
  ).props.onClick());
  expect(highMinimum.track.applyConstraints).toHaveBeenCalledWith({
    advanced: [{ zoom: 2 }],
  });
  await act(async () => highMinimum.renderer.unmount());

  const fixedZoom = scannerHarness({
    trackCapabilities: { zoom: { max: 2, min: 2 } },
  });
  await act(async () => button(fixedZoom.renderer, "Use camera").props.onClick());
  expect(fixedZoom.track.applyConstraints).toHaveBeenCalledWith({
    advanced: [{ zoom: 2 }],
  });
  await act(async () => fixedZoom.renderer.unmount());
});

test.each([
  null,
  "1-4",
  {},
  { max: 4 },
  { min: 1 },
  { max: Number.POSITIVE_INFINITY, min: 1 },
  { max: 4, min: Number.NaN },
  { max: 1, min: 2 },
])("invalid zoom capability %j is ignored", async (zoom) => {
  const harness = scannerHarness({
    trackCapabilities: { torch: "true", zoom },
  });
  await act(async () => button(harness.renderer, "Use camera").props.onClick());

  expect(harness.track.applyConstraints).not.toHaveBeenCalled();
  expect(harness.renderer.root.findAllByProps({
    "aria-label": "Camera zoom",
  })).toHaveLength(0);
  expect(text(harness.renderer.root)).not.toContain("Turn light on");
  await act(async () => harness.renderer.unmount());
});

test("camera capability APIs can be absent or throw without blocking scanning", async () => {
  for (const method of [
    "applyConstraints",
    "getCapabilities",
  ] as const) {
    const harness = scannerHarness();
    Object.defineProperty(harness.track, method, { value: undefined });
    await act(async () => button(harness.renderer, "Use camera").props.onClick());
    expect(harness.decoder.start).toHaveBeenCalledOnce();
    expect(text(harness.renderer.root)).toContain(
      "Point the camera at the barcode",
    );
    await act(async () => harness.renderer.unmount());
  }

  const throwing = scannerHarness();
  throwing.track.getCapabilities.mockImplementation(() => {
    throw new Error("capabilities unavailable");
  });
  await act(async () => button(throwing.renderer, "Use camera").props.onClick());
  expect(throwing.decoder.start).toHaveBeenCalledOnce();
  expect(throwing.track.applyConstraints).not.toHaveBeenCalled();
  await act(async () => throwing.renderer.unmount());
});

test("unsupported or rejected camera enhancements do not prevent scanning", async () => {
  const unsupported = scannerHarness();
  await act(async () => button(unsupported.renderer, "Use camera").props.onClick());
  expect(unsupported.track.applyConstraints).not.toHaveBeenCalled();
  expect(text(unsupported.renderer.root)).not.toContain("Turn light on");
  expect(unsupported.renderer.root.findAllByProps({
    "aria-label": "Camera zoom",
  })).toHaveLength(0);
  expect(unsupported.renderer.root.findAll((node) =>
    typeof node.props.className === "string" &&
    node.props.className.includes("barcodeScannerCameraControls")
  )).toHaveLength(0);
  await act(async () => unsupported.renderer.unmount());

  const rejected = scannerHarness({
    trackCapabilities: {
      focusMode: ["continuous"],
      zoom: { max: 3, min: 1, step: 0.25 },
    },
  });
  rejected.track.applyConstraints.mockRejectedValueOnce(
    new DOMException("unsupported", "OverconstrainedError"),
  );
  await act(async () => button(rejected.renderer, "Use camera").props.onClick());
  expect(text(rejected.renderer.root)).toContain("Point the camera at the barcode");
  expect(rejected.decoder.start).toHaveBeenCalledOnce();
  expect(rejected.renderer.root.findAllByProps({
    "aria-label": "Camera zoom",
  })).toHaveLength(0);
  await act(async () => rejected.renderer.unmount());
});

test("cancellation during camera configuration closes the stream before decoding", async () => {
  const harness = scannerHarness({
    trackCapabilities: { zoom: { max: 4, min: 1 } },
  });
  let releaseEnhancements!: () => void;
  harness.track.applyConstraints.mockImplementationOnce(() => new Promise((resolve) => {
    releaseEnhancements = () => resolve(undefined);
  }));

  await act(async () => {
    void button(harness.renderer, "Use camera").props.onClick();
    await Promise.resolve();
  });
  await act(async () => button(harness.renderer, "Cancel camera").props.onClick());
  await act(async () => releaseEnhancements());

  expect(harness.track.stop).toHaveBeenCalledOnce();
  expect(harness.decoder.start).not.toHaveBeenCalled();
  expect(text(harness.renderer.root)).toContain("Use camera");
  await act(async () => harness.renderer.unmount());
});

test("a rejected torch change retains the last working control", async () => {
  const harness = scannerHarness({
    trackCapabilities: {
      torch: true,
      zoom: { max: 4, min: 1, step: 0.25 },
    },
  });
  await act(async () => button(harness.renderer, "Use camera").props.onClick());
  harness.track.applyConstraints.mockRejectedValue(
    new DOMException("rejected", "OverconstrainedError"),
  );

  await act(async () => button(harness.renderer, "Turn light on").props.onClick());
  expect(button(harness.renderer, "Turn light on")).toBeTruthy();
  await act(async () => harness.renderer.unmount());
});

test("camera controls cannot update state after cancellation", async () => {
  const harness = scannerHarness({
    trackCapabilities: {
      torch: true,
      zoom: { max: 4, min: 1, step: 0.25 },
    },
  });
  await act(async () => button(harness.renderer, "Use camera").props.onClick());
  const torchClick = button(harness.renderer, "Turn light on").props.onClick;
  await act(async () => button(harness.renderer, "Cancel camera").props.onClick());

  const calls = harness.track.applyConstraints.mock.calls.length;
  await act(async () => torchClick());
  expect(harness.track.applyConstraints).toHaveBeenCalledTimes(calls);
  expect(text(harness.renderer.root)).toContain("Use camera");
  await act(async () => harness.renderer.unmount());
});

test("cancel while startup is pending never opens the camera later", async () => {
  const harness = scannerHarness();
  let releaseDecoder!: (decoder: BarcodeDecoder) => void;
  harness.loadDecoder.mockImplementation(() => new Promise((resolve) => {
    releaseDecoder = resolve;
  }));

  await act(async () => button(harness.renderer, "Use camera").props.onClick());
  await act(async () => button(harness.renderer, "Cancel camera").props.onClick());
  await act(async () => releaseDecoder(harness.decoder));

  expect(harness.requestCamera).not.toHaveBeenCalled();
  expect(text(harness.renderer.root)).toContain("Use camera");
  await act(async () => harness.renderer.unmount());
});

test("a camera stream that arrives after cancellation is stopped without starting detection", async () => {
  const harness = scannerHarness();
  let releaseCamera!: (stream: MediaStream) => void;
  harness.requestCamera.mockImplementation(() => new Promise((resolve) => {
    releaseCamera = resolve;
  }));

  await act(async () => {
    void button(harness.renderer, "Use camera").props.onClick();
    await Promise.resolve();
  });
  await act(async () => button(harness.renderer, "Cancel camera").props.onClick());
  await act(async () => releaseCamera(harness.stream));

  expect(harness.track.stop).toHaveBeenCalledOnce();
  expect(harness.decoder.start).not.toHaveBeenCalled();
  expect(text(harness.renderer.root)).toContain("Use camera");
  await act(async () => harness.renderer.unmount());
});

test("late startup failures and decoder sessions cannot replace a cancelled state", async () => {
  const decoderLoad = scannerHarness();
  let rejectDecoder!: (error: Error) => void;
  decoderLoad.loadDecoder.mockImplementation(() => new Promise((_resolve, reject) => {
    rejectDecoder = reject;
  }));
  await act(async () => {
    void button(decoderLoad.renderer, "Use camera").props.onClick();
    await Promise.resolve();
  });
  await act(async () => button(
    decoderLoad.renderer,
    "Cancel camera",
  ).props.onClick());
  await act(async () => rejectDecoder(new Error("late decoder load")));
  expect(text(decoderLoad.renderer.root)).toContain("Use camera");
  expect(text(decoderLoad.renderer.root)).not.toContain(
    "Barcode decoder unavailable",
  );
  await act(async () => decoderLoad.renderer.unmount());

  const cameraLoad = scannerHarness();
  let rejectCamera!: (error: Error) => void;
  cameraLoad.requestCamera.mockImplementation(() => new Promise((_resolve, reject) => {
    rejectCamera = reject;
  }));
  await act(async () => {
    void button(cameraLoad.renderer, "Use camera").props.onClick();
    await Promise.resolve();
  });
  await act(async () => button(
    cameraLoad.renderer,
    "Cancel camera",
  ).props.onClick());
  const denied = new Error("late permission rejection");
  denied.name = "NotAllowedError";
  await act(async () => rejectCamera(denied));
  expect(text(cameraLoad.renderer.root)).toContain("Use camera");
  expect(text(cameraLoad.renderer.root)).not.toContain(
    "Camera permission denied",
  );
  await act(async () => cameraLoad.renderer.unmount());

  const decoderStart = scannerHarness();
  let releaseSession!: (session: { stop(): void }) => void;
  decoderStart.decoder.start = vi.fn(() => new Promise<{ stop(): void }>((resolve) => {
    releaseSession = resolve;
  }));
  await act(async () => {
    void button(decoderStart.renderer, "Use camera").props.onClick();
    await Promise.resolve();
  });
  await act(async () => button(
    decoderStart.renderer,
    "Cancel camera",
  ).props.onClick());
  const lateStop = vi.fn();
  await act(async () => releaseSession({ stop: lateStop }));
  expect(lateStop).toHaveBeenCalledOnce();
  expect(text(decoderStart.renderer.root)).toContain("Use camera");
  await act(async () => decoderStart.renderer.unmount());

  const rejectedStart = scannerHarness();
  let rejectSession!: (error: Error) => void;
  rejectedStart.decoder.start = vi.fn(() => new Promise<{ stop(): void }>((
    _resolve,
    reject,
  ) => {
    rejectSession = reject;
  }));
  await act(async () => {
    void button(rejectedStart.renderer, "Use camera").props.onClick();
    await Promise.resolve();
  });
  await act(async () => button(
    rejectedStart.renderer,
    "Cancel camera",
  ).props.onClick());
  await act(async () => rejectSession(new Error("late session rejection")));
  expect(text(rejectedStart.renderer.root)).toContain("Use camera");
  expect(text(rejectedStart.renderer.root)).not.toContain(
    "Barcode decoder unavailable",
  );
  await act(async () => rejectedStart.renderer.unmount());
});

test("callbacks from a cancelled generation cannot affect a restarted scan", async () => {
  const harness = scannerHarness();
  await act(async () => button(harness.renderer, "Use camera").props.onClick());
  const staleCandidate = harness.reportCandidate();
  const staleTerminalError = harness.reportTerminalError();
  await act(async () => button(harness.renderer, "Cancel camera").props.onClick());
  await act(async () => button(harness.renderer, "Use camera").props.onClick());
  const currentCandidate = harness.reportCandidate();

  await act(async () => staleCandidate("0000000000004"));
  await act(async () => staleCandidate("034000470693"));
  await act(async () => staleTerminalError(new Error("stale")));
  expect(harness.onDetected).not.toHaveBeenCalled();
  expect(text(harness.renderer.root)).toContain("Point the camera at the barcode");

  await act(async () => currentCandidate("034000470693"));
  await act(async () => currentCandidate("034000470693"));
  expect(harness.onDetected).toHaveBeenCalledOnce();
  await act(async () => harness.renderer.unmount());
});

test("a preview rejection after cancellation cannot replace the idle state", async () => {
  const harness = scannerHarness();
  let rejectPlayback!: (error: Error) => void;
  harness.video.play.mockImplementation(() => new Promise((_resolve, reject) => {
    rejectPlayback = reject;
  }));
  await act(async () => {
    void button(harness.renderer, "Use camera").props.onClick();
    await Promise.resolve();
  });
  await act(async () => button(harness.renderer, "Cancel camera").props.onClick());
  await act(async () => rejectPlayback(new Error("late playback error")));

  expect(text(harness.renderer.root)).toContain("Use camera");
  expect(text(harness.renderer.root)).not.toContain("Camera unavailable");
  expect(harness.decoder.start).not.toHaveBeenCalled();
  await act(async () => harness.renderer.unmount());
});

test("cancel and unmount close decoder, camera tracks, and the attached preview", async () => {
  const cancelled = scannerHarness();
  await act(async () => button(cancelled.renderer, "Use camera").props.onClick());
  await act(async () => button(cancelled.renderer, "Cancel camera").props.onClick());
  expect(cancelled.stopDecoder).toHaveBeenCalledOnce();
  expect(cancelled.track.stop).toHaveBeenCalledOnce();
  expect(cancelled.video.srcObject).toBeNull();
  expect(text(cancelled.renderer.root)).toContain("Use camera");
  await act(async () => cancelled.renderer.unmount());

  const unmounted = scannerHarness();
  await act(async () => button(unmounted.renderer, "Use camera").props.onClick());
  await act(async () => unmounted.renderer.unmount());
  expect(unmounted.stopDecoder).toHaveBeenCalledOnce();
  expect(unmounted.track.stop).toHaveBeenCalledOnce();
  expect(unmounted.video.srcObject).toBeNull();
});

test("a pending navigation invalidates detection and closes every resource", async () => {
  const harness = scannerHarness();
  await act(async () => button(harness.renderer, "Use camera").props.onClick());
  const staleCandidate = harness.reportCandidate();

  act(() => {
    harness.renderer.update(createElement(harness.Scanner, {
      onDetected: harness.onDetected,
      stopRequested: true,
    }));
  });

  expect(harness.stopDecoder).toHaveBeenCalledOnce();
  expect(harness.track.stop).toHaveBeenCalledOnce();
  expect(harness.video.srcObject).toBeNull();
  expect(button(harness.renderer, "Use camera").props.disabled).toBe(true);
  await act(async () => button(harness.renderer, "Use camera").props.onClick());
  expect(harness.requestCamera).toHaveBeenCalledOnce();
  act(() => {
    harness.renderer.update(createElement(harness.Scanner, {
      onDetected: harness.onDetected,
      stopRequested: false,
    }));
  });
  await act(async () => button(harness.renderer, "Use camera").props.onClick());
  await act(async () => staleCandidate("034000470693"));
  await act(async () => staleCandidate("034000470693"));
  expect(harness.onDetected).not.toHaveBeenCalled();
  await act(async () => harness.renderer.unmount());
});

test.each([
  [
    "NotAllowedError",
    "Camera permission denied",
    "Camera permission was denied. Allow access in browser settings or enter the barcode below.",
  ],
  [
    "NotFoundError",
    "No camera found",
    "No camera is available. You can still enter the barcode below.",
  ],
  [
    "NotReadableError",
    "Camera is busy",
    "Another application may be using the camera. Close it, then retry or enter the barcode below.",
  ],
  [
    "AbortError",
    "Camera is busy",
    "Another application may be using the camera. Close it, then retry or enter the barcode below.",
  ],
  [
    "OverconstrainedError",
    "Camera settings unsupported",
    "This device cannot provide a compatible camera stream. Enter the barcode below instead.",
  ],
  [
    "SecurityError",
    "Secure camera access required",
    "Camera scanning requires HTTPS or another secure browser context. Enter the barcode below instead.",
  ],
])("camera %s failures preserve retry and manual fallback", async (
  name,
  title,
  message,
) => {
  const error = new Error(name);
  error.name = name;
  const harness = scannerHarness({ mediaFailure: error });

  await act(async () => button(harness.renderer, "Use camera").props.onClick());

  expect(text(harness.renderer.root)).toContain(title);
  expect(text(harness.renderer.root)).toContain(message);
  expect(text(harness.renderer.root)).toContain("Retry camera");
  expect(text(harness.renderer.root)).toContain("Enter barcode manually");
  await act(async () => harness.renderer.unmount());
});

test("an unavailable or terminal decoder closes the camera and offers safe recovery", async () => {
  const unavailable = scannerHarness({ decoderFailure: new Error("missing") });
  await act(async () => button(unavailable.renderer, "Use camera").props.onClick());
  expect(text(unavailable.renderer.root)).toContain("Barcode decoder unavailable");
  expect(text(unavailable.renderer.root)).toContain(
    "Local barcode recognition could not start. Retry or enter the barcode below.",
  );
  expect(unavailable.requestCamera).not.toHaveBeenCalled();
  await act(async () => button(
    unavailable.renderer,
    "Retry camera",
  ).props.onClick());
  expect(unavailable.loadDecoder).toHaveBeenCalledTimes(2);
  await act(async () => unavailable.renderer.unmount());

  const terminal = scannerHarness();
  await act(async () => button(terminal.renderer, "Use camera").props.onClick());
  const staleCandidate = terminal.reportCandidate();
  const staleTerminalError = terminal.reportTerminalError();
  await act(async () => staleCandidate("0000000000004"));
  await act(async () => staleTerminalError(new Error("stopped")));
  expect(text(terminal.renderer.root)).toContain("Barcode decoder unavailable");
  expect(terminal.stopDecoder).toHaveBeenCalledOnce();
  expect(terminal.track.stop).toHaveBeenCalledOnce();
  await act(async () => button(terminal.renderer, "Retry camera").props.onClick());
  const currentCandidate = terminal.reportCandidate();
  await act(async () => currentCandidate("034000470693"));
  expect(terminal.onDetected).toHaveBeenCalledOnce();
  await act(async () => staleCandidate("034000470693"));
  await act(async () => staleCandidate("034000470693"));
  await act(async () => staleTerminalError(new Error("still stale")));
  expect(terminal.onDetected).toHaveBeenCalledOnce();
  expect(text(terminal.renderer.root)).toContain("Recognized 034000470693");
  await act(async () => terminal.renderer.unmount());
});

test("a detached preview stops its acquired stream before decoder startup", async () => {
  const harness = scannerHarness({ withoutVideo: true });

  await act(async () => button(harness.renderer, "Use camera").props.onClick());

  expect(text(harness.renderer.root)).toContain("Camera unavailable");
  expect(harness.track.stop).toHaveBeenCalledOnce();
  expect(harness.decoder.start).not.toHaveBeenCalled();
  await act(async () => harness.renderer.unmount());
});

test("a rejected decoder start closes the acquired stream and exposes recovery", async () => {
  const harness = scannerHarness();
  harness.decoder.start = vi.fn(async () => {
    throw new Error("decoder start failed");
  });

  await act(async () => button(harness.renderer, "Use camera").props.onClick());

  expect(text(harness.renderer.root)).toContain("Barcode decoder unavailable");
  expect(harness.track.stop).toHaveBeenCalledOnce();
  expect(harness.video.srcObject).toBeNull();
  await act(async () => harness.renderer.unmount());
});

test("a preview playback failure is reported as a camera failure and closes its track", async () => {
  const harness = scannerHarness();
  harness.video.play.mockRejectedValueOnce(new Error("could not play"));

  await act(async () => button(harness.renderer, "Use camera").props.onClick());

  expect(text(harness.renderer.root)).toContain("Camera unavailable");
  expect(text(harness.renderer.root)).toContain(
    "The camera could not be started on this browser. Retry or enter the barcode below.",
  );
  expect(harness.track.stop).toHaveBeenCalledOnce();
  expect(harness.decoder.start).not.toHaveBeenCalled();
  await act(async () => harness.renderer.unmount());
});
