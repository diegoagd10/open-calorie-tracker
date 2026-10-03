import { readFile } from "node:fs/promises";

const registry = (process.env.npm_config_registry || "https://registry.npmjs.org/").replace(/\/?$/, "/");
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const declared = ["dependencies", "devDependencies", "optionalDependencies"].flatMap((field) =>
  Object.entries(manifest[field] ?? {}).map(([name, spec]) => ({ field, name, spec })),
);

// Exact versions and ^/~ ranges are both checked against their written version,
// which every such range admits. Other specifiers (git, file, tags) are rejected.
async function problem({ name, spec }) {
  const version = /^[~^]?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(spec)?.[1];
  if (!version) return `uses unsupported specifier "${spec}"`;
  const response = await fetch(`${registry}${name.replace("/", "%2F")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (response.status === 404) return "does not exist in the registry";
  if (!response.ok) throw new Error(`${name}: registry responded ${response.status}`);
  const { versions } = await response.json();
  return versions?.[version] ? undefined : `has no published version ${version}`;
}

const results = await Promise.all(declared.map(async (dependency) => ({ ...dependency, problem: await problem(dependency) })));
const failures = results.filter((result) => result.problem);
for (const { field, name, problem } of failures) console.error(`- ${name} (${field}) ${problem}.`);
if (failures.length) process.exitCode = 1;
else console.log(`All ${results.length} declared dependencies exist in ${registry}.`);
