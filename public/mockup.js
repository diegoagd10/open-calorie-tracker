const appShell = document.querySelector(".app-shell");
const viewPanels = [...document.querySelectorAll("[data-view-panel]")];
const navItems = [...document.querySelectorAll("[data-view]")];
const title = document.querySelector("#workspace-title");
const description = document.querySelector("#workspace-description");
const sourceLayer = document.querySelector("#source-layer");
const reviewDrawer = document.querySelector("#review-drawer");
const confirmLayer = document.querySelector("#confirm-layer");
const toast = document.querySelector("#toast");
const toastMessage = document.querySelector("#toast-message");
const reviewName = document.querySelector("#review-food-name");
const reviewQuantity = document.querySelector("#review-quantity");
const reviewCalories = document.querySelector("#review-calories");
const dateHeading = document.querySelector("#log-heading");
const todayButton = document.querySelector(".today-button");
const feed = document.querySelector("#food-feed");
const emptyLog = document.querySelector("#empty-log");
const feedSummary = document.querySelector("#feed-summary");
const calorieValue = document.querySelector("#calorie-value");
const calorieTrackFill = document.querySelector("#calorie-track-fill");
const calorieNote = document.querySelector("#calorie-note span:last-child");
const nutrientMeasures = [...document.querySelectorAll(".nutrient-measure strong")];
const nutrientTrackFills = [...document.querySelectorAll(".nutrient-track span")];
const sodiumRow = document.querySelector("#sodium-row");
const sodiumAlert = document.querySelector("#sodium-alert");
const sodiumValue = document.querySelector("#sodium-value");
const sodiumReference = document.querySelector("#sodium-reference");
const barcodeError = document.querySelector("#barcode-error");
const manualBarcode = document.querySelector("#manual-barcode");
const labelReviewCard = document.querySelector("#label-review-card");
const scanReview = document.querySelector("#scan-review");
const foodMode = document.querySelector("#food-mode");
const scanServiceState = document.querySelector("#scan-service-state");
const serviceStateKicker = document.querySelector("#service-state-kicker");
const serviceStateTitle = document.querySelector("#service-state-title");
const serviceStateCopy = document.querySelector("#service-state-copy");
const extraIngredient = document.querySelector("#extra-ingredient");
const ingredientCount = document.querySelector("#ingredient-count");
const mealCalories = document.querySelector("#meal-calories");
const savedSearch = document.querySelector("#saved-search");
const reviewSourceChip = document.querySelector("#review-source-chip");
const reviewSourceNote = document.querySelector("#review-source-note");
const reviewBrand = document.querySelector("#review-brand");
const reviewQuantityUnit = document.querySelector("#review-quantity-unit");
const reviewProtein = document.querySelector("#review-protein");
const reviewCarbs = document.querySelector("#review-carbs");
const reviewFat = document.querySelector("#review-fat");
const reviewFiber = document.querySelector("#review-fiber");
const reviewSodium = document.querySelector("#review-sodium");
const reviewWarningTitle = document.querySelector("#review-warning-title");
const reviewWarningText = document.querySelector("#review-warning-text");
const reviewBasis = document.querySelector("#review-basis");
const reviewSaveButton = document.querySelector("#review-save-button");
const reviewPrimaryButton = document.querySelector("#review-primary-button");
const drawerStatusDot = document.querySelector("#drawer-status-dot");
const drawerStatusLabel = document.querySelector("#drawer-status-label");

const viewMeta = {
  log: {
    title: "Today’s log",
    description: "A clear record of what you have eaten so far.",
  },
  database: {
    title: "Food Database",
    description: "Find a confirmed food, then review the amount you actually consumed.",
  },
  scan: {
    title: "Scan Food",
    description: "Capture first. Review every proposal before it becomes part of your log.",
  },
  saved: {
    title: "Saved Foods",
    description: "Your reusable Foods, Favorites, and one-unit Meals.",
  },
  meal: {
    title: "Create Meal",
    description: "Assemble one reusable Meal from confirmed Food ingredients.",
  },
  settings: {
    title: "Daily Targets",
    description: "Optional references that stay under your control.",
  },
};

let currentView = "log";
let currentFixture = "normal";
let quantity = 1;
let toastTimeout;
let reviewMode = "candidate";
let lastFocusedElement = null;

const reviewProfiles = {
  yogurt: {
    source: "External candidate",
    sourceClass: "source-chip--candidate",
    sourceNote: "Nutrition values may be incomplete",
    brand: "A food record ready for your review",
    unit: "serving",
    calories: 284,
    protein: "16.0",
    carbs: "22.3",
    fat: "12.8",
    fiber: "1.2",
    sodium: "78",
    warningTitle: "One value is unknown",
    warningText: "Total sugar was not provided by this source. It will remain unknown, not zero.",
    basis: "Candidate source: external food record. Declared basis: 1 serving. Values shown here are illustrative mock data.",
    status: "Candidate requires confirmation",
    statusClass: "status-dot--amber",
  },
  salmon: {
    source: "Saved food",
    sourceClass: "source-chip--saved",
    sourceNote: "Confirmed food in your personal library",
    brand: "A reusable Food with a stable nutrition snapshot",
    unit: "bowl",
    calories: 612,
    protein: "34.2",
    carbs: "58.6",
    fat: "24.1",
    fiber: "7.0",
    sodium: "410",
    warningTitle: "Historical values stay stable",
    warningText: "Editing this reusable Food changes future uses only. Existing entries keep their snapshot.",
    basis: "Confirmed Food. Declared basis: 1 assembled bowl. Values shown here are illustrative mock data.",
    status: "Confirmed food ready to add",
    statusClass: "",
  },
  oats: {
    source: "My food",
    sourceClass: "source-chip--manual",
    sourceNote: "Created and owned in this instance",
    brand: "A reusable Food with an explicit quantity basis",
    unit: "jar",
    calories: 200,
    protein: "11.5",
    carbs: "19.0",
    fat: "7.4",
    fiber: "5.1",
    sodium: "42",
    warningTitle: "One value is unknown",
    warningText: "Total sugar was not provided for this Food. It will remain unknown, not zero.",
    basis: "Manual Food. Declared basis: 1 jar. Values shown here are illustrative mock data.",
    status: "Confirmed food ready to add",
    statusClass: "",
  },
  chickpea: {
    source: "Reviewed candidate",
    sourceClass: "source-chip--candidate",
    sourceNote: "Confirmed after reviewing the candidate values",
    brand: "A confirmed Food from a reviewed proposal",
    unit: "cup",
    calories: 260,
    protein: "9.8",
    carbs: "31.2",
    fat: "11.0",
    fiber: "8.2",
    sodium: "286",
    warningTitle: "Source values remain visible",
    warningText: "Review the declared quantity and any missing values before saving or logging.",
    basis: "Reviewed candidate. Declared basis: 1 cup. Values shown here are illustrative mock data.",
    status: "Confirmed candidate ready to add",
    statusClass: "",
  },
  label: {
    source: "Food Label candidate",
    sourceClass: "source-chip--candidate",
    sourceNote: "Partial extraction; fields remain editable",
    brand: "A label capture with one required correction",
    unit: "serving",
    calories: 130,
    protein: "—",
    carbs: "22.0",
    fat: "4.5",
    fiber: "3.0",
    sodium: "180",
    warningTitle: "Protein is missing",
    warningText: "This partial label extraction needs manual correction before it can be confirmed.",
    basis: "Food Label candidate. Declared basis: 1 serving. Values shown here are illustrative mock data.",
    status: "Partial extraction requires correction",
    statusClass: "status-dot--amber",
  },
  edit: {
    source: "Historical snapshot",
    sourceClass: "source-chip--saved",
    sourceNote: "Editing this entry does not change the reusable Food",
    brand: "Correct the date, time, quantity, or meal tag for this entry",
    unit: "bowl",
    calories: 612,
    protein: "34.2",
    carbs: "58.6",
    fat: "24.1",
    fiber: "7.0",
    sodium: "410",
    warningTitle: "Snapshot stays immutable",
    warningText: "The values shown belong to this historical entry. Reusable Food edits are separate.",
    basis: "Historical entry. Declared basis: 1 bowl. Values shown here are illustrative mock data.",
    status: "Editing historical entry",
    statusClass: "",
  },
};

function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = hidden;
  if (element.hasAttribute("aria-hidden")) {
    element.setAttribute("aria-hidden", String(hidden));
  }
}

function closeOverlays() {
  setHidden(sourceLayer, true);
  setHidden(reviewDrawer, true);
  setHidden(confirmLayer, true);
  document.querySelectorAll(".entry-menu").forEach((menu) => setHidden(menu, true));
  document.querySelectorAll('[data-action="entry-menu"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    const focusTarget = lastFocusedElement;
    window.setTimeout(() => focusTarget.focus(), 0);
  }
  lastFocusedElement = null;
}

function setView(view) {
  if (!viewMeta[view]) return;

  currentView = view;
  viewPanels.forEach((panel) => {
    const isActive = panel.dataset.viewPanel === view;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });

  const navView = view === "meal" ? "saved" : view;
  navItems.forEach((item) => {
    const isActive = item.dataset.view === navView;
    item.classList.toggle("is-active", isActive);
    if (item.classList.contains("mobile-nav-item")) {
      if (isActive) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
  });
  title.textContent = viewMeta[view].title;
  description.textContent = viewMeta[view].description;
  closeOverlays();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openLayer(layer) {
  const focusTarget = document.activeElement;
  closeOverlays();
  lastFocusedElement = focusTarget;
  setHidden(layer, false);
  const dialogTarget = layer.querySelector("[role=dialog], [role=alertdialog]") || layer;
  const firstControl = dialogTarget.querySelector("button, input, [tabindex]:not([tabindex='-1'])");
  window.requestAnimationFrame(() => firstControl?.focus());
}

function showToast(message) {
  window.clearTimeout(toastTimeout);
  toastMessage.textContent = message;
  setHidden(toast, false);
  toastTimeout = window.setTimeout(() => setHidden(toast, true), 5200);
}

function setFixture(fixture) {
  currentFixture = fixture;
  const isScanState = fixture === "loading" || fixture === "retry";
  if (isScanState) {
    appShell.classList.remove("is-past", "is-no-target", "is-limit", "is-empty");
    document.querySelectorAll("[data-fixture]").forEach((button) => button.classList.toggle("is-active", button.dataset.fixture === fixture));
    setView("scan");
    setScanMode("food");
    setHidden(scanServiceState, false);
    scanServiceState.classList.toggle("is-retry", fixture === "retry");
    serviceStateKicker.textContent = fixture === "retry" ? "Temporary availability" : "Analysis in progress";
    serviceStateTitle.textContent = fixture === "retry" ? "The provider is unavailable" : "Reading the image";
    serviceStateCopy.textContent = fixture === "retry" ? "The capture is safe. Retry when the upstream service is available again." : "This is a static loading state. The capture remains visible while the result is prepared.";
    return;
  }

  appShell.classList.toggle("is-past", fixture === "past");
  appShell.classList.toggle("is-no-target", fixture === "no-target");
  appShell.classList.toggle("is-limit", fixture === "limit");
  appShell.classList.toggle("is-empty", fixture === "empty");

  const isPast = fixture === "past";
  const isEmpty = fixture === "empty";
  const isLimit = fixture === "limit";
  const isNoTarget = fixture === "no-target";

  dateHeading.textContent = isPast ? "Sunday, 01 June 2025" : "Tuesday, 03 June 2025";
  todayButton.hidden = !isPast;
  feed.hidden = isEmpty;
  emptyLog.hidden = !isEmpty;
  feedSummary.textContent = isEmpty ? "No entries yet" : "4 entries / newest first";
  calorieValue.textContent = isEmpty ? "0" : "1,486";
  calorieTrackFill.style.width = isEmpty || isNoTarget ? "0%" : "71%";
  calorieNote.textContent = isEmpty ? "Add a food to start your day" : isNoTarget ? "Set a target when you want one" : "Target confirmed 12 May 2025";
  nutrientMeasures.forEach((measure) => {
    if (!measure.dataset.defaultValue) measure.dataset.defaultValue = measure.textContent;
    measure.textContent = isEmpty ? "—" : measure.dataset.defaultValue;
  });
  nutrientTrackFills.forEach((fill) => {
    if (!fill.dataset.defaultWidth) fill.dataset.defaultWidth = fill.style.width;
    fill.style.width = isEmpty ? "0%" : fill.dataset.defaultWidth;
  });
  document.querySelectorAll(".entry-main p").forEach((entryMeta) => {
    if (!entryMeta.dataset.defaultCopy) entryMeta.dataset.defaultCopy = entryMeta.innerHTML;
    entryMeta.innerHTML = isPast ? `${entryMeta.dataset.defaultCopy.split("<span")[0].trim()} <span class="meta-divider">/</span> logged on this date` : entryMeta.dataset.defaultCopy;
  });

  sodiumRow.classList.toggle("is-limit", isLimit);
  sodiumAlert.hidden = !isLimit;
  sodiumValue.textContent = isLimit ? "2,520" : "1,640";
  sodiumReference.innerHTML = isLimit ? "2,300 mg / 220 mg over" : "2,300 mg <span>upper reference</span>";

  const calorieReference = document.querySelector("#calorie-reference");
  const calorieRemaining = document.querySelector("#calorie-remaining");
  calorieReference.textContent = isNoTarget ? "No target set" : "Daily target";
  calorieRemaining.textContent = isEmpty ? "No food logged yet" : isNoTarget ? "No target set" : "614 kcal remaining";

  document.querySelectorAll("[data-fixture]").forEach((button) => button.classList.toggle("is-active", button.dataset.fixture === fixture));
  if (currentView !== "log") setView("log");
}

function openReview(name = "Greek yogurt, honey & walnuts", profileKey = "yogurt") {
  const profile = reviewProfiles[profileKey] || reviewProfiles.yogurt;
  reviewMode = profileKey === "edit" ? "edit" : "candidate";
  reviewName.textContent = name;
  reviewSourceChip.textContent = profile.source;
  reviewSourceChip.className = `source-chip ${profile.sourceClass}`;
  reviewSourceNote.textContent = profile.sourceNote;
  drawerStatusLabel.textContent = profile.status;
  drawerStatusDot.className = `status-dot ${profile.statusClass}`.trim();
  reviewBrand.textContent = profile.brand;
  reviewQuantityUnit.textContent = profile.unit;
  reviewCalories.dataset.baseCalories = String(profile.calories);
  reviewCalories.textContent = profile.calories;
  reviewProtein.textContent = profile.protein;
  reviewCarbs.textContent = profile.carbs;
  reviewFat.textContent = profile.fat;
  reviewFiber.textContent = profile.fiber;
  reviewSodium.textContent = profile.sodium;
  reviewWarningTitle.textContent = profile.warningTitle;
  reviewWarningText.textContent = profile.warningText;
  reviewBasis.textContent = profile.basis;
  reviewSaveButton.hidden = reviewMode === "edit";
  reviewPrimaryButton.querySelector("span").textContent = reviewMode === "edit" ? "Save entry" : "Add to Log";
  quantity = 1;
  reviewQuantity.textContent = "1";
  openLayer(reviewDrawer);
}

function updateQuantity(nextQuantity) {
  quantity = Math.max(.25, Math.round(nextQuantity * 4) / 4);
  reviewQuantity.textContent = quantity % 1 === 0 ? String(quantity) : quantity.toString().replace("0.", ".");
  const baseCalories = Number(reviewCalories.dataset.baseCalories || reviewCalories.textContent);
  reviewCalories.textContent = Math.round(baseCalories * quantity);
}

function setScanMode(mode) {
  document.querySelectorAll("[data-scan-mode]").forEach((button) => {
    const isActive = button.dataset.scanMode === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll("[data-scan-panel]").forEach((panel) => setHidden(panel, panel.dataset.scanPanel !== mode));
  setHidden(scanReview, true);
  setHidden(barcodeError, true);
  setHidden(manualBarcode, true);
  setHidden(labelReviewCard, true);
  setHidden(scanServiceState, true);
}

function filterResults(query) {
  const normalized = query.trim().toLowerCase();
  let visibleResults = 0;
  document.querySelectorAll(".food-result").forEach((result) => {
    const visible = !normalized || result.textContent.toLowerCase().includes(normalized);
    result.hidden = !visible;
    if (visible) visibleResults += 1;
  });
  document.querySelector("#database-result-count").textContent = normalized ? `${visibleResults} matching result${visibleResults === 1 ? "" : "s"}` : "Used in your last 7 days";
  setHidden(document.querySelector("#no-results"), visibleResults !== 0);
}

function filterLibrary(query = "", type = "all") {
  const normalized = query.trim().toLowerCase();
  document.querySelectorAll(".library-item").forEach((item) => {
    const matchesQuery = !normalized || item.textContent.toLowerCase().includes(normalized);
    const matchesType = type === "all" || item.dataset.libraryType === type;
    item.hidden = !(matchesQuery && matchesType);
  });
}

function showAiProposal(message) {
  const proposal = document.querySelector("#ai-proposal");
  proposal.querySelector("p").textContent = message;
  setHidden(proposal, false);
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }

  const fixtureButton = event.target.closest("[data-fixture]");
  if (fixtureButton) {
    setFixture(fixtureButton.dataset.fixture);
    return;
  }

  const sourceOption = event.target.closest("[data-source]");
  if (sourceOption) {
    const source = sourceOption.dataset.source;
    setView(source);
    return;
  }

  const scanModeButton = event.target.closest("[data-scan-mode]");
  if (scanModeButton) {
    setScanMode(scanModeButton.dataset.scanMode);
    return;
  }

  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    document.querySelectorAll("[data-filter]").forEach((button) => {
      const isActive = button === filterButton;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
    document.querySelector("#database-result-count").textContent = `${filterButton.textContent.trim().replace(/\s+\d+$/, "")} selected`;
    return;
  }

  const libraryFilter = event.target.closest("[data-library-filter]");
  if (libraryFilter) {
    document.querySelectorAll("[data-library-filter]").forEach((button) => {
      const isActive = button === libraryFilter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
    filterLibrary(savedSearch?.value || "", libraryFilter.dataset.libraryFilter);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  switch (actionButton.dataset.action) {
    case "open-source":
      openLayer(sourceLayer);
      break;
    case "close-overlays":
      closeOverlays();
      break;
    case "open-review":
      openReview(actionButton.dataset.foodName || "Greek yogurt, honey & walnuts", actionButton.dataset.reviewType || "yogurt");
      break;
    case "quantity-down":
      updateQuantity(quantity - .25);
      break;
    case "quantity-up":
      updateQuantity(quantity + .25);
      break;
    case "add-to-log":
      closeOverlays();
      setView("log");
      showToast(reviewMode === "edit" ? "Entry changes saved to your log." : "Candidate added to your log.");
      break;
    case "save-food":
      closeOverlays();
      setView("saved");
      showToast("Food saved for future use.");
      break;
    case "previous-day":
      setFixture("past");
      break;
    case "next-day":
      setFixture("normal");
      break;
    case "today":
      setFixture("normal");
      break;
    case "target-settings":
      setView("settings");
      break;
    case "entry-menu": {
      const actions = actionButton.closest(".entry-actions");
      const menu = actions.querySelector(".entry-menu");
      const willOpen = menu.hidden;
      document.querySelectorAll(".entry-menu").forEach((item) => setHidden(item, true));
      document.querySelectorAll('[data-action="entry-menu"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
      setHidden(menu, !willOpen);
      actionButton.setAttribute("aria-expanded", String(willOpen));
      break;
    }
    case "edit-entry":
      closeOverlays();
      openReview("Salmon rice bowl", "edit");
      break;
    case "delete-entry":
      closeOverlays();
      openLayer(confirmLayer);
      break;
    case "confirm-delete":
      closeOverlays();
      showToast("Entry deleted. Undo is available for a short time.");
      break;
    case "undo":
      showToast("Entry restored to your log.");
      break;
    case "capture-food":
      setHidden(foodMode, true);
      setHidden(scanReview, false);
      setHidden(scanServiceState, true);
      break;
    case "scan-reset":
      setHidden(foodMode, false);
      setHidden(scanReview, true);
      break;
    case "barcode-not-found":
      setHidden(barcodeError, false);
      break;
    case "show-barcode-manual":
      setHidden(manualBarcode, false);
      document.querySelector("#manual-barcode-input")?.focus();
      break;
    case "manual-barcode-submit":
      openReview("Scanned product candidate", "yogurt");
      break;
    case "clear-scan-error":
      setHidden(barcodeError, true);
      break;
    case "retry-scan":
      setHidden(scanServiceState, true);
      showToast("Retry queued for this mock state.");
      break;
    case "label-review":
      setHidden(labelReviewCard, false);
      break;
    case "edit-ingredient-ai":
      showAiProposal("Proposal: reduce the rice to 1/2 cup. No change is applied until you confirm it.");
      break;
    case "edit-ingredient":
      showToast("Manual ingredient edit state opened.");
      break;
    case "delete-ingredient":
      actionButton.closest(".ingredient-row")?.remove();
      showToast("Ingredient removed from this proposal.");
      break;
    case "edit-meal-ai":
      showAiProposal("Proposal: use 1/2 cup rice and add 1 tbsp sesame dressing. Review each change before confirming.");
      break;
    case "dismiss-proposal":
      setHidden(document.querySelector("#ai-proposal"), true);
      break;
    case "confirm-proposal":
      setHidden(document.querySelector("#ai-proposal"), true);
      showToast("Proposal confirmed for this mock review.");
      break;
    case "add-ingredient":
      setHidden(extraIngredient, false);
      ingredientCount.textContent = "4 confirmed ingredients";
      mealCalories.textContent = "551 ";
      mealCalories.insertAdjacentHTML("beforeend", "<span>kcal</span>");
      break;
    case "create-food":
      showToast("Manual Food draft opened. Calories and quantity basis are required.");
      break;
    case "save-meal":
      showToast("Meal saved as one reusable assembled unit.");
      break;
    case "save-settings":
      showToast("Daily target updated.");
      break;
    default:
      break;
  }
});

document.querySelector("#food-search")?.addEventListener("input", (event) => filterResults(event.target.value));
savedSearch?.addEventListener("input", (event) => {
  const activeFilter = document.querySelector("[data-library-filter].is-active")?.dataset.libraryFilter || "all";
  filterLibrary(event.target.value, activeFilter);
});

document.addEventListener("click", (event) => {
  if (event.target.classList.contains("overlay")) closeOverlays();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeOverlays();
    return;
  }

  if (event.key !== "Tab") return;
  const activeDialog = [reviewDrawer, sourceLayer, confirmLayer].find((layer) => layer && !layer.hidden);
  if (!activeDialog) return;
  const focusable = [...activeDialog.querySelectorAll("button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

setFixture("normal");
