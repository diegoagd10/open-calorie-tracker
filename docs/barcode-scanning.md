# Camera barcode scanning

`Scan barcode` supports both manual entry and an explicit `Use camera` action.
Camera scanning requires all of the following:

- a modern browser with `MediaDevices.getUserMedia`, such as current Safari on
  iOS or Chrome on Android;
- a user-granted camera permission; and
- HTTPS or another browser-recognized secure context (localhost is accepted by
  browsers for local development).

The camera request prefers an environment-facing camera and never requests
audio. Video frames remain in browser memory: the application does not encode,
persist, log, or transmit a photo, frame, blob, or data URL. A stable decoded
barcode is passed to the same Open Food Facts lookup used by manual input, and
the camera closes before that request begins. The user must still review the
product, serving, quantity, attribution, and nutrition before confirming a Food
Entry.

Decoding uses the browser's `BarcodeDetector` only when it supports the complete
EAN-8, EAN-13, UPC-A, UPC-E, and ITF set. Otherwise the application falls back
to the bundled ZXing decoder. ZXing JavaScript is built into the application's
own client assets; no CDN or remote recognition service is used.

If permission is denied, no camera exists, the camera is busy, constraints are
incompatible, or local decoding cannot start, the dialog keeps manual barcode
entry and USDA search available. `Retry camera` is always deliberate; a failed
lookup never reopens the camera automatically.
