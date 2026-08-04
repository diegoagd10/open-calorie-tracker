(() => {
  function parseQuantity(value) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(normalized);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    const fraction = /^(\d+)\/(\d+)$/.exec(normalized);
    if (fraction) return Number(fraction[1]) / Number(fraction[2]);
    return Number(normalized);
  }

  function updateReview(quantityInput) {
    const quantity = parseQuantity(quantityInput.value);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    document.querySelectorAll("[data-review-value]").forEach((value) => {
      const base = Number(value.dataset.baseValue);
      if (!Number.isFinite(base)) return;
       const scaled = base * quantity;
      value.firstChild.textContent = value.dataset.reviewKind === "grams" ? scaled.toFixed(1) : String(Math.round(scaled));
    });
  }

  document.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.matches("[data-review-quantity]")) updateReview(event.target);
  });

  const liveVideo = document.querySelector("[data-barcode-video]");
  const livePlaceholder = document.querySelector("[data-barcode-camera-placeholder]");
  const barcodeScanButton = document.querySelector("[data-barcode-scan]");
  const barcodeForm = document.querySelector("#barcode-form");
  const cameraInput = document.querySelector("[data-barcode-camera]");
  const barcodeInput = document.querySelector("[data-barcode-input]");
  const cameraStatus = document.querySelector("[data-barcode-camera-status]");
  const labelVideo = document.querySelector("[data-label-video]");
  const labelPlaceholder = document.querySelector("[data-label-camera-placeholder]");
  const labelCaptureButton = document.querySelector("[data-label-capture]");
  const labelFile = document.querySelector("[data-label-file]");
  const labelForm = document.querySelector("#label-form");
  const labelStatus = document.querySelector("[data-label-camera-status]");
  let cameraStream = null;
  let scanTimeout = null;
  let liveDetector = null;
  let zxingControls = null;
  let labelStream = null;

  function setCameraStatus(message) {
    if (cameraStatus instanceof HTMLElement) cameraStatus.textContent = message;
  }

  function stopLiveCamera() {
    if (scanTimeout !== null) window.clearTimeout(scanTimeout);
    scanTimeout = null;
    liveDetector = null;
    zxingControls?.stop();
    zxingControls = null;
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    if (liveVideo instanceof HTMLVideoElement) {
      liveVideo.pause();
      liveVideo.srcObject = null;
      liveVideo.hidden = true;
    }
    if (barcodeScanButton instanceof HTMLButtonElement) barcodeScanButton.disabled = true;
    if (livePlaceholder instanceof HTMLElement) livePlaceholder.hidden = false;
  }

  async function startZxingScanner() {
    if (!(liveVideo instanceof HTMLVideoElement) || !window.ZXingBrowser?.BrowserMultiFormatReader) return false;
    try {
      const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
      zxingControls = await reader.decodeFromVideoElement(liveVideo, (result, _error, controls) => {
        if (!result || !(barcodeInput instanceof HTMLInputElement)) return;
        barcodeInput.value = result.getText();
        barcodeInput.dispatchEvent(new Event("input", { bubbles: true }));
        setCameraStatus("Barcode detected. Review it, then look it up.");
        (controls || zxingControls)?.stop();
        zxingControls = null;
      });
      setCameraStatus("Camera is active. Center the barcode in the frame.");
      return true;
    } catch {
      zxingControls = null;
      return false;
    }
  }

  async function detectLiveBarcode() {
    if (!(liveVideo instanceof HTMLVideoElement) || !cameraStream || !liveDetector) return;
    try {
      if (liveVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const detections = await liveDetector.detect(liveVideo);
        const detected = detections[0]?.rawValue;
        if (detected && barcodeInput instanceof HTMLInputElement) {
          barcodeInput.value = detected;
          barcodeInput.dispatchEvent(new Event("input", { bubbles: true }));
          setCameraStatus("Barcode detected. Review it, then look it up.");
          liveDetector = null;
          return;
        }
      }
    } catch {
      setCameraStatus("Camera is active. Center a barcode or enter it manually.");
    }
    if (cameraStream && liveDetector) scanTimeout = window.setTimeout(detectLiveBarcode, 250);
  }

  async function startLiveCamera() {
    if (!(liveVideo instanceof HTMLVideoElement)) return;
    stopLiveCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("This browser cannot access the camera. Enter the barcode manually.");
      return;
    }
    setCameraStatus("Requesting camera access...");
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      liveVideo.srcObject = cameraStream;
      liveVideo.hidden = false;
      if (livePlaceholder instanceof HTMLElement) livePlaceholder.hidden = true;
      if (barcodeScanButton instanceof HTMLButtonElement) barcodeScanButton.disabled = false;
      await liveVideo.play();
      if (await startZxingScanner()) return;
      const Detector = window.BarcodeDetector;
      if (!Detector) {
        setCameraStatus("Camera is active. Enter the barcode manually if live detection is unavailable.");
        return;
      }
      try {
        liveDetector = new Detector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
      } catch {
        liveDetector = new Detector();
      }
      setCameraStatus("Camera is active. Center the barcode in the frame.");
      void detectLiveBarcode();
    } catch (error) {
      stopLiveCamera();
      const errorName = error && typeof error === "object" && "name" in error ? error.name : "";
      setCameraStatus(errorName === "NotAllowedError" ? "Camera access was denied. Allow it in browser settings or enter the barcode manually." : "Camera could not start. Enter the barcode manually.");
    }
  }

  async function captureBarcodeFrame() {
    if (!(liveVideo instanceof HTMLVideoElement) || !(barcodeInput instanceof HTMLInputElement) || !(barcodeForm instanceof HTMLFormElement)) return;
    if (!liveVideo.videoWidth || !liveVideo.videoHeight) {
      setCameraStatus("Camera is still starting. Try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = liveVideo.videoWidth;
    canvas.height = liveVideo.videoHeight;
    canvas.getContext("2d")?.drawImage(liveVideo, 0, 0, canvas.width, canvas.height);
    setCameraStatus("Scanning current frame...");
    try {
      let detected;
      const Detector = window.BarcodeDetector;
      if (Detector) {
        const detections = await new Detector().detect(canvas);
        detected = detections[0]?.rawValue;
      }
      if (!detected && window.ZXingBrowser?.BrowserMultiFormatReader) {
        const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
        detected = (await reader.decodeFromCanvas(canvas))?.getText();
      }
      if (!detected) throw new Error("No barcode found");
      barcodeInput.value = detected;
      barcodeInput.dispatchEvent(new Event("input", { bubbles: true }));
      setCameraStatus("Barcode found. Looking up product...");
      barcodeForm.requestSubmit();
    } catch {
      setCameraStatus("No barcode found. Center the code and tap Scan again.");
    }
  }

  if (liveVideo instanceof HTMLVideoElement) {
    void startLiveCamera();
    window.addEventListener("pagehide", stopLiveCamera, { once: true });
  }
  if (cameraInput instanceof HTMLInputElement && barcodeInput instanceof HTMLInputElement) {
    cameraInput.addEventListener("change", async () => {
      const file = cameraInput.files?.[0];
      const Detector = window.BarcodeDetector;
      if (!file) return;
      stopLiveCamera();
      if (!Detector) {
        setCameraStatus("Camera image captured. Enter the barcode manually in this browser.");
        return;
      }
      try {
        const detections = await new Detector().detect(file);
        const detected = detections[0]?.rawValue;
        if (!detected) throw new Error("No barcode found");
        barcodeInput.value = detected;
        barcodeInput.dispatchEvent(new Event("input", { bubbles: true }));
        setCameraStatus("Barcode detected. Review it, then look it up.");
      } catch {
        setCameraStatus("No barcode was detected. Enter it manually instead.");
      }
    });
  }

  function setLabelStatus(message) {
    if (labelStatus instanceof HTMLElement) labelStatus.textContent = message;
  }

  function stopLabelCamera() {
    labelStream?.getTracks().forEach((track) => track.stop());
    labelStream = null;
    if (labelVideo instanceof HTMLVideoElement) {
      labelVideo.pause();
      labelVideo.srcObject = null;
      labelVideo.hidden = true;
    }
    if (labelPlaceholder instanceof HTMLElement) labelPlaceholder.hidden = false;
    if (labelCaptureButton instanceof HTMLButtonElement) labelCaptureButton.disabled = true;
  }

  async function startLabelCamera() {
    if (!(labelVideo instanceof HTMLVideoElement)) return;
    stopLabelCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setLabelStatus("This browser cannot access the camera. Reload and allow camera access.");
      return;
    }
    setLabelStatus("Requesting camera access...");
    try {
      labelStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      labelVideo.srcObject = labelStream;
      labelVideo.hidden = false;
      if (labelPlaceholder instanceof HTMLElement) labelPlaceholder.hidden = true;
      await labelVideo.play();
      if (labelCaptureButton instanceof HTMLButtonElement) labelCaptureButton.disabled = false;
      setLabelStatus("Camera is active. Frame the full nutrition label.");
    } catch (error) {
      stopLabelCamera();
      const errorName = error && typeof error === "object" && "name" in error ? error.name : "";
      setLabelStatus(errorName === "NotAllowedError" ? "Camera access was denied. Allow it in browser settings, then reload." : "Camera could not start. Reload and try again.");
    }
  }

  async function captureLabelPhoto() {
    if (!(labelVideo instanceof HTMLVideoElement) || !(labelFile instanceof HTMLInputElement) || !(labelForm instanceof HTMLFormElement)) return;
    if (!labelVideo.videoWidth || !labelVideo.videoHeight) {
      setLabelStatus("Camera is still starting. Try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = labelVideo.videoWidth;
    canvas.height = labelVideo.videoHeight;
    canvas.getContext("2d")?.drawImage(labelVideo, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!(blob instanceof Blob)) {
      setLabelStatus("The label photo could not be captured. Use the image upload instead.");
      return;
    }
    const file = new File([blob], `food-label-${Date.now()}.jpg`, { type: "image/jpeg" });
    if (typeof DataTransfer === "undefined") {
      const formData = new FormData(labelForm);
      formData.set("image", file);
      stopLabelCamera();
      setLabelStatus("Reading label...");
      const response = await fetch(labelForm.action, { method: "POST", body: formData });
      document.open();
      document.write(await response.text());
      document.close();
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    labelFile.files = transfer.files;
    stopLabelCamera();
    setLabelStatus("Reading label...");
    labelForm.requestSubmit();
  }

  if (labelVideo instanceof HTMLVideoElement) {
    if (labelCaptureButton instanceof HTMLButtonElement) labelCaptureButton.addEventListener("click", () => { void captureLabelPhoto(); });
    if (labelFile instanceof HTMLInputElement) labelFile.addEventListener("change", () => { if (labelFile.files?.length) { stopLabelCamera(); setLabelStatus("Label image ready. Read label when you are ready."); } });
    void startLabelCamera();
    window.addEventListener("pagehide", stopLabelCamera, { once: true });
  }

  if (barcodeScanButton instanceof HTMLButtonElement) barcodeScanButton.addEventListener("click", () => { void captureBarcodeFrame(); });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-entry-menu]") : null;
    if (!target) return;
    const menu = target.parentElement?.querySelector(".entry-menu");
    if (!menu) return;
    const isHidden = menu.hasAttribute("hidden");
    document.querySelectorAll(".entry-menu").forEach((entryMenu) => entryMenu.setAttribute("hidden", ""));
    document.querySelectorAll("[data-entry-menu]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    if (isHidden) {
      menu.removeAttribute("hidden");
      target.setAttribute("aria-expanded", "true");
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && !event.target.closest(".entry-actions")) {
      document.querySelectorAll(".entry-menu").forEach((menu) => menu.setAttribute("hidden", ""));
      document.querySelectorAll("[data-entry-menu]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    }
  });
})();
