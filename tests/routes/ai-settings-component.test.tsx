import { createElement } from "react";
import { createMemoryRouter, createRoutesStub, RouterProvider, useLoaderData } from "react-router";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, test } from "vitest";
import type { PhotoAnalysisCredentialStatus } from "../../app/photo-analysis/credentials.server";
import type { PhotoAnalysisSettingsSnapshot } from "../../app/photo-analysis/configuration.server";
import type { PresentedPhotoAnalysisReadiness } from "../../app/routes/photo-analysis-readiness";
import AiSettings from "../../app/routes/settings.ai";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unconfigured: PhotoAnalysisCredentialStatus = { state: "unconfigured" };
const configured: PhotoAnalysisCredentialStatus = {
  state: "configured", configuredAt: "2026-09-19T16:00:00.000Z",
  updatedAt: "2026-09-19T16:00:00.000Z", validatedAt: "2026-09-19T16:00:00.000Z",
};
const settings: PhotoAnalysisSettingsSnapshot = {
  configuration: {
    geminiModel: "gemini-3.1-flash-lite", jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25, productConfidenceThreshold: 0.5, calibrated: true,
  },
  gemini: { state: "available", models: [
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", lowLatency: true },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", lowLatency: true },
  ] },
  jev: { state: "available", models: [
    { id: "jev-1.13.0", label: "Jev 1.13.0" },
    { id: "jev-1.14.0", label: "Jev 1.14.0" },
  ] },
  profiles: {
    "jev-1.13.0": { categoryConfidenceThreshold: 0.25, productConfidenceThreshold: 0.5, calibrated: true },
  },
  ready: true,
};
type ActionData = { area?: "credentials" | "configuration"; error?: string; success?: string; fieldErrors?: Record<string, string> };
async function render(
  credentials: PhotoAnalysisCredentialStatus,
  discovered?: PhotoAnalysisSettingsSnapshot,
  actionData?: ActionData,
  readiness: PresentedPhotoAnalysisReadiness = { state: "ready" },
) {
  const loaderData = { csrfToken: "test-csrf", today: "2026-09-19", credentials, settings: discovered, readiness };
  const Routes = createRoutesStub([{ path: "/settings/ai", id: "ai", Component: AiSettings, loader: () => loaderData }]);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Routes, {
      initialEntries: ["/settings/ai"],
      hydrationData: { loaderData: { ai: loaderData }, actionData: actionData ? { ai: actionData } : undefined },
    }));
  });
  return renderer;
}
function text(node: ReactTestRenderer["root"]): string {
  return node.children.map(child => typeof child === "string" ? child : text(child)).join("");
}
function buttons(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType("button").map(button => text(button));
}
function input(renderer: ReactTestRenderer, name: string) {
  const found = renderer.root.findAllByType("input").find(candidate => candidate.props.name === name);
  if (!found) throw new Error(`Missing input ${name}`);
  return found;
}
function focusInput(renderer: ReactTestRenderer, name: string) {
  const handler = (input(renderer, name).props as { onFocus?: () => void }).onFocus;
  handler?.();
}
function changeInput(renderer: ReactTestRenderer, name: string, value: string) {
  const handler = (input(renderer, name).props as { onChange?: (event: { target: { value: string } }) => void }).onChange;
  handler?.({ target: { value } });
}
function pressInput(renderer: ReactTestRenderer, name: string, key: string) {
  const handler = (input(renderer, name).props as { onKeyDown?: (event: { key: string; preventDefault(): void }) => void }).onKeyDown;
  handler?.({ key, preventDefault() {} });
}
function blurInput(renderer: ReactTestRenderer, name: string) {
  const handler = (input(renderer, name).props as { onBlur?: () => void }).onBlur;
  handler?.();
}

test("unconfigured Settings keeps secrets blank and explains why model selection is unavailable", async () => {
  const renderer = await render(unconfigured);
  expect(text(renderer.root)).toContain("Not configured");
  expect(text(renderer.root)).toContain("Save a valid credential pair to discover available models");
  expect(buttons(renderer)).toContain("Save credential pair");
  expect(buttons(renderer)).not.toContain("Save model settings");
  for (const name of ["geminiKey", "typeSafeKey"]) {
    expect(input(renderer, name).props).toMatchObject({
      type: "password", autoComplete: "new-password", minLength: 16, maxLength: 512, required: true,
    });
    expect(input(renderer, name).props.value).toBeUndefined();
  }
  await act(() => renderer.unmount());
});

test("configured Settings shows supported defaults, calibration, and threshold semantics", async () => {
  const renderer = await render(configured, settings);
  expect(text(renderer.root)).toContain("Ready");
  expect(text(renderer.root)).toContain("Saved calibration for jev-1.13.0");
  expect(text(renderer.root)).toContain("0.0 accepts any non-none Jev choice");
  expect(text(renderer.root)).toContain("more concentrated probability distribution");
  expect(text(renderer.root)).toContain("uses its Gemini estimate instead");
  expect(text(renderer.root)).toContain("future attempts only");
  expect(input(renderer, "geminiModel").props).toMatchObject({ role: "combobox", value: "gemini-3.1-flash-lite" });
  expect(input(renderer, "jevModel").props.value).toBe("jev-1.13.0");
  expect(input(renderer, "categoryConfidenceThreshold").props.value).toBe(0.25);
  expect(input(renderer, "productConfidenceThreshold").props.value).toBe(0.5);
  expect(text(renderer.root)).toContain("AI photo availability");
  expect(text(renderer.root)).toContain("Members can start a photo estimate from Add Food");
  await act(() => renderer.unmount());
});

test("Settings presents readiness recovery without linking back to the current page", async () => {
  const catalog = await render(configured, settings, undefined, {
    state: "unavailable",
    reason: "Reimport USDA Foundation for Photo Analysis.",
    destination: "/settings/catalogs",
  });
  expect(text(catalog.root)).toContain("AI photo availability");
  expect(text(catalog.root)).toContain("Unavailable");
  expect(text(catalog.root)).toContain("AI photo is hidden from Add Food until this is fixed");
  expect(text(catalog.root)).toContain("Reimport USDA Foundation for Photo Analysis.");
  expect(catalog.root.findAllByProps({ href: "/settings/catalogs" })).toHaveLength(2);
  await act(() => catalog.unmount());

  const credentials = await render(configured, settings, undefined, {
    state: "unavailable",
    reason: "Refresh the selected Gemini and Jev models.",
    destination: "/settings/ai",
  });
  expect(text(credentials.root)).toContain("Refresh the selected Gemini and Jev models.");
  expect(credentials.root.findAllByProps({ href: "/settings/ai" })).toHaveLength(0);
  await act(() => credentials.unmount());
});

test("combobox typing filters options, keyboard selection rejects free-form state, and a new Jev model starts uncalibrated", async () => {
  const renderer = await render(configured, settings);
  await act(() => focusInput(renderer, "geminiModel"));
  await act(() => changeInput(renderer, "geminiModel", "3.5"));
  expect(renderer.root.findAllByProps({ role: "option" }).map(option => text(option))).toEqual(["Gemini 3.5 FlashLow latency"]);
  await act(() => pressInput(renderer, "geminiModel", "Enter"));
  expect(input(renderer, "geminiModel").props.value).toBe("gemini-3.5-flash");
  await act(() => changeInput(renderer, "geminiModel", "free text"));
  expect(text(renderer.root)).toContain("Choose a Gemini model from the available options");
  expect(renderer.root.findByProps({ value: "save-configuration" }).props.disabled).toBe(true);
  await act(() => changeInput(renderer, "geminiModel", "3.5"));
  await act(() => pressInput(renderer, "geminiModel", "Enter"));

  await act(() => focusInput(renderer, "jevModel"));
  await act(() => changeInput(renderer, "jevModel", "1.14"));
  await act(() => pressInput(renderer, "jevModel", "Enter"));
  expect(input(renderer, "jevModel").props.value).toBe("jev-1.14.0");
  expect(input(renderer, "categoryConfidenceThreshold").props.value).toBe(0);
  expect(input(renderer, "productConfidenceThreshold").props.value).toBe(0);
  expect(text(renderer.root)).toContain("jev-1.14.0 is uncalibrated");
  await act(() => renderer.unmount());
});

test("configuration field errors stay scoped to the model form", async () => {
  const renderer = await render(configured, settings, {
    area: "configuration", error: "Choose available models and enter valid confidence thresholds.",
    fieldErrors: { geminiModel: "Choose an available supported Gemini model." },
  });
  expect(renderer.root.findByProps({ id: "gemini-model-error" })).toBeDefined();
  expect(text(renderer.root.findByProps({ "aria-labelledby": "models-heading" }))).toContain("Choose an available supported Gemini model");
  expect(text(renderer.root.findByProps({ "aria-labelledby": "credentials-heading" }))).not.toContain("Choose an available supported Gemini model");
  await act(() => renderer.unmount());
});

test("unreadable credentials and credential feedback render without disclosing values", async () => {
  const unreadable: PhotoAnalysisCredentialStatus = {
    state: "unreadable", configuredAt: "2026-09-18T12:00:00.000Z", updatedAt: "2026-09-18T12:00:00.000Z",
  };
  const failed = await render(unreadable, undefined, {
    area: "credentials", error: "The credential pair could not be validated.",
    fieldErrors: { geminiKey: "Gemini rejected this key.", typeSafeKey: "TypeSafe rejected this key." },
  });
  expect(text(failed.root)).toContain("Needs re-entry");
  expect(text(failed.root)).toContain("cannot be read");
  expect(text(failed.root)).toContain("Gemini rejected this key");
  expect(text(failed.root)).toContain("TypeSafe rejected this key");
  expect(buttons(failed)).toContain("Save credential pair");
  expect(buttons(failed)).toContain("Delete credential pair");
  await act(() => failed.unmount());

  const saved = await render(configured, settings, { area: "credentials", success: "Photo Analysis credentials saved." });
  expect(text(saved.root)).toContain("credentials saved");
  await act(() => saved.unmount());
});

test("unready discovery and every configuration error remain visible with saving disabled", async () => {
  const unready: PhotoAnalysisSettingsSnapshot = {
    ...settings,
    configuration: { ...settings.configuration, jevModel: "jev-9.9.9", calibrated: false },
    gemini: { state: "transient-error", models: [], message: "Model availability could not be refreshed. Try again." },
    jev: { state: "available", models: [{ id: "jev-1.13.0", label: "Jev 1.13.0" }] },
    ready: false,
    reason: "Gemini: Model availability could not be refreshed. Try again.",
  };
  const renderer = await render(configured, unready, {
    area: "configuration", error: "Choose available models and enter valid confidence thresholds.", success: "ignored",
    fieldErrors: {
      jevModel: "Choose an available supported Jev model.",
      categoryConfidenceThreshold: "Enter a value from 0.0 through 1.0.",
      productConfidenceThreshold: "Enter a value from 0.0 through 1.0.",
    },
  });
  expect(text(renderer.root)).toContain("Not ready");
  expect(text(renderer.root)).toContain("Model availability could not be refreshed");
  expect(text(renderer.root)).toContain("Choose an available supported Jev model");
  expect(text(renderer.root)).toContain("Enter a value from 0.0 through 1.0");
  expect(renderer.root.findByProps({ value: "save-configuration" }).props.disabled).toBe(true);
  await act(() => renderer.unmount());

  const success = await render(configured, settings, { area: "configuration", success: "Photo Analysis model settings saved for future attempts." });
  expect(text(success.root)).toContain("model settings saved");
  await act(() => success.unmount());
});

test("combobox handles arrow navigation, escape, mouse selection, and blur", async () => {
  const renderer = await render(configured, settings);
  await act(() => focusInput(renderer, "geminiModel"));
  await act(() => changeInput(renderer, "geminiModel", ""));
  await act(() => pressInput(renderer, "geminiModel", "ArrowDown"));
  await act(() => pressInput(renderer, "geminiModel", "ArrowDown"));
  await act(() => pressInput(renderer, "geminiModel", "ArrowUp"));
  expect(input(renderer, "geminiModel").props["aria-activedescendant"]).toBeDefined();
  await act(() => pressInput(renderer, "geminiModel", "Escape"));
  expect(input(renderer, "geminiModel").props["aria-expanded"]).toBe(false);

  await act(() => focusInput(renderer, "jevModel"));
  await act(() => changeInput(renderer, "jevModel", ""));
  const option = renderer.root.findAllByProps({ role: "option" }).find(candidate => text(candidate).includes("Jev 1.14.0"));
  if (!option) throw new Error("Missing Jev option");
  const preventDefault = (option.props as { onMouseDown?: (event: { preventDefault(): void }) => void }).onMouseDown;
  preventDefault?.({ preventDefault() {} });
  const click = (option.props as { onClick?: () => void }).onClick;
  await act(() => click?.());
  expect(input(renderer, "jevModel").props.value).toBe("jev-1.14.0");

  await act(() => focusInput(renderer, "jevModel"));
  await act(async () => { blurInput(renderer, "jevModel"); await new Promise(resolve => setTimeout(resolve, 1)); });
  expect(input(renderer, "jevModel").props["aria-expanded"]).toBe(false);
  await act(() => renderer.unmount());
});

test("all mutation controls stay disabled while a submission settles", async () => {
  const loaderData = { csrfToken: "test-csrf", today: "2026-09-19", credentials: configured, settings };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const router = createMemoryRouter([{
    path: "/settings/ai", id: "ai",
    Component: () => createElement(AiSettings, { loaderData: useLoaderData(), actionData: undefined } as never),
    loader: () => loaderData, action: async () => { await gate; return {}; },
  }], { initialEntries: ["/settings/ai"], hydrationData: { loaderData: { ai: loaderData } } });
  let renderer!: ReactTestRenderer;
  await act(() => { renderer = create(createElement(RouterProvider, { router })); });
  const form = new FormData(); form.set("intent", "save-configuration");
  let submitted!: Promise<void>;
  await act(async () => { submitted = router.navigate("/settings/ai", { formMethod: "post", formData: form }); });
  for (const button of renderer.root.findAllByType("button").filter(button => button.props.name === "intent")) expect(button.props.disabled).toBe(true);
  await act(async () => { release(); await submitted; });
  await act(() => renderer.unmount()); router.dispose();
});
