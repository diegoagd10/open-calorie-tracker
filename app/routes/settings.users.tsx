import { useEffect, useRef, useState } from "react";
import { data, Form } from "react-router";

import { AppNavigation } from "../app-navigation";
import type { Route } from "./+types/settings.users";
import {
  requireAdministratorSession,
  requireValidOrigin,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { registrationSchema, usernameSchema } from "../auth/validation";
import { formatLocalDate } from "../food-log/date";
import shellStyles from "../food-log.module.css";
import { SettingsDestinations } from "../settings-destinations";
import styles from "../users.module.css";

type UsersActionData = {
  accessChanged?: {
    action: "disabled" | "reactivated";
    username: string;
  };
  accessError?: string;
  createdUsername?: string;
  deletedUsername?: string;
  deletionError?: string;
  error?: string;
  username?: string;
};

const usersActionIntents = {
  "create-member": true,
  "delete-member": true,
  "disable-member": true,
  "reactivate-member": true,
} as const;

type UsersActionIntent = keyof typeof usersActionIntents;

function parseUsersActionIntent(
  value: FormDataEntryValue | null,
): UsersActionIntent | undefined {
  if (typeof value !== "string") return undefined;
  return Object.hasOwn(usersActionIntents, value)
    ? value as UsersActionIntent
    : undefined;
}

type MemberDialogTarget = { id: number; username: string };

function useMemberDialog() {
  const [target, setTarget] = useState<MemberDialogTarget>();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (target && !dialog.current?.open) dialog.current?.showModal();
  }, [target]);

  function dismiss() {
    setTarget(undefined);
  }

  function cancel() {
    dismiss();
    queueMicrotask(() => trigger.current?.focus());
  }

  function open(nextTarget: MemberDialogTarget, nextTrigger: HTMLButtonElement) {
    trigger.current = nextTrigger;
    setTarget(nextTarget);
  }

  return { cancel, dialog, dismiss, open, target };
}

export function meta() {
  return [
    { title: "Users · Open Calory Tracker" },
    {
      name: "description",
      content: "Manage member access without exposing private nutrition data",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  return {
    csrfToken: session.csrfToken,
    members: getAuthenticationService().listManageableMembers(),
    today: new Date().toISOString().slice(0, 10),
    username: session.user.username,
  };
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await requireAdministratorSession(request);
  const formData = await request.formData();
  const authentication = getAuthenticationService();
  if (
    !authentication.verifyCsrfToken(
      session.token,
      String(formData.get("csrfToken") ?? ""),
    )
  ) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }

  const intent = parseUsersActionIntent(formData.get("intent"));
  if (!intent) {
    return data<UsersActionData>(
      { error: "Unsupported action." },
      { status: 400 },
    );
  }
  if (intent !== "create-member") {
    const targetUsername = String(formData.get("targetUsername") ?? "");
    const parsedTarget = usernameSchema.safeParse(targetUsername);
    if (!parsedTarget.success || parsedTarget.data !== targetUsername) {
      return data<UsersActionData>(
        intent === "delete-member"
          ? {
              deletionError:
                "Member is no longer available. Refresh and try again.",
            }
          : {
              accessError:
                "Member is no longer available. Refresh and try again.",
            },
        { status: 409 },
      );
    }

    if (intent === "delete-member") {
      const targetUserId = Number(formData.get("targetUserId"));
      if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
        return data<UsersActionData>(
          {
            deletionError:
              "Member is no longer available. Refresh and try again.",
          },
          { status: 409 },
        );
      }
      const result = await authentication.deleteMember(
        session.user,
        { id: targetUserId, username: targetUsername },
        String(formData.get("confirmationUsername") ?? ""),
      );
      if (!result.ok) {
        return data<UsersActionData>(
          {
            deletionError: result.error === "confirmation-mismatch"
              ? `Enter ${targetUsername} exactly to confirm permanent deletion.`
              : "Member is no longer available. Refresh and try again.",
          },
          { status: result.error === "confirmation-mismatch" ? 400 : 409 },
        );
      }
      return data<UsersActionData>(
        { deletedUsername: targetUsername },
        { status: 200 },
      );
    }

    const result = intent === "disable-member"
      ? await authentication.disableMemberAccess(
        session.user,
        targetUsername,
        String(formData.get("confirmationUsername") ?? ""),
      )
      : await authentication.reactivateMemberAccess(
        session.user,
        targetUsername,
      );
    if (!result.ok) {
      if (result.error === "confirmation-mismatch") {
        return data<UsersActionData>(
          { accessError: `Enter ${targetUsername} exactly to confirm.` },
          { status: 400 },
        );
      }
      return data<UsersActionData>(
        { accessError: "Member access has changed. Refresh and try again." },
        { status: 409 },
      );
    }

    return data<UsersActionData>(
      {
        accessChanged: {
          action: intent === "disable-member" ? "disabled" : "reactivated",
          username: targetUsername,
        },
      },
      { status: 200 },
    );
  }

  const fields = {
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    password: String(formData.get("password") ?? ""),
    username: String(formData.get("username") ?? ""),
  };
  const parsed = registrationSchema.safeParse(fields);
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    const error =
      field === "username"
        ? "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore."
        : field === "password"
          ? "Password must contain 12–128 characters."
          : "Passwords do not match.";
    return data<UsersActionData>(
      { error, username: fields.username },
      { status: 400 },
    );
  }

  const result = await authentication.provisionMember(
    parsed.data.username,
    parsed.data.password,
  );
  if (!result.ok) {
    return data<UsersActionData>(
      {
        error: "That username is already in use.",
        username: fields.username,
      },
      { status: 409 },
    );
  }

  return data<UsersActionData>(
    { createdUsername: result.member.username },
    { status: 201 },
  );
}

export default function Users({ actionData, loaderData }: Route.ComponentProps) {
  const disableDialog = useMemberDialog();
  const deletionDialog = useMemberDialog();

  return (
    <div className={shellStyles.shell}>
      <a className={shellStyles.skipLink} href="#member-directory-content">
        Skip to member directory
      </a>
      <AppNavigation
        active="settings"
        csrfToken={loaderData.csrfToken}
        selectedDate={loaderData.today}
        today={loaderData.today}
        username={loaderData.username}
      />
      <main className={shellStyles.appSurface} id="member-directory-content">
        <header className={shellStyles.mobileHeader}>
          <div className={shellStyles.titleLine}>
            <h1>Users</h1>
            <span className={shellStyles.privacyCue}>◈ Accounts only</span>
          </div>
          <p className={shellStyles.selectedDateLabel}>
            Manage account access without opening private nutrition data.
          </p>
        </header>

        <SettingsDestinations
          active="users"
          csrfToken={loaderData.csrfToken}
          isAdministrator
        />

        <section
          className={styles.provisioning}
          aria-labelledby="provision-member-heading"
        >
          <header>
            <h2 id="provision-member-heading">Create member</h2>
            <p>
              Set an initial password. Share it outside this application; the
              member must replace it before continuing.
            </p>
          </header>
          <Form
            className={styles.provisioningForm}
            key={
              actionData?.createdUsername
                ? `created-${actionData.createdUsername}`
                : "ready"
            }
            method="post"
            noValidate
          >
            <input
              name="csrfToken"
              type="hidden"
              value={loaderData.csrfToken}
            />
            <input name="intent" type="hidden" value="create-member" />
            <label>
              <span>Username</span>
              <input
                aria-describedby="member-username-help"
                autoComplete="off"
                defaultValue={actionData?.username}
                maxLength={30}
                name="username"
                pattern="[A-Za-z0-9._-]+"
                required
              />
              <small id="member-username-help">
                3–30 letters, digits, dot, hyphen, or underscore.
              </small>
            </label>
            <label>
              <span>Initial password</span>
              <input
                aria-describedby="member-password-help"
                autoComplete="new-password"
                name="password"
                required
                type="password"
              />
              <small id="member-password-help">
                12–128 characters; never stored or shown after creation.
              </small>
            </label>
            <label>
              <span>Confirm initial password</span>
              <input
                autoComplete="new-password"
                name="confirmPassword"
                required
                type="password"
              />
            </label>
            {actionData?.error ? (
              <p className={styles.error} role="alert">
                {actionData.error}
              </p>
            ) : null}
            {actionData?.createdUsername ? (
              <p className={styles.success} role="status">
                <strong>{actionData.createdUsername}</strong> was created.
                Deliver the initial password outside this application.
              </p>
            ) : null}
            <button type="submit">Create member</button>
          </Form>
        </section>

        <section className={styles.directory} aria-labelledby="members-heading">
          <div className={styles.directoryHeading}>
            <div>
              <h2 id="members-heading">Members</h2>
              <p>Normalized account names in alphabetical order.</p>
            </div>
            <strong>{loaderData.members.length}</strong>
          </div>
          {actionData?.accessError ? (
            <p className={styles.directoryMessageError} role="alert">
              {actionData.accessError}
            </p>
          ) : null}
          {actionData?.accessChanged ? (
            <p className={styles.directoryMessageSuccess} role="status">
              <strong>{actionData.accessChanged.username}</strong> was {actionData.accessChanged.action}.
            </p>
          ) : null}
          {actionData?.deletionError ? (
            <p className={styles.directoryMessageError} role="alert">
              {actionData.deletionError}
            </p>
          ) : null}
          {actionData?.deletedUsername ? (
            <p className={styles.directoryMessageSuccess} role="status">
              <strong>{actionData.deletedUsername}</strong> was permanently
              deleted.
            </p>
          ) : null}
          {loaderData.members.length === 0 ? (
            <p className={styles.empty}>No member accounts yet.</p>
          ) : (
            <ul className={styles.memberList}>
              {loaderData.members.map((member) => (
                <li key={member.username}>
                  <span className={styles.memberIdentity}>
                    <strong>{member.username}</strong>
                    <small>
                      Created {formatLocalDate(member.createdAt.slice(0, 10), {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </small>
                  </span>
                  <span className={styles.memberAccess}>
                    <span className={styles.memberStates}>
                      {member.passwordChangeRequired ? (
                        <span className={styles.onboardingState}>
                          Password change required
                        </span>
                      ) : null}
                      <span
                        className={
                          member.accessState === "active"
                            ? styles.activeState
                            : styles.disabledState
                        }
                      >
                        {member.accessState === "active" ? "Active" : "Disabled"}
                      </span>
                    </span>
                    <span className={styles.memberControls}>
                      {member.accessState === "active" ? (
                        <button
                          aria-label={`Disable ${member.username}`}
                          className={styles.disableButton}
                          onClick={(event) => {
                            disableDialog.open(
                              member,
                              event.currentTarget,
                            );
                          }}
                          type="button"
                        >
                          Disable
                        </button>
                      ) : (
                        <Form method="post">
                          <input
                            name="csrfToken"
                            type="hidden"
                            value={loaderData.csrfToken}
                          />
                          <input
                            name="intent"
                            type="hidden"
                            value="reactivate-member"
                          />
                          <input
                            name="targetUsername"
                            type="hidden"
                            value={member.username}
                          />
                          <button
                            aria-label={`Reactivate ${member.username}`}
                            className={styles.reactivateButton}
                            type="submit"
                          >
                            Reactivate
                          </button>
                        </Form>
                      )}
                      <button
                        aria-label={`Delete ${member.username}`}
                        className={styles.deleteButton}
                        onClick={(event) => {
                          deletionDialog.open(
                            member,
                            event.currentTarget,
                          );
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {disableDialog.target ? (
          <dialog
            aria-labelledby="disable-member-heading"
            aria-modal="true"
            className={styles.confirmationDialog}
            onCancel={(event) => {
              event.preventDefault();
              disableDialog.cancel();
            }}
            ref={disableDialog.dialog}
          >
            <h2 id="disable-member-heading">
              Disable {disableDialog.target.username}
            </h2>
            <p>
              This immediately signs the member out on every device. Enter the
              complete normalized username <strong>
                {disableDialog.target.username}
              </strong>
              {" "}to confirm.
            </p>
            <Form
              className={styles.confirmationForm}
              method="post"
              onSubmit={disableDialog.dismiss}
            >
              <input
                name="csrfToken"
                type="hidden"
                value={loaderData.csrfToken}
              />
              <input name="intent" type="hidden" value="disable-member" />
              <input
                name="targetUsername"
                type="hidden"
                value={disableDialog.target.username}
              />
              <label>
                <span>Normalized username</span>
                <input
                  autoComplete="off"
                  autoFocus
                  name="confirmationUsername"
                  required
                />
              </label>
              <div className={styles.confirmationActions}>
                <button onClick={disableDialog.cancel} type="button">
                  Cancel
                </button>
                <button className={styles.confirmDisableButton} type="submit">
                  Disable member
                </button>
              </div>
            </Form>
          </dialog>
        ) : null}
        {deletionDialog.target ? (
          <dialog
            aria-labelledby="delete-member-heading"
            aria-modal="true"
            className={styles.confirmationDialog}
            onCancel={(event) => {
              event.preventDefault();
              deletionDialog.cancel();
            }}
            ref={deletionDialog.dialog}
          >
            <h2 id="delete-member-heading">
              Delete {deletionDialog.target.username}
            </h2>
            <p>
              This permanently removes the account and nutrition data,
              including preferences, Goal Versions, Food Entries, and Water
              Events. It cannot be recovered in this application.
            </p>
            <p>
              Enter the complete displayed username <strong>
                {deletionDialog.target.username}
              </strong> to confirm.
            </p>
            <Form
              className={styles.confirmationForm}
              method="post"
              onSubmit={deletionDialog.dismiss}
            >
              <input
                name="csrfToken"
                type="hidden"
                value={loaderData.csrfToken}
              />
              <input name="intent" type="hidden" value="delete-member" />
              <input
                name="targetUserId"
                type="hidden"
                value={deletionDialog.target.id}
              />
              <input
                name="targetUsername"
                type="hidden"
                value={deletionDialog.target.username}
              />
              <label>
                <span>Complete username</span>
                <input
                  autoComplete="off"
                  autoFocus
                  name="confirmationUsername"
                  required
                />
              </label>
              <div className={styles.confirmationActions}>
                <button onClick={deletionDialog.cancel} type="button">
                  Cancel
                </button>
                <button className={styles.confirmDeleteButton} type="submit">
                  Permanently delete member
                </button>
              </div>
            </Form>
          </dialog>
        ) : null}
      </main>
      <aside
        className={shellStyles.desktopContext}
        aria-label="Member directory privacy"
      >
        <div className={shellStyles.contextCard}>
          <span>Visible here</span>
          <strong>Account metadata</strong>
          <span>Kept private</span>
          <strong>Nutrition data</strong>
          <small>The administrator account is not listed.</small>
        </div>
      </aside>
    </div>
  );
}
