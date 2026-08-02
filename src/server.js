import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);
const userAgent = process.env.OPEN_FOOD_FACTS_USER_AGENT || "CaloriesBarcodePrototype/1.0 (local test)";

const nutrientDefinitions = [
  { key: "energy-kcal", label: "Calories", unit: "kcal", aliases: ["energy-kcal"] },
  { key: "proteins", label: "Protein", unit: "g", aliases: ["proteins", "protein"] },
  { key: "carbohydrates", label: "Carbohydrates", unit: "g", aliases: ["carbohydrates"] },
  { key: "fiber", label: "Fiber", unit: "g", aliases: ["fiber", "fibers"] },
  { key: "sugars", label: "Sugar", unit: "g", aliases: ["sugars"] },
  { key: "fat", label: "Fat", unit: "g", aliases: ["fat"] },
  { key: "saturated-fat", label: "Saturated fat", unit: "g", aliases: ["saturated-fat"] },
  { key: "sodium", label: "Sodium", unit: "mg", aliases: ["sodium"] },
  { key: "salt", label: "Salt", unit: "g", aliases: ["salt"] },
  { key: "vitamin-a", label: "Vitamin A", unit: "µg", aliases: ["vitamin-a"] },
  { key: "vitamin-c", label: "Vitamin C", unit: "mg", aliases: ["vitamin-c"] },
  { key: "vitamin-d", label: "Vitamin D", unit: "µg", aliases: ["vitamin-d"] },
  { key: "vitamin-e", label: "Vitamin E", unit: "mg", aliases: ["vitamin-e"] },
  { key: "vitamin-b12", label: "Vitamin B12", unit: "µg", aliases: ["vitamin-b12"] },
  { key: "calcium", label: "Calcium", unit: "mg", aliases: ["calcium"] },
  { key: "iron", label: "Iron", unit: "mg", aliases: ["iron"] },
  { key: "potassium", label: "Potassium", unit: "mg", aliases: ["potassium"] },
];

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "../public")));

function normalizeBarcode(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function assertBarcode(value) {
  const barcode = normalizeBarcode(value);

  if (!/^\d{8,14}$/.test(barcode)) {
    throw new Error("Enter an 8–14 digit UPC, EAN, or GTIN barcode.");
  }

  return barcode;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const unitScales = {
  g: 1,
  mg: 1_000,
  "µg": 1_000_000,
  "μg": 1_000_000,
};

function convertUnit(value, sourceUnit, targetUnit) {
  if (!sourceUnit || sourceUnit === targetUnit) return value;

  const sourceScale = unitScales[sourceUnit];
  const targetScale = unitScales[targetUnit];
  if (!sourceScale || !targetScale) return value;

  return value * targetScale / sourceScale;
}

function getNutrientValue(nutriments, aliases, basis, targetUnit) {
  for (const alias of aliases) {
    const value = nutriments?.[`${alias}_${basis}`];
    if (typeof value === "number") {
      return {
        value: convertUnit(value, nutriments[`${alias}_unit`], targetUnit),
        unit: targetUnit,
      };
    }
  }

  return null;
}

function formatValue(value) {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function buildNutrients(product) {
  const nutriments = product.nutriments || {};
  const hasServingValues = nutrientDefinitions.some((definition) =>
    definition.aliases.some((alias) => typeof nutriments[`${alias}_serving`] === "number"),
  );
  const basis = hasServingValues ? "serving" : "100g";

  const rows = nutrientDefinitions
    .map((definition) => ({
      ...definition,
      measurement: getNutrientValue(nutriments, definition.aliases, basis, definition.unit),
      basis,
    }))
    .filter((nutrient) => nutrient.measurement !== null);

  return { basis, rows };
}

async function lookupProduct(value) {
  const barcode = assertBarcode(value);
  const fields = [
    "code",
    "product_name",
    "product_name_en",
    "brands",
    "image_front_url",
    "image_url",
    "ingredients_text",
    "ingredients_text_en",
    "serving_size",
    "nutrition_data_per",
    "nutriments",
  ].join(",");
  const endpoint = new URL(`https://world.openfoodfacts.org/api/v3/product/${barcode}`);
  endpoint.searchParams.set("product_type", "food");
  endpoint.searchParams.set("fields", fields);

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent,
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Food Facts returned HTTP ${response.status}.`);

  const data = await response.json();
  return data.product || null;
}

function renderError(message) {
  return `<section class="result result--error" role="alert">
    <strong>Could not find that product</strong>
    <p>${escapeHtml(message)}</p>
  </section>`;
}

function renderProduct(product) {
  const name = product.product_name || product.product_name_en || "Unnamed product";
  const { basis, rows: nutrients } = buildNutrients(product);
  const basisLabel = basis === "serving"
    ? `per serving${product.serving_size ? ` (${product.serving_size})` : ""}`
    : "per 100 g/ml";
  const imageUrl = product.image_front_url || product.image_url;
  const ingredients = product.ingredients_text || product.ingredients_text_en;

  return `<section class="result" aria-live="polite">
    <div class="product-heading">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" class="product-image">` : ""}
      <div>
        <p class="eyebrow">Barcode ${escapeHtml(product.code)}</p>
        <h2>${escapeHtml(name)}</h2>
        ${product.brands ? `<p class="brand">${escapeHtml(product.brands)}</p>` : ""}
        ${product.serving_size ? `<p class="muted">Serving size: ${escapeHtml(product.serving_size)}</p>` : ""}
      </div>
    </div>
    ${nutrients.length ? `<div class="nutrition-header"><h3>Nutrition</h3><span>${basisLabel}</span></div>
    <dl class="nutrition-grid">
      ${nutrients.map((nutrient) => `<div class="nutrition-item">
        <dt>${escapeHtml(nutrient.label)}</dt>
        <dd>${formatValue(nutrient.measurement.value)} <span>${escapeHtml(nutrient.measurement.unit)}</span></dd>
      </div>`).join("")}
    </dl>` : `<p class="muted">This product was found, but no nutrition values were available.</p>`}
    ${ingredients ? `<details class="ingredients"><summary>Ingredients</summary><p>${escapeHtml(ingredients)}</p></details>` : ""}
  </section>`;
}

app.get("/api/products/:barcode", async (request, response) => {
  try {
    const product = await lookupProduct(request.params.barcode);
    if (!product) return response.status(404).json({ error: "Product not found." });
    return response.json({ product });
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
});

app.post("/lookup", async (request, response) => {
  try {
    const product = await lookupProduct(request.body.barcode);
    if (!product) return response.send(renderError("No product was found for that barcode."));
    return response.send(renderProduct(product));
  } catch (error) {
    return response.send(renderError(error.message));
  }
});

app.listen(port, () => {
  console.log(`Calories barcode prototype running at http://localhost:${port}`);
});
