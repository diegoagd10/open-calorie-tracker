import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";

const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";

const mimeTypes = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const outputSchema = {
  type: "object",
  properties: {
    is_food: {
      type: "boolean",
      description: "Whether the image clearly contains food or a drink containing food.",
    },
    result: {
      type: "string",
      enum: ["food", "no food"],
    },
    ingredients: {
      type: "array",
      items: { type: "string" },
      description: "Ingredients visible or confidently identifiable in the food image.",
    },
  },
  required: ["is_food", "result", "ingredients"],
  additionalProperties: false,
};

function usage() {
  console.error("Usage: pnpm extract <path-to-image>");
  console.error("Supported formats: .jpg, .jpeg, .png, .webp, .gif");
}

async function imageAsDataUrl(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = mimeTypes[extension];

  if (!mimeType) {
    throw new Error(`Unsupported image format: ${extension || "missing extension"}`);
  }

  const image = await fs.readFile(imagePath);
  return `data:${mimeType};base64,${image.toString("base64")}`;
}

async function extractIngredients(imagePath) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and add your API key.");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imageUrl = await imageAsDataUrl(imagePath);

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Analyze this image for food.",
              "",
              "Return is_food=false, result='no food', and an empty ingredients array if the image is not clearly food.",
              "If it is food, return is_food=true, result='food', and list only ingredients that are visible or confidently identifiable.",
              "Do not invent hidden ingredients or rely on a generic recipe unless the image makes them clear.",
            ].join("\n"),
          },
          {
            type: "input_image",
            image_url: imageUrl,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "food_ingredient_extraction",
        strict: true,
        schema: outputSchema,
      },
    },
  });

  if (response.status !== "completed" || !response.output_text) {
    throw new Error(`OpenAI returned an incomplete response (${response.status}).`);
  }

  return JSON.parse(response.output_text);
}

async function main() {
  const imagePath = process.argv[2];

  if (!imagePath) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const result = await extractIngredients(imagePath);

    if (!result.is_food || result.result === "no food") {
      console.log("no food");
      return;
    }

    console.log(JSON.stringify({ ingredients: result.ingredients }, null, 2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
