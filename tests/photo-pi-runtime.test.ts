import { beforeEach, expect, test, vi } from "vitest";
import { piCompletion } from "../app/photo-analysis/pi.server";
const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  getModel: vi.fn(),
  completeSimple: vi.fn(),
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: sdk.create },
}));
beforeEach(() => {
  vi.clearAllMocks();
  sdk.create.mockResolvedValue({
    getModel: sdk.getModel,
    completeSimple: sdk.completeSimple,
  });
});
test("Pi uses only configured backend model and renewable auth storage without agent discovery", async () => {
  const model = { input: ["text", "image"] };
  sdk.getModel.mockReturnValue(model);
  sdk.completeSimple.mockResolvedValue({ stopReason: "stop" });
  const complete = piCompletion({
    authPath: "/private/instance/auth.json",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    reasoning: "low",
  });
  const context = { messages: [] };
  const signal = new AbortController().signal;
  expect(await complete(context, signal)).toEqual({ stopReason: "stop" });
  await complete(context, signal);
  expect(sdk.create).toHaveBeenCalledExactlyOnceWith({
    authPath: "/private/instance/auth.json",
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  expect(sdk.getModel).toHaveBeenCalledWith("openai-codex", "gpt-5.6-luna");
  expect(sdk.completeSimple).toHaveBeenCalledWith(model, context, {
    signal,
    reasoning: "low",
    maxTokens: 6000,
  });
});
test.each([undefined, { input: ["text"] }])(
  "missing or non-image models fail before inference",
  async (model) => {
    sdk.getModel.mockReturnValue(model);
    const complete = piCompletion({
      authPath: "/private/auth.json",
      provider: "configured-provider",
      model: "configured-model",
      reasoning: "medium",
    });
    await expect(
      complete({ messages: [] }, new AbortController().signal),
    ).rejects.toThrow("Configured photo model unavailable");
    expect(sdk.completeSimple).not.toHaveBeenCalled();
  },
);
