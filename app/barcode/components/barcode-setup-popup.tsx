import { useEffect, useRef } from "react";
import { Link } from "react-router";

import styles from "../barcode.module.css";

/** Tells an administrator that barcode scanning needs an Open Food Facts contact email first. */
export function BarcodeSetupPopup({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  return (
    <dialog
      aria-labelledby="barcode-setup-heading"
      aria-modal="true"
      className={styles.setupDialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Keys stay with this dialog, so Escape closes it rather than the Add Food dialog behind it.
      onKeyDown={(event) => event.stopPropagation()}
      ref={dialog}
    >
      <h2 id="barcode-setup-heading">Barcode scanning is not enabled</h2>
      <p>
        Open Food Facts requires a contact email before this app can look up
        barcodes. Add one in Food Catalogs to enable scanning for every member.
      </p>
      <div className={styles.actions}>
        <button onClick={onClose} type="button">Cancel</button>
        <Link className={styles.primary} to="/settings/catalogs">Go to Food Catalogs →</Link>
      </div>
    </dialog>
  );
}
