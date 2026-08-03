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
})();
