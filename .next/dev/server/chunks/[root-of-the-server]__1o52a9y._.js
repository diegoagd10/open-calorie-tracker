module.exports = [
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:fs [external] (node:fs, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:fs", () => require("node:fs"));

module.exports = mod;
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[project]/src/app/api/entries/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "POST",
    ()=>POST,
    "runtime",
    ()=>runtime
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$calories$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/calories.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$database$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/database.ts [app-route] (ecmascript)");
;
;
const runtime = "nodejs";
async function GET(request) {
    const date = new URL(request.url).searchParams.get("date") ?? "";
    const entries = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$database$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["calorieRepository"].listByDate(date);
    return Response.json({
        entries,
        total: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$calories$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["calculateDailyTotal"])(entries)
    });
}
async function POST(request) {
    try {
        const input = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$calories$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["prepareCalorieEntry"])(await request.json());
        const entry = __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$database$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["calorieRepository"].add(input);
        return Response.json(entry, {
            status: 201
        });
    } catch (error) {
        return Response.json({
            error: error instanceof Error ? error.message : "Invalid entry"
        }, {
            status: 400
        });
    }
}
}),
"[project]/src/lib/calorie-repository.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CalorieRepository",
    ()=>CalorieRepository
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$better$2d$sqlite3__$5b$external$5d$__$28$better$2d$sqlite3$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$better$2d$sqlite3$40$13$2e$0$2e$2$2f$node_modules$2f$better$2d$sqlite3$29$__ = __turbopack_context__.i("[externals]/better-sqlite3 [external] (better-sqlite3, cjs, [project]/node_modules/.pnpm/better-sqlite3@13.0.2/node_modules/better-sqlite3)");
;
class CalorieRepository {
    database;
    constructor(path){
        this.database = new __TURBOPACK__imported__module__$5b$externals$5d2f$better$2d$sqlite3__$5b$external$5d$__$28$better$2d$sqlite3$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$better$2d$sqlite3$40$13$2e$0$2e$2$2f$node_modules$2f$better$2d$sqlite3$29$__["default"](path);
        this.database.exec(`
      CREATE TABLE IF NOT EXISTS calorie_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        calories INTEGER NOT NULL CHECK (calories > 0),
        entry_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    }
    add(input) {
        const result = this.database.prepare(`INSERT INTO calorie_entries (name, calories, entry_date)
         VALUES (@name, @calories, @date)`).run(input);
        return this.database.prepare(`SELECT id, name, calories, entry_date AS date, created_at AS createdAt
         FROM calorie_entries
         WHERE id = ?`).get(result.lastInsertRowid);
    }
    listByDate(date) {
        return this.database.prepare(`SELECT id, name, calories, entry_date AS date, created_at AS createdAt
         FROM calorie_entries
         WHERE entry_date = ?
         ORDER BY id DESC`).all(date);
    }
    close() {
        this.database.close();
    }
}
}),
"[project]/src/lib/calories.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "calculateDailyTotal",
    ()=>calculateDailyTotal,
    "prepareCalorieEntry",
    ()=>prepareCalorieEntry
]);
function calculateDailyTotal(entries) {
    return entries.reduce((total, entry)=>total + entry.calories, 0);
}
function prepareCalorieEntry(input) {
    const name = input.name.trim();
    if (!name) {
        throw new Error("Food name is required");
    }
    if (!Number.isInteger(input.calories) || input.calories <= 0) {
        throw new Error("Calories must be a positive whole number");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
        throw new Error("Date must use YYYY-MM-DD");
    }
    return {
        ...input,
        name
    };
}
}),
"[project]/src/lib/database.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "calorieRepository",
    ()=>calorieRepository
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$calorie$2d$repository$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/calorie-repository.ts [app-route] (ecmascript)");
;
;
;
const databasePath = process.env.CALORIE_DB_PATH ?? (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(process.cwd(), "data", "calories.db");
(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["mkdirSync"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["dirname"])(databasePath), {
    recursive: true
});
const calorieRepository = new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$calorie$2d$repository$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CalorieRepository"](databasePath);
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1o52a9y._.js.map