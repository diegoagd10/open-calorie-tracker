export type BarcodeDecoderSession = { stop: () => void };

export type BarcodeDecoder = {
  start: (
    video: HTMLVideoElement,
    onCandidate: (barcode: string) => void,
    onTerminalError: (error: unknown) => void,
  ) => Promise<BarcodeDecoderSession>;
};
