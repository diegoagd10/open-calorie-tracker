# Node backend framework research

Date: 2026-08-01

## Decision context

The prototype needs a small Node.js backend, an HTML/HTMX interface, and one server-side route that accepts a barcode number and calls a food-product API. The current repository is an ESM Node CLI, so the prototype should keep the first version small and avoid introducing a larger application architecture before it is needed.

## Adoption signal

The 2025 State of JavaScript back-end framework survey reports that Express remains the usage leader, with NestJS progressing. As an additional ecosystem signal, npm currently reports approximately 123 million weekly downloads for `express`, 12.9 million for `@nestjs/core`, 10.2 million for `fastify`, and 44.7 million for `hono`. npm download counts are not a direct measure of production applications, so they should be treated as directional rather than definitive.

Sources:

- [State of JavaScript 2025: Back-end Frameworks](https://2025.stateofjs.com/en-US/libraries/back-end-frameworks/)
- [express on npm](https://www.npmjs.com/package/express)
- [@nestjs/core on npm](https://www.npmjs.com/package/@nestjs/core)
- [fastify on npm](https://www.npmjs.com/package/fastify)
- [hono on npm](https://www.npmjs.com/package/hono)

## Framework comparison

### Express

Express describes itself as a minimal and flexible Node.js framework with routing, HTTP helpers, static-file support, and a large middleware ecosystem. Its small core fits a single HTML form and one API route well, and its market prevalence makes examples, troubleshooting, and hiring familiar.

Sources:

- [Express home](https://expressjs.com/?lang=node)
- [Express FAQ: serving static files](https://expressjs.com/en/starter/faq.html)

### Fastify

Fastify is designed around low overhead, plugins, JSON Schema validation, and structured logging. It is a strong choice when the application is primarily an API or when throughput and route schemas are important. For this HTMX prototype, its advantages are useful but not necessary; it introduces a little more framework-specific setup than Express for a very small server.

Sources:

- [Fastify home](https://fastify.dev/)
- [Fastify technical principles](https://fastify.dev/docs/latest/Reference/Principles/)
- [Fastify npm package](https://www.npmjs.com/package/fastify)

### NestJS

NestJS is a higher-level, TypeScript-first framework that runs on Express by default and can use Fastify through an adapter. Its modules, dependency injection, and conventions are useful for a larger team or a multi-feature application, but they are more structure than this first test needs.

Source:

- [NestJS large-scale applications guide](https://docs.nestjs.com/guide/large-scale-apps)

### Hono

Hono is a small Web Standards-based framework that runs across multiple runtimes, including Node.js through an adapter. It is attractive for edge/serverless portability and lightweight APIs, but it is not the market-default Node choice for this prototype and would add a runtime-portability concern we do not currently need.

Sources:

- [Hono documentation](https://hono.dev/docs)
- [Hono Web Standards and Node.js adapter](https://hono.dev/docs/concepts/web-standard)

## Recommendation

Use **Express 5 with plain JavaScript/ESM** for the first prototype. It is the strongest match for the stated requirement of a small, understandable web page with an HTMX UI, while also being the most broadly used Node backend option in the sources reviewed. Use Node's built-in `fetch` for the server-side Open Food Facts request, serve the HTML with `express.static`, and return an HTML fragment from the lookup route for HTMX to insert.

This recommendation is intentionally limited to the prototype. If the application grows into a large TypeScript codebase with multiple domains and teams, revisit NestJS. If API throughput, schema validation, or service boundaries become primary concerns, revisit Fastify.

## API integration notes

Open Food Facts' current API is v3 and supports retrieving a product by barcode with selected fields. Product reads do not require credentials, but the API asks clients to send an identifying User-Agent and publishes per-IP rate limits. The database is community-maintained, so the application should handle missing products and incomplete nutrition fields.

Sources:

- [Open Food Facts: get product by barcode](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/)
- [Open Food Facts API introduction and rate limits](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/)

USDA FoodData Central is a reasonable fallback for branded foods. Its documentation says users can search branded records by GTIN, and its API requires a `data.gov` key. Keep that key on the backend rather than exposing it in HTMX/browser code.

Sources:

- [USDA FoodData Central help: GTIN](https://fdc.nal.usda.gov/help/)
- [USDA FoodData Central API guide](https://fdc.nal.usda.gov/api-guide/)

HTMX can issue a GET or POST directly from form attributes and replace a target element with the returned HTML fragment, which matches the prototype's interaction model.

Source:

- [HTMX documentation](https://htmx.org/docs/)

