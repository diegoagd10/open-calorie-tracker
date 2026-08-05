"use client";

/* PROTOTYPE: Three food-entry flow variants, switchable with ?variant=A|B|C. */

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./prototype.module.css";

type Variant = "A" | "B" | "C";
type Flow =
  | "closed"
  | "sources"
  | "database"
  | "create"
  | "review"
  | "confirmed";
type NutrientKey =
  | "calories"
  | "protein"
  | "carbs"
  | "fat"
  | "fiber"
  | "sugar"
  | "sodium";

type Product = {
  id: string;
  name: string;
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
};

type LogEntry = Omit<Product, "id"> & {
  id: number;
  quantity: number;
};

type ProductDraft = Record<"name" | "description", string> &
  Record<NutrientKey, string>;

const EMPTY_PRODUCT_DRAFT: ProductDraft = {
  name: "",
  description: "",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
  fiber: "",
  sugar: "",
  sodium: "",
};

const PRODUCTS: Product[] = [
  {
    id: "greek-yogurt",
    name: "Greek yogurt",
    description: "1 cup",
    calories: 140,
    protein: 16,
    carbs: 9,
    fat: 0.5,
    fiber: 0,
    sugar: 6,
    sodium: 65,
  },
  {
    id: "rolled-oats",
    name: "Rolled oats",
    description: "1/2 cup dry",
    calories: 150,
    protein: 5,
    carbs: 27,
    fat: 3,
    fiber: 4,
    sugar: 1,
    sodium: 0,
  },
  {
    id: "chicken-breast",
    name: "Chicken breast",
    description: "3 oz cooked",
    calories: 140,
    protein: 26,
    carbs: 0,
    fat: 3,
    fiber: 0,
    sugar: 0,
    sodium: 60,
  },
  {
    id: "peanut-butter",
    name: "Peanut butter",
    description: "2 tbsp",
    calories: 190,
    protein: 8,
    carbs: 7,
    fat: 16,
    fiber: 2,
    sugar: 3,
    sodium: 150,
  },
];

const INITIAL_LOG: LogEntry[] = [
  { ...PRODUCTS[0], id: 1, quantity: 1 },
  { ...PRODUCTS[1], id: 2, quantity: 0.5 },
];

const NUTRIENTS: Array<{ key: NutrientKey; label: string; unit: string }> = [
  { key: "calories", label: "Calories", unit: "cal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
  { key: "fiber", label: "Fiber", unit: "g" },
  { key: "sugar", label: "Sugar", unit: "g" },
  { key: "sodium", label: "Sodium", unit: "mg" },
];

const VARIANT_NAMES: Record<Variant, string> = {
  A: "Centered review",
  B: "Side-by-side drawer",
  C: "Inline workbench",
};

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function scaledNutrients(
  product: Product,
  quantity: number,
): Record<NutrientKey, number> {
  return NUTRIENTS.reduce(
    (values, nutrient) => {
      values[nutrient.key] = product[nutrient.key] * quantity;
      return values;
    },
    {} as Record<NutrientKey, number>,
  );
}

function useFoodEntryFlow(initialVariant: Variant) {
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [flow, setFlow] = useState<Flow>("closed");
  const [products, setProducts] = useState(PRODUCTS);
  const [query, setQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [logs, setLogs] = useState(INITIAL_LOG);
  const [productDraft, setProductDraft] =
    useState<ProductDraft>(EMPTY_PRODUCT_DRAFT);

  function changeVariant(next: Variant) {
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const index = ["A", "B", "C"].indexOf(variant);
      const next = ["A", "B", "C"][(index + direction + 3) % 3] as Variant;
      changeVariant(next);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [variant]);

  function openFlow() {
    setFlow("sources");
    setQuery("");
    setSelectedProduct(null);
    setQuantity("1");
    setProductDraft(EMPTY_PRODUCT_DRAFT);
  }

  function closeFlow() {
    setFlow("closed");
    setQuery("");
    setSelectedProduct(null);
    setQuantity("1");
    setProductDraft(EMPTY_PRODUCT_DRAFT);
  }

  function chooseDatabase() {
    setFlow("database");
  }

  function openCreate() {
    setProductDraft(EMPTY_PRODUCT_DRAFT);
    setFlow("create");
  }

  function updateProductDraft(
    field: keyof ProductDraft,
    value: string,
  ) {
    setProductDraft((current) => ({ ...current, [field]: value }));
  }

  function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productDraft.name.trim() || !productDraft.description.trim()) return;

    const product: Product = {
      id: `manual-${Date.now()}`,
      name: productDraft.name.trim(),
      description: productDraft.description.trim(),
      calories: Number(productDraft.calories) || 0,
      protein: Number(productDraft.protein) || 0,
      carbs: Number(productDraft.carbs) || 0,
      fat: Number(productDraft.fat) || 0,
      fiber: Number(productDraft.fiber) || 0,
      sugar: Number(productDraft.sugar) || 0,
      sodium: Number(productDraft.sodium) || 0,
    };

    setProducts((current) => [product, ...current]);
    setSelectedProduct(product);
    setQuantity("1");
    setFlow("review");
  }

  function chooseProduct(product: Product) {
    setSelectedProduct(product);
    setQuantity("1");
    setFlow("review");
  }

  function goBack() {
    if (flow === "database") {
      setFlow("sources");
    } else if (flow === "create") {
      setFlow("database");
    } else if (flow === "review") {
      setFlow("database");
    }
  }

  function confirmEntry(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedProduct) return;

    const numericQuantity = Number.parseFloat(quantity);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) return;

    setLogs((current) => [
      {
        ...selectedProduct,
        id: Date.now(),
        quantity: numericQuantity,
      },
      ...current,
    ]);
    setFlow("confirmed");
  }

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const numericQuantity = Number.parseFloat(quantity);
  const preview =
    selectedProduct && Number.isFinite(numericQuantity) && numericQuantity > 0
      ? scaledNutrients(selectedProduct, numericQuantity)
      : null;

  return {
    variant,
    flow,
    query,
    selectedProduct,
    quantity,
    logs,
    filteredProducts,
    preview,
    changeVariant,
    openFlow,
    closeFlow,
    chooseDatabase,
    openCreate,
    createProduct,
    chooseProduct,
    goBack,
    confirmEntry,
    setQuery,
    setQuantity,
    productDraft,
    updateProductDraft,
  };
}

type FlowState = ReturnType<typeof useFoodEntryFlow>;

function PrototypeHeader({ variant }: { variant: Variant }) {
  return (
    <header className={styles.prototypeHeader}>
      <div className={styles.wordmark}>
        <span className={styles.wordmarkMark} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>Daily Intake</span>
        <span className={styles.prototypeTag}>Prototype</span>
      </div>
      <div className={styles.headerMeta}>
        <span>Food entry flow</span>
        <Link href="/">Exit prototype</Link>
        <span className={styles.variantCode}>Variant {variant}</span>
      </div>
    </header>
  );
}

function DayMasthead({ logs }: { logs: LogEntry[] }) {
  const calories = logs.reduce(
    (total, entry) => total + entry.calories * entry.quantity,
    0,
  );
  const protein = logs.reduce(
    (total, entry) => total + entry.protein * entry.quantity,
    0,
  );

  return (
    <div className={styles.dayMasthead}>
      <div>
        <p className={styles.dateLine}>Tuesday, August 4, 2026</p>
        <h1>Build today&apos;s ledger</h1>
        <p className={styles.mastheadCopy}>
          Add a saved food, review the serving math, then place the snapshot on
          this date.
        </p>
      </div>
      <div className={styles.dayTotals}>
        <div>
          <span>Calories</span>
          <strong>{formatNumber(calories, 0)}</strong>
          <small>/ 1,600 cal limit</small>
        </div>
        <div>
          <span>Protein</span>
          <strong>{formatNumber(protein)} g</strong>
          <small>/ 140 g minimum</small>
        </div>
      </div>
    </div>
  );
}

function TargetStrip() {
  return (
    <div className={styles.targetStrip} aria-label="Daily target snapshot">
      <div>
        <span>Carbs</span>
        <strong>34 / 200 g</strong>
        <em>within limit</em>
      </div>
      <div>
        <span>Fat</span>
        <strong>3.5 / 53 g</strong>
        <em>30% calorie limit</em>
      </div>
      <div>
        <span>Water</span>
        <strong>4 / 8 glasses</strong>
        <em>32 / 64 fl oz</em>
      </div>
      <div>
        <span>Weight</span>
        <strong>182.4 lb</strong>
        <em>Target: 170 lb</em>
      </div>
    </div>
  );
}

function FoodLog({ logs }: { logs: LogEntry[] }) {
  return (
    <section className={styles.foodLog} aria-labelledby="food-log-heading">
      <div className={styles.sectionHeading}>
        <h2 id="food-log-heading">Food log</h2>
        <span>{logs.length} saved entries</span>
      </div>
      <ol>
        {logs.map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>{entry.name}</strong>
              <span>
                {formatNumber(entry.quantity)} {entry.quantity === 1 ? "serving" : "servings"} · {entry.description}
              </span>
            </div>
            <b>{formatNumber(entry.calories * entry.quantity, 0)} cal</b>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AddFoodButton({ onClick }: { onClick: () => void }) {
  return (
    <button className={styles.addFoodButton} type="button" onClick={onClick}>
      <span aria-hidden="true">+</span>
      <span>Add food</span>
    </button>
  );
}

function SourceChoices({ onDatabase }: { onDatabase: () => void }) {
  return (
    <div className={styles.sourceChoices}>
      <button
        className={styles.sourceChoice}
        type="button"
        onClick={onDatabase}
      >
        <span>
          <strong>Food Database</strong>
          <small>Search your saved products</small>
        </span>
        <b>Open</b>
      </button>
      <button className={styles.sourceChoiceDisabled} type="button" disabled>
        <span>
          <strong>Favorite Foods</strong>
          <small>Fast repeat entries</small>
        </span>
        <b>Later</b>
      </button>
      <button className={styles.sourceChoiceDisabled} type="button" disabled>
        <span>
          <strong>Scan Food</strong>
          <small>Barcode and label capture</small>
        </span>
        <b>Later</b>
      </button>
    </div>
  );
}

function DatabaseStep({ state, inputId }: { state: FlowState; inputId: string }) {
  return (
    <div className={styles.databaseStep}>
      <div className={styles.stepHeading}>
        <button className={styles.backButton} type="button" onClick={state.goBack}>
          Back
        </button>
        <div>
          <span>Food Database</span>
          <h3>Which food are you adding?</h3>
        </div>
      </div>
      <label htmlFor={inputId}>Search products</label>
      <input
        id={inputId}
        className={styles.searchInput}
        type="search"
        value={state.query}
        onChange={(event) => state.setQuery(event.target.value)}
        placeholder="Try yogurt, oats, or chicken"
        autoFocus
      />
      <div className={styles.resultList} role="listbox" aria-label="Products">
        {state.filteredProducts.length === 0 ? (
          <div className={styles.noResults}>
            <strong>No saved food matches that search.</strong>
            <span>Create the product manually in the Food Database to use it
              here.</span>
          </div>
        ) : (
          state.filteredProducts.map((product) => (
            <button
              className={styles.productResult}
              key={product.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => state.chooseProduct(product)}
            >
              <span>
                <strong>{product.name}</strong>
                <small>{product.description} · per serving</small>
              </span>
              <b>{formatNumber(product.calories, 0)} cal</b>
            </button>
          ))
        )}
      </div>
      <button className={styles.textAction} type="button" onClick={state.openCreate}>
        + Create a new food in the database
      </button>
    </div>
  );
}

function ManualProductStep({ state }: { state: FlowState }) {
  return (
    <form className={styles.manualProductStep} onSubmit={state.createProduct}>
      <div className={styles.stepHeading}>
        <button className={styles.backButton} type="button" onClick={state.goBack}>
          Back
        </button>
        <div>
          <span>Food Database</span>
          <h3>Create a serving</h3>
        </div>
      </div>
      <p className={styles.formNote}>
        Enter the label values for one serving. This manual product becomes
        available for future dates after it is saved.
      </p>
      <div className={styles.productFields}>
        <label>
          Food name
          <input
            type="text"
            value={state.productDraft.name}
            onChange={(event) => state.updateProductDraft("name", event.target.value)}
            placeholder="e.g. Greek yogurt"
            required
          />
        </label>
        <label>
          Serving description
          <input
            type="text"
            value={state.productDraft.description}
            onChange={(event) => state.updateProductDraft("description", event.target.value)}
            placeholder="e.g. 1 cup"
            required
          />
        </label>
      </div>
      <div className={styles.productFields}>
        {NUTRIENTS.map((nutrient) => (
          <label key={nutrient.key}>
            {nutrient.label} ({nutrient.unit})
            <input
              type="number"
              min="0"
              step="0.1"
              value={state.productDraft[nutrient.key]}
              onChange={(event) =>
                state.updateProductDraft(nutrient.key, event.target.value)
              }
              required
            />
          </label>
        ))}
      </div>
      <button className={styles.confirmButton} type="submit">
        Save food and review
      </button>
    </form>
  );
}

function NutritionPreview({ preview }: { preview: Record<NutrientKey, number> }) {
  return (
    <div className={styles.nutritionPreview}>
      <div className={styles.previewHeading}>
        <span>Review snapshot</span>
        <small>Calculated for this quantity</small>
      </div>
      <div className={styles.nutrientGrid}>
        {NUTRIENTS.map((nutrient) => (
          <div key={nutrient.key}>
            <span>{nutrient.label}</span>
            <strong>
              {formatNumber(preview[nutrient.key])} {nutrient.unit}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewStep({ state, inputId }: { state: FlowState; inputId: string }) {
  if (!state.selectedProduct || !state.preview) return null;

  return (
    <form className={styles.reviewStep} onSubmit={state.confirmEntry}>
      <div className={styles.stepHeading}>
        <button className={styles.backButton} type="button" onClick={state.goBack}>
          Back
        </button>
        <div>
          <span>Food Database</span>
          <h3>Review before adding</h3>
        </div>
      </div>
      <div className={styles.selectedProduct}>
        <div>
          <span>Selected food</span>
          <strong>{state.selectedProduct.name}</strong>
          <small>{state.selectedProduct.description} · nutrition per serving</small>
        </div>
        <button className={styles.changeButton} type="button" onClick={state.goBack}>
          Change
        </button>
      </div>
      <label htmlFor={inputId}>How many servings?</label>
      <div className={styles.quantityField}>
        <input
          id={inputId}
          type="number"
          min="0.1"
          step="0.1"
          value={state.quantity}
          onChange={(event) => state.setQuantity(event.target.value)}
        />
        <span>servings</span>
      </div>
      <NutritionPreview preview={state.preview} />
      <button className={styles.confirmButton} type="submit">
        Add to Tuesday&apos;s log
      </button>
    </form>
  );
}

function ConfirmedStep({ state }: { state: FlowState }) {
  return (
    <div className={styles.confirmedStep} role="status" aria-live="polite">
      <span className={styles.confirmedMark}>Added to the ledger</span>
      <h3>{state.selectedProduct?.name} is in today&apos;s log.</h3>
      <p>
        The entry is now a snapshot. Updating the product later will not rewrite
        this date.
      </p>
      <button className={styles.confirmButton} type="button" onClick={state.openFlow}>
        Add another food
      </button>
    </div>
  );
}

function ModalFlow({ state }: { state: FlowState }) {
  return (
    <div className={styles.modalBackdrop}>
      <section className={styles.modalPanel} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className={styles.modalHeader}>
          <div>
            <span>Tuesday, August 4</span>
            <h2 id="modal-title">Add food</h2>
          </div>
          <button className={styles.closeButton} type="button" onClick={state.closeFlow}>
            Close
          </button>
        </div>
        {state.flow === "sources" && (
          <div className={styles.modalStep}>
            <p className={styles.flowPrompt}>Choose how this food gets here.</p>
            <SourceChoices onDatabase={state.chooseDatabase} />
          </div>
        )}
        {state.flow === "database" && (
          <DatabaseStep state={state} inputId="modal-product-search" />
        )}
        {state.flow === "create" && <ManualProductStep state={state} />}
        {state.flow === "review" && (
          <ReviewStep state={state} inputId="modal-quantity" />
        )}
        {state.flow === "confirmed" && <ConfirmedStep state={state} />}
      </section>
    </div>
  );
}

function VariantA({ state }: { state: FlowState }) {
  return (
    <div className={styles.variantA}>
      <div className={styles.variantATopline}>
        <span>One focused addition at a time</span>
        <AddFoodButton onClick={state.openFlow} />
      </div>
      <DayMasthead logs={state.logs} />
      <TargetStrip />
      <FoodLog logs={state.logs} />
      {state.flow !== "closed" && <ModalFlow state={state} />}
    </div>
  );
}

function DrawerFlow({ state }: { state: FlowState }) {
  return (
    <aside className={styles.drawer} aria-label="Add food drawer">
      <div className={styles.drawerHeader}>
        <div>
          <span>Add to Tuesday&apos;s log</span>
          <h2>Food entry</h2>
        </div>
        <button className={styles.closeButton} type="button" onClick={state.closeFlow}>
          Close
        </button>
      </div>
      <div className={styles.drawerBody}>
        {state.flow === "sources" && (
          <>
            <p className={styles.flowPrompt}>Start with a source.</p>
            <SourceChoices onDatabase={state.chooseDatabase} />
          </>
        )}
        {state.flow === "database" && (
          <DatabaseStep state={state} inputId="drawer-product-search" />
        )}
        {state.flow === "create" && <ManualProductStep state={state} />}
        {state.flow === "review" && (
          <ReviewStep state={state} inputId="drawer-quantity" />
        )}
        {state.flow === "confirmed" && <ConfirmedStep state={state} />}
      </div>
    </aside>
  );
}

function VariantB({ state }: { state: FlowState }) {
  return (
    <div className={styles.variantB}>
      <aside className={styles.sectionRail}>
        <span className={styles.railLabel}>Selected day</span>
        <strong>Tuesday<br />August 4</strong>
        <div className={styles.railRule} />
        <span className={styles.railLabel}>Day total</span>
        <strong className={styles.railTotal}>290 <small>cal</small></strong>
        <div className={styles.railActions}>
          <AddFoodButton onClick={state.openFlow} />
          <button className={styles.railLink} type="button">Water log</button>
          <button className={styles.railLink} type="button">Weight trend</button>
        </div>
      </aside>
      <section className={styles.drawerStage}>
        <div className={styles.drawerStageHeader}>
          <div>
            <p className={styles.dateLine}>Daily record</p>
            <h1>Tuesday stays visible</h1>
          </div>
          <span className={styles.stageHint}>The drawer keeps the ledger in view.</span>
        </div>
        <TargetStrip />
        <FoodLog logs={state.logs} />
        {state.flow !== "closed" && <DrawerFlow state={state} />}
      </section>
    </div>
  );
}

function InlineSources({ onDatabase }: { onDatabase: () => void }) {
  return (
    <div className={styles.inlineSources}>
      <button type="button" onClick={onDatabase}>
        <strong>Food Database</strong>
        <span>Search saved products</span>
      </button>
      <button type="button" disabled>
        <strong>Favorite Foods</strong>
        <span>Coming later</span>
      </button>
      <button type="button" disabled>
        <strong>Scan Food</strong>
        <span>Coming later</span>
      </button>
    </div>
  );
}

function InlineFlow({ state }: { state: FlowState }) {
  return (
    <section className={styles.inlineFlow} aria-label="Inline food entry">
      <div className={styles.inlineFlowHeader}>
        <div>
          <span>New ledger line</span>
          <h2>What belongs on this date?</h2>
        </div>
        <button className={styles.closeButton} type="button" onClick={state.closeFlow}>
          Cancel
        </button>
      </div>
      {state.flow === "sources" && (
        <InlineSources onDatabase={state.chooseDatabase} />
      )}
      {state.flow === "database" && (
        <DatabaseStep state={state} inputId="inline-product-search" />
      )}
      {state.flow === "create" && <ManualProductStep state={state} />}
      {state.flow === "review" && (
        <ReviewStep state={state} inputId="inline-quantity" />
      )}
      {state.flow === "confirmed" && <ConfirmedStep state={state} />}
    </section>
  );
}

function VariantC({ state }: { state: FlowState }) {
  return (
    <div className={styles.variantC}>
      <div className={styles.commandLine}>
        <div>
          <span className={styles.commandLabel}>Tuesday / food ledger</span>
          <h1>Compose the day</h1>
        </div>
        <AddFoodButton onClick={state.openFlow} />
      </div>
      <div className={styles.workbench}>
        <section className={styles.timeline}>
          <div className={styles.timelineHeader}>
            <div>
              <span>Running record</span>
              <h2>Food log</h2>
            </div>
            <strong>{formatNumber(290, 0)} cal</strong>
          </div>
          <FoodLog logs={state.logs} />
        </section>
        <aside className={styles.daySidebar}>
          <span className={styles.sidebarLabel}>Today at a glance</span>
          <div className={styles.sidebarMetric}>
            <strong>290</strong>
            <span>calories</span>
          </div>
          <div className={styles.sidebarMetric}>
            <strong>4 / 8</strong>
            <span>glasses of water</span>
          </div>
          <div className={styles.sidebarMetric}>
            <strong>182.4 lb</strong>
            <span>current weight</span>
          </div>
          <div className={styles.sidebarTargets}>
            <span>Targets</span>
            <p>1,600 cal max</p>
            <p>140 g protein min</p>
            <p>64 fl oz water min</p>
          </div>
        </aside>
      </div>
      {state.flow !== "closed" && <InlineFlow state={state} />}
    </div>
  );
}

function PrototypeSwitcher({ state }: { state: FlowState }) {
  if (process.env.NODE_ENV === "production") return null;

  const variants: Variant[] = ["A", "B", "C"];
  const index = variants.indexOf(state.variant);
  const previous = variants[(index + variants.length - 1) % variants.length];
  const next = variants[(index + 1) % variants.length];

  return (
    <nav className={styles.prototypeSwitcher} aria-label="Prototype variants">
      <button type="button" onClick={() => state.changeVariant(previous)}>
        Previous
      </button>
      <span>
        <strong>Variant {state.variant}</strong>
        <small>{VARIANT_NAMES[state.variant]}</small>
      </span>
      <button type="button" onClick={() => state.changeVariant(next)}>
        Next
      </button>
    </nav>
  );
}

export default function FoodEntryPrototype({
  initialVariant,
}: {
  initialVariant: Variant;
}) {
  const state = useFoodEntryFlow(initialVariant);

  return (
    <main className={styles.prototypePage}>
      <PrototypeHeader variant={state.variant} />
      <div className={styles.prototypeIntro}>
        <p>Three ways to add one saved food to a daily record.</p>
        <span>Read-only prototype · in-memory state · serving-based products</span>
      </div>
      {state.variant === "A" && <VariantA state={state} />}
      {state.variant === "B" && <VariantB state={state} />}
      {state.variant === "C" && <VariantC state={state} />}
      <PrototypeSwitcher state={state} />
    </main>
  );
}
