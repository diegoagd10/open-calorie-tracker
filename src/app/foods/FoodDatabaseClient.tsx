"use client";

import Link from "next/link";
import { type FormEvent, useDeferredValue, useEffect, useState } from "react";
import {
  currentLocalDate,
  scaleNutrition,
  type FoodProduct,
  type NutrientKey,
} from "@/lib/domain";
import styles from "./foods.module.css";

type ProductDraft = Record<"name" | "servingDescription", string> & Record<NutrientKey, string>;
type Flow = "catalog" | "create" | "review" | "confirmed";

const NUTRIENTS: Array<{ key: NutrientKey; label: string; unit: string }> = [
  { key: "caloriesPerServingCal", label: "Calories", unit: "cal" },
  { key: "proteinPerServingG", label: "Protein", unit: "g" },
  { key: "carbsPerServingG", label: "Carbs", unit: "g" },
  { key: "fatPerServingG", label: "Fat", unit: "g" },
  { key: "fiberPerServingG", label: "Fiber", unit: "g" },
  { key: "sugarPerServingG", label: "Sugar", unit: "g" },
  { key: "sodiumPerServingMg", label: "Sodium", unit: "mg" },
];

const EMPTY_DRAFT: ProductDraft = {
  name: "",
  servingDescription: "",
  caloriesPerServingCal: "",
  proteinPerServingG: "",
  carbsPerServingG: "",
  fatPerServingG: "",
  fiberPerServingG: "",
  sugarPerServingG: "",
  sodiumPerServingMg: "",
};

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function productToDraft(product: FoodProduct): ProductDraft {
  return {
    name: product.name,
    servingDescription: product.servingDescription,
    caloriesPerServingCal: String(product.caloriesPerServingCal),
    proteinPerServingG: String(product.proteinPerServingG),
    carbsPerServingG: String(product.carbsPerServingG),
    fatPerServingG: String(product.fatPerServingG),
    fiberPerServingG: String(product.fiberPerServingG),
    sugarPerServingG: String(product.sugarPerServingG),
    sodiumPerServingMg: String(product.sodiumPerServingMg),
  };
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.error ?? "The request could not be completed";
  } catch {
    return "The request could not be completed";
  }
}

function ProductForm({
  draft,
  editing,
  isSaving,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: ProductDraft;
  editing: boolean;
  isSaving: boolean;
  onChange: (key: keyof ProductDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form className={styles.productForm} onSubmit={onSubmit} noValidate>
      <div className={styles.panelHeading}>
        <div><span>{editing ? "Edit reusable product" : "New reusable product"}</span><h2>{editing ? "Change the serving" : "Create a serving"}</h2></div>
        <button className={styles.textButton} type="button" onClick={onCancel}>Cancel</button>
      </div>
      <p className={styles.formCopy}>Nutrition is entered for one serving. The serving description is stored as text and is not parsed or converted.</p>
      <div className={styles.formGrid}>
        <label className={styles.fieldLabel}>Food name<input value={draft.name} onChange={(event) => onChange("name", event.target.value)} placeholder="e.g. Greek yogurt" required /></label>
        <label className={styles.fieldLabel}>Serving description<input value={draft.servingDescription} onChange={(event) => onChange("servingDescription", event.target.value)} placeholder="e.g. 1 cup" required /></label>
      </div>
      <div className={styles.nutrientFields}>
        {NUTRIENTS.map((nutrient) => (
          <label className={styles.fieldLabel} key={nutrient.key}>{nutrient.label} ({nutrient.unit})<input type="number" min="0" step="any" inputMode="decimal" value={draft[nutrient.key]} onChange={(event) => onChange(nutrient.key, event.target.value)} required /></label>
        ))}
      </div>
      <button className={styles.primaryButton} type="submit" disabled={isSaving}>{isSaving ? "Saving product…" : editing ? "Save product" : "Save product and review"}</button>
    </form>
  );
}

function Review({
  product,
  quantity,
  isSaving,
  onQuantity,
  onBack,
  onConfirm,
}: {
  product: FoodProduct;
  quantity: string;
  isSaving: boolean;
  onQuantity: (value: string) => void;
  onBack: () => void;
  onConfirm: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const numericQuantity = Number(quantity);
  const preview = Number.isFinite(numericQuantity) && numericQuantity > 0 ? scaleNutrition(product, numericQuantity) : null;

  return (
    <form className={styles.review} onSubmit={onConfirm} noValidate>
      <div className={styles.panelHeading}>
        <div><span>One explicit confirmation</span><h2>Review before adding</h2></div>
        <button className={styles.textButton} type="button" onClick={onBack}>Change food</button>
      </div>
      <div className={styles.selectedProduct}><strong>{product.name}</strong><span>{product.servingDescription} · nutrition per serving</span></div>
      <label className={styles.fieldLabel}>How many servings?<div className={styles.quantityField}><input type="number" min="0.01" step="any" inputMode="decimal" value={quantity} onChange={(event) => onQuantity(event.target.value)} required /><b>servings</b></div></label>
      <div className={styles.preview} aria-live="polite">
        <div className={styles.previewHeading}><span>Calculated snapshot</span><small>Review values before persistence</small></div>
        {preview ? <dl>{NUTRIENTS.map((nutrient) => <div key={nutrient.key}><dt>{nutrient.label}</dt><dd>{formatNumber(preview[nutrient.key])} {nutrient.unit}</dd></div>)}</dl> : <p className={styles.empty}>Enter a positive serving quantity to calculate the preview.</p>}
      </div>
      <button className={styles.primaryButton} type="submit" disabled={isSaving || !preview}>{isSaving ? "Adding to day…" : "Confirm and add to log"}</button>
    </form>
  );
}

export default function FoodDatabaseClient({ initialDate }: { initialDate?: string }) {
  const hasReturnContext = Boolean(initialDate);
  const [date, setDate] = useState(initialDate ?? currentLocalDate());
  const [products, setProducts] = useState<FoodProduct[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<FoodProduct | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [flow, setFlow] = useState<Flow>("catalog");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setIsLoading(true);
      fetch(`/api/v1/products?query=${encodeURIComponent(deferredQuery)}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(await responseError(response));
          const body = await response.json();
          setProducts(body.products);
          setError("");
        })
        .catch((requestError: Error) => {
          if (requestError.name !== "AbortError") setError(requestError.message);
        })
        .finally(() => setIsLoading(false));
    }, 160);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [deferredQuery]);

  function updateDraft(key: keyof ProductDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function startNewProduct() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFlow("create");
    setNotice("");
    setError("");
  }

  function startEditing(product: FoodProduct) {
    setEditingId(product.id);
    setDraft(productToDraft(product));
    setFlow("create");
    setNotice("");
    setError("");
  }

  function selectProduct(product: FoodProduct) {
    setSelectedProduct(product);
    setQuantity("1");
    setFlow("review");
    setNotice("");
    setError("");
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(editingId ? `/api/v1/products/${editingId}` : "/api/v1/products", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const product: FoodProduct = await response.json();
      setProducts((current) => editingId ? current.map((item) => item.id === product.id ? product : item) : [product, ...current]);
      if (editingId) {
        setNotice(`${product.name} was updated for future entries. Existing snapshots stay unchanged.`);
        setFlow("catalog");
      } else if (hasReturnContext) {
        setSelectedProduct(product);
        setQuantity("1");
        setFlow("review");
      } else {
        setFlow("catalog");
        setNotice(`${product.name} is saved in your Food Database.`);
      }
      setEditingId(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save product");
    } finally {
      setIsSaving(false);
    }
  }

  async function retireProduct(product: FoodProduct) {
    if (!window.confirm(`Remove ${product.name} from future selection? Existing logs stay intact.`)) return;
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/products/${product.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response));
      setProducts((current) => current.filter((item) => item.id !== product.id));
      if (selectedProduct?.id === product.id) setSelectedProduct(null);
      setNotice(`${product.name} was retired. Historical snapshots were not changed.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not retire product");
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct) return;
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/food-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, productId: selectedProduct.id, quantity: Number(quantity) }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setFlow("confirmed");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not add this food");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/"><span className={styles.mark} aria-hidden="true"><span /><span /><span /></span><span>Daily Intake</span></Link>
        <nav className={styles.nav}><Link href="/">Daily Log</Link><span>Food Database</span><Link href="/settings/targets">Settings</Link></nav>
      </header>
      <div className={styles.intro}>
        <div><h1>Food Database</h1><p>Keep serving-based products reusable. Select one, enter the quantity, and review the math before it becomes a dated snapshot.</p></div>
        <label className={styles.dateControl}><span>Log to date</span><input type="date" value={date} max={currentLocalDate()} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      <div className={styles.layout}>
        <section className={styles.catalog} aria-labelledby="catalog-heading">
          <div className={styles.sectionHeading}><div><h2 id="catalog-heading">Saved products</h2><span>{products.length} active product{products.length === 1 ? "" : "s"}</span></div><button className={styles.secondaryButton} type="button" onClick={startNewProduct}>+ Add new food</button></div>
          <label className={styles.searchLabel} htmlFor="product-search">Search active products</label>
          <input className={styles.search} id="product-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try yogurt, oats, or chicken" />
          {isLoading ? <p className={styles.empty} role="status">Loading saved products…</p> : products.length === 0 ? <div className={styles.empty}><strong>{query.trim() ? "No active product matches." : "Your database is empty."}</strong><span>{query.trim() ? "Try another search or create a new product." : "Create your first serving to make future entries faster."}</span></div> : <ul className={styles.productList}>{products.map((product) => <li className={styles.productRow} key={product.id}><button type="button" onClick={() => selectProduct(product)}><span><strong>{product.name}</strong><small>{product.servingDescription} · per serving</small></span><b>{formatNumber(product.caloriesPerServingCal, 0)} cal</b></button><div className={styles.rowActions}><button type="button" onClick={() => startEditing(product)}>Edit</button><button type="button" onClick={() => retireProduct(product)} disabled={isSaving}>Retire</button></div></li>)}</ul>}
        </section>
        <section className={styles.workbench} aria-live="polite">
          {flow === "catalog" && <div className={styles.workbenchEmpty}><span>Choose a product or start from a blank serving.</span><h2>The review stays here.</h2><p>Nothing is added to the ledger until you confirm the calculated snapshot.</p><button className={styles.primaryButton} type="button" onClick={startNewProduct}>Create a new food</button></div>}
          {flow === "create" && <ProductForm draft={draft} editing={Boolean(editingId)} isSaving={isSaving} onChange={updateDraft} onSubmit={saveProduct} onCancel={() => { setFlow("catalog"); setEditingId(null); }} />}
          {flow === "review" && selectedProduct && <Review product={selectedProduct} quantity={quantity} isSaving={isSaving} onQuantity={setQuantity} onBack={() => setFlow("catalog")} onConfirm={confirmEntry} />}
          {flow === "confirmed" && selectedProduct && <div className={styles.confirmed}><span>Added to {date}</span><h2>{selectedProduct.name} is in the log.</h2><p>This entry is an independent snapshot. Editing or retiring the product later will not rewrite it.</p><div><Link className={styles.primaryButton} href={`/?date=${date}`}>Return to Daily Log</Link><button className={styles.secondaryButton} type="button" onClick={() => { setFlow("catalog"); setSelectedProduct(null); }}>Add another</button></div></div>}
        </section>
      </div>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
