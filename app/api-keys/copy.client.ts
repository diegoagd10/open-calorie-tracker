/**
 * Writes text that may still be loading to the clipboard. Passing the pending
 * value to ClipboardItem keeps the click's user activation in Safari.
 */
export async function copyText(value: () => Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
    const blob = value().then((text) => new Blob([text], { type: "text/plain" }));
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    return;
  }
  await navigator.clipboard.writeText(await value());
}

/** Asks the server for the owner's full key; it never reaches rendered HTML. */
export async function requestApiKey(csrfToken: string, keyId: number): Promise<string> {
  const response = await fetch("/settings/api-keys/copy", {
    method: "POST",
    body: new URLSearchParams({ csrfToken, keyId: String(keyId) }),
  });
  if (!response.ok) throw new Error("The key could not be copied.");
  const { key } = (await response.json()) as { key: string };
  return key;
}
