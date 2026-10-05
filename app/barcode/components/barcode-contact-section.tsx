import { useState } from "react";
import { Form, useNavigation } from "react-router";

import styles from "../barcode.module.css";

/** What the last contact action did, so the card can confirm it or keep the rejected value. */
export type BarcodeContactResult =
  | { contact: "enabled" | "updated" | "removed" }
  | { contact: "invalid"; error: string; value: string };

/** The Food Catalogs card where an administrator sets the Open Food Facts contact email. */
export function BarcodeContactSection({
  csrfToken,
  email,
  result,
}: {
  csrfToken: string;
  email: string | undefined;
  result?: BarcodeContactResult;
}) {
  const navigation = useNavigation();
  const pendingIntent = navigation.formData?.get("intent");
  const [editing, setEditing] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  // Cancel discards a rejected email; a later rejection is a new result and shows again.
  const [discarded, setDiscarded] = useState<BarcodeContactResult>();
  const invalid = result?.contact === "invalid" && result !== discarded ? result : undefined;
  const showForm = email === undefined || editing || invalid !== undefined;

  return (
    <section aria-labelledby="open-food-facts-heading" className={styles.card}>
      <div className={styles.heading}>
        <h2 id="open-food-facts-heading">Open Food Facts</h2>
        <span className={email ? styles.connected : styles.disconnected}>
          {email ? "● Enabled" : "○ Not configured"}
        </span>
      </div>
      {result?.contact === "updated" ? (
        <p className={styles.success} role="status">✓ Contact email updated.</p>
      ) : result?.contact === "enabled" ? (
        <p className={styles.success} role="status">✓ Barcode scanning enabled.</p>
      ) : email ? (
        <p>Barcode scanning is on for every member.</p>
      ) : (
        <p>
          Barcode scanning is off until you add a contact email. Open Food Facts
          uses it to identify this app; it is not used to sign in.
        </p>
      )}
      {result?.contact === "removed" ? (
        <p role="status">Barcode scanning disabled.</p>
      ) : null}
      {showForm ? (
        <Form
          action="/settings/catalogs"
          className={styles.contactForm}
          key={invalid?.value ?? email ?? ""}
          method="post"
          onSubmit={() => setEditing(false)}
        >
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <label htmlFor="off-contact-email">Contact email</label>
          <input
            aria-describedby={invalid ? "off-contact-error" : undefined}
            aria-invalid={invalid ? true : undefined}
            autoComplete="email"
            defaultValue={invalid?.value ?? email ?? ""}
            id="off-contact-email"
            maxLength={200}
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
          {invalid ? <p className={styles.error} id="off-contact-error" role="alert">{invalid.error}</p> : null}
          <div className={styles.actions}>
            <button className={styles.primary} disabled={pendingIntent === "save-off-contact"} name="intent" type="submit" value="save-off-contact">
              {email ? "Save contact email" : "Save and enable scanning"}
            </button>
            {email ? (
              <button
                onClick={() => {
                  setEditing(false);
                  setDiscarded(result);
                }}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </Form>
      ) : (
        <>
          <p className={styles.contact}>
            <strong>Contact email</strong>
            <br />
            {email}
          </p>
          {confirmingRemoval ? (
            <Form action="/settings/catalogs" method="post" onSubmit={() => setConfirmingRemoval(false)}>
              <input name="csrfToken" type="hidden" value={csrfToken} />
              <p>Disable barcode scanning for everyone?</p>
              <div className={styles.actions}>
                <button onClick={() => setConfirmingRemoval(false)} type="button">Keep scanning</button>
                <button disabled={pendingIntent === "remove-off-contact"} name="intent" type="submit" value="remove-off-contact">
                  Disable scanning
                </button>
              </div>
            </Form>
          ) : (
            <div className={styles.actions}>
              <button onClick={() => setEditing(true)} type="button">Change</button>
              <button onClick={() => setConfirmingRemoval(true)} type="button">Remove</button>
            </div>
          )}
        </>
      )}
      <p className={styles.note}>
        Scanned and typed barcodes are sent to Open Food Facts. Data available
        under the{" "}
        <a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="noreferrer" target="_blank">ODbL</a>.
      </p>
    </section>
  );
}
