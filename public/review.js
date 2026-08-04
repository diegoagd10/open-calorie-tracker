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
