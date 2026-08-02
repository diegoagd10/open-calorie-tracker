import test from "node:test";
import assert from "node:assert/strict";

test("lookup renders nutrition values per serving for the trail mix label", async () => {
  const response = await fetch("http://127.0.0.1:3000/lookup", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ barcode: "078742231587" }),
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, />per serving/);
  assert.match(html, /<dd>184 <span>kcal<\/span><\/dd>/);
  assert.match(html, /<dd>13 <span>g<\/span><\/dd>/);
  assert.match(html, /<dd>140 <span>mg<\/span><\/dd>/);
  assert.match(html, /<dd>1\.04 <span>mg<\/span><\/dd>/);
  assert.doesNotMatch(html, /575 <span>kcal<\/span>/);
});
