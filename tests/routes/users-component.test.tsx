/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- react-test-renderer host props are untyped */
import { createElement, useState } from "react";
import { createMemoryRouter, Form, RouterProvider } from "react-router";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";

import Users, { meta } from "../../app/routes/settings.users";
import styles from "../../app/users.module.css";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const members = [
  { accessState: "active", createdAt: "2026-08-29T23:15:00.000Z", id: 17, passwordChangeRequired: true, username: "alice.member" },
  { accessState: "disabled", createdAt: "2025-12-01T01:00:00.000Z", id: 28, passwordChangeRequired: false, username: "bob.member" },
];
const renderers: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount(); });
});

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}

async function renderUsers(initialAction?: Record<string, unknown>, directory = members) {
  let updateAction: (value: Record<string, unknown> | undefined) => void = () => undefined;
  function Page() {
    const [actionData, setActionData] = useState(initialAction);
    updateAction = setActionData;
    return createElement(Users, {
      actionData,
      loaderData: { csrfToken: "directory-csrf", members: directory, today: "2026-09-05", username: "administrator" },
    } as never);
  }
  const router = createMemoryRouter([{ Component: Page, path: "/settings/users" }], { initialEntries: ["/settings/users"] });
  const dialogs: { open: boolean; showModal: ReturnType<typeof vi.fn> }[] = [];
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(RouterProvider, { router }), {
      createNodeMock: (element) => {
        if (element.type !== "dialog") return null;
        const dialog = { open: false, showModal: vi.fn(() => { dialog.open = true; }) };
        dialogs.push(dialog);
        return dialog;
      },
    });
  });
  renderers.push(renderer);
  return { renderer, dialogs, update: async (value?: Record<string, unknown>) => {
    await act(async () => updateAction(value));
  } };
}

function fields(node: ReactTestInstance) {
  return Object.fromEntries(node.findAllByType("input").map((input) => [input.props.name as string, input.props]));
}

async function openDialog(renderer: ReactTestRenderer, label: string) {
  const trigger = { focus: vi.fn() };
  await act(async () => renderer.root.findByProps({ "aria-label": label }).props.onClick({ currentTarget: trigger }));
  return trigger;
}

test("directory distinguishes active and disabled members and exposes safe account forms", async () => {
  expect(meta()).toEqual([
    { title: "Users · Open Calorie Tracker" },
    { name: "description", content: "Manage member access without exposing private nutrition data" },
  ]);
  const { renderer } = await renderUsers();
  const rows = renderer.root.findByType("main").findAllByType("li");
  expect(rows).toHaveLength(2);
  expect(text(rows[0])).toContain("alice.memberCreated August 29, 2026Password change requiredActive");
  expect(text(rows[1])).toContain("bob.memberCreated December 1, 2025Disabled");
  expect(text(rows[1])).not.toContain("Password change required");
  expect(rows[0].findByProps({ className: styles.activeState }).children).toEqual(["Active"]);
  expect(rows[1].findByProps({ className: styles.disabledState }).children).toEqual(["Disabled"]);
  expect(rows[0].findByProps({ "aria-label": "Disable alice.member" }).props.type).toBe("button");
  expect(rows[1].findByProps({ "aria-label": "Reactivate bob.member" }).props.type).toBe("submit");
  expect(rows[1].findAllByProps({ "aria-label": "Disable bob.member" })).toHaveLength(0);
  const reactivation = rows[1].findByType(Form);
  expect(reactivation.props.method).toBe("post");
  expect(fields(reactivation)).toMatchObject({
    csrfToken: { type: "hidden", value: "directory-csrf" },
    intent: { type: "hidden", value: "reactivate-member" },
    targetUsername: { type: "hidden", value: "bob.member" },
  });
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  const empty = await renderUsers(undefined, []);
  expect(text(empty.renderer.root)).toContain("No member accounts yet.");
  expect(empty.renderer.root.findByType("main").findAllByType("li")).toHaveLength(0);
});

test.each([
  ["Disable alice.member", "disable-member", "Disable member"],
  ["Delete bob.member", "delete-member", "Permanently delete member"],
])("%s confirms the intended account, dismisses on submit and restores focus on cancellation", async (label, intent, submitLabel) => {
  const { renderer, dialogs } = await renderUsers();
  const username = intent === "disable-member" ? "alice.member" : "bob.member";
  for (const cancellation of ["escape", "button"] as const) {
    const trigger = await openDialog(renderer, label);
    const dialog = renderer.root.findByType("dialog");
    expect(dialogs.at(-1)?.showModal).toHaveBeenCalledExactlyOnceWith();
    expect(dialog.props["aria-modal"]).toBe("true");
    expect(text(dialog)).toContain(username);
    const form = dialog.findByType(Form);
    expect(form.props.method).toBe("post");
    expect(fields(form)).toMatchObject({
      csrfToken: { type: "hidden", value: "directory-csrf" },
      intent: { type: "hidden", value: intent },
      targetUsername: { type: "hidden", value: username },
      confirmationUsername: { autoFocus: true, required: true, autoComplete: "off" },
    });
    if (intent === "delete-member") {
      expect(fields(form).targetUserId.value).toBe(28);
      expect(text(dialog)).toContain("It cannot be recovered");
    } else {
      expect(text(dialog)).toContain("alice.member to confirm.");
    }
    expect(form.findAllByType("button").find((button) => text(button) === submitLabel)?.props.type).toBe("submit");
    const preventDefault = vi.fn();
    await act(async () => {
      if (cancellation === "escape") dialog.props.onCancel({ preventDefault });
      else dialog.findAllByType("button").find((button) => text(button) === "Cancel")!.props.onClick();
    });
    if (cancellation === "escape") expect(preventDefault).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    expect(trigger.focus).toHaveBeenCalledOnce();
  }
  await openDialog(renderer, label);
  await act(async () => renderer.root.findByType("dialog").findByType(Form).props.onSubmit());
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
});

test("password reset remains open on errors or unrelated results and closes only after its successful submission", async () => {
  const { renderer, dialogs, update } = await renderUsers({ passwordResetUsername: "alice.member" });
  const trigger = await openDialog(renderer, "Reset password for alice.member");
  expect(dialogs.at(-1)?.showModal).toHaveBeenCalledOnce();
  const dialog = () => renderer.root.findByType("dialog");
  expect(text(dialog())).toContain("Reset password for alice.member");
  expect(fields(dialog())).toMatchObject({
    csrfToken: { type: "hidden", value: "directory-csrf" },
    intent: { value: "reset-member-password" },
    targetUsername: { value: "alice.member" },
    username: { autoComplete: "username", value: "alice.member" },
    newPassword: { autoFocus: true, autoComplete: "new-password", type: "password", required: true },
    confirmPassword: { autoComplete: "new-password", type: "password", required: true },
  });
  const submit = async () => {
    await act(async () => dialog().findByType(Form).props.onSubmit());
  };
  await submit();
  await update({ passwordResetError: "Passwords do not match." });
  expect(text(dialog().findByProps({ role: "alert" }))).toBe("Passwords do not match.");
  await update({ passwordResetUsername: "alice.member" });
  expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
  await submit();
  await update({ passwordResetUsername: "bob.member" });
  expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
  await submit();
  await update();
  expect(renderer.root.findAllByType("dialog")).toHaveLength(1);
  await submit();
  await update({ passwordResetUsername: "alice.member" });
  expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  expect(trigger.focus).not.toHaveBeenCalled();
  for (const cancellation of ["escape", "button"] as const) {
    const nextTrigger = await openDialog(renderer, "Reset password for bob.member");
    const preventDefault = vi.fn();
    await act(async () => {
      if (cancellation === "escape") dialog().props.onCancel({ preventDefault });
      else dialog().findAllByType("button").find((button) => text(button) === "Cancel")!.props.onClick();
    });
    if (cancellation === "escape") expect(preventDefault).toHaveBeenCalledOnce();
    expect(nextTrigger.focus).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
  }
});

test("directory renders action feedback and clears the creation form after each new account", async () => {
  const { renderer, update } = await renderUsers({ error: "That username is already in use.", username: "taken.member" });
  const creation = () => renderer.root.findAllByType(Form).find((form) => fields(form).intent?.value === "create-member")!;
  expect(fields(creation()).username.defaultValue).toBe("taken.member");
  expect(text(creation())).toContain("That username is already in use.");
  const firstForm = creation();
  await update({ createdUsername: "new.member", accessChanged: { username: "alice.member", action: "disabled" }, passwordResetUsername: "bob.member", deletedUsername: "old.member" });
  expect(creation()).not.toBe(firstForm);
  expect(fields(creation()).username.defaultValue).toBeUndefined();
  const statuses = renderer.root.findAllByProps({ role: "status" }).map(text);
  expect(statuses).toEqual(expect.arrayContaining([
    expect.stringContaining("new.member was created."),
    "alice.member was disabled.",
    expect.stringContaining("bob.member password was reset."),
    "old.member was permanently deleted.",
  ]));
  const secondForm = creation();
  await update({ createdUsername: "another.member" });
  expect(creation()).not.toBe(secondForm);
  await update({ accessError: "Member access has changed.", deletionError: "Member is no longer available." });
  expect(renderer.root.findAllByProps({ role: "alert" }).map(text)).toEqual([
    "Member access has changed.", "Member is no longer available.",
  ]);
});
