# SPEC-541d24c7 visual fix and independent review

The three reported presentation issues are fixed in the working tree and passed independent screenshot and interaction review. A delegated implementation agent made the changes; the primary agent inspected the diff and reviewed the rendered application using chrome-devtools-axi. The parent spec remains open for its real-device/provider and deployment acceptance work.

## Changes

- `app/routes/settings.security.tsx`: visible Delete labels stay compact. Accessible labels retain the complete credential name, and deletion confirmation identifies the complete selected name. The confirmation heading supports long unbroken names. Destructive confirmation and cancellation now have distinct controls.
- `app/account.module.css`: explicit list spacing removes the extra indentation. Stable two-column rows align names and deletion controls. Long names wrap in their own column without expanding the button. Delete triggers use an outlined danger style, confirmation uses a solid danger style, and cancellation uses a neutral style. Busy/disabled treatment remains visible. New styles are scoped to the security controls.
- `tests/routes/key-authentication-route.test.ts`: the existing component selector follows the accessible button label after shortening the visible text. No new implementation-mirroring tests were added.

## Independent browser review

Review used a fresh temporary database, synthetic administrator `visual.qa`, local HTTPS, Chrome 153, and actual WebAuthn registration/assertions through CDP virtual CTAP2 authenticators. Names such as YubiKey personal and Proton Pass en el móvil are fixture labels; they do not establish physical YubiKey or Proton Pass compatibility. The 80-Q name is a deliberate maximum-length stress case, separated below from the normal-name screenshots. Application authentication responses were not stubbed.

| Check | Result |
| --- | --- |
| Normal-name mobile/desktop screenshots | Names share the surrounding content's left edge; deletion buttons share a right column. Reviewed full-page screenshots, not just cropped viewport captures. |
| 80-character unbroken name | Complete name remains readable and wraps in its column; the visible Delete control stays one line and 44px tall. At 390px, all three Delete controls measured 72.42px wide with the same right edge (361px); names started at 29px. |
| 320px, 390px, and 1280px widths | No horizontal document overflow in the measured layouts. Long confirmation headings also wrap. At 320px, confirmation actions wrap onto separate lines without going off-screen. |
| Dark/light themes | Normal-name screenshots and stress-case rendering were inspected. Danger and neutral controls remain distinct; green enrollment/mode controls remain unchanged. |
| Target identity and keyboard focus | Accessible deletion labels name their own credential. Confirmation shows the entire selected name and focuses Confirm deletion in key mode. |
| Cancellation and busy state | With simulated presence withheld, confirmation/cancel and other mutations were disabled; Cancel key prompt remained available. Canceling returned a retry alert and retained the selected key and mode. |
| Password-mode removal | Removed the retained stress-case key with fresh current-password proof, returned to login, and verified the other named keys remained. |
| Retained-key enrollment/re-enable | Enrolled Backup security key while in password mode; addition preserved that mode. Explicit key proof then re-enabled key login. |
| Individual removal and subsequent login | Backup security key freshly authorized deletion of another key. Deletion revoked the current session. Backup key login worked afterward and key mode remained enabled with the remaining credentials. |
| Removal through the final key | Removed the remaining credentials using the backup key. The last-key confirmation retained its password-mode warning; Enter confirmed the backup key's self-authorized deletion. The unchanged fallback password then worked, and settings showed password mode/new enrollment. |
| Accessibility | Axe scans returned zero violations on the reviewed light/dark security/confirmation states (34 passing rules). This complements screenshot and keyboard inspection; it is not a real screen-reader/provider compatibility claim. |
| Final loaded page | No console messages and no 404/500 requests in the final security-page network listing. |

## Screenshots

Normal-name evidence:

- [Mobile, dark](visual-fix/fixed-normal-dark-mobile.png)
- [Mobile, light](visual-fix/fixed-normal-light-mobile.png)
- [Desktop, dark](visual-fix/fixed-normal-dark-desktop.png)
- [Ordinary deletion confirmation](visual-fix/fixed-normal-confirmation-mobile.png)
- [Final-key confirmation](visual-fix/fixed-final-key-confirmation-mobile.png)

Maximum-length stress evidence:

- [Before correction, mobile](visual-fix/before-fix-mobile.png)
- [After correction, mobile](visual-fix/after-fix-mobile.png)
- [Long-name confirmation, 390px](visual-fix/after-fix-confirmation-mobile.png)
- [Long-name confirmation, 320px](visual-fix/after-fix-confirmation-small-mobile.png)
- [Long-name confirmation, desktop](visual-fix/after-fix-confirmation-desktop.png)

## Verification and scope

`pnpm verify` passed: typecheck, lint/policy, 1413 deterministic tests in 72 files, Fallow audit, and production dependency audit. `pnpm build` and `git diff --check` passed. Fallow emitted a nonblocking CSS-duplication advisory; its audit gate passed without baseline changes.

The first fast-gate attempt overlapped the primary agent's build and failed two production-server tests. The isolated production rerun passed all 12 tests, and the full fast-gate rerun passed. The preview was restarted after verification rebuilt production assets, and interaction checks completed against that stable build.

No commit, push, PR, production deployment, or parent closure was performed. Actual YubiKey USB/NFC/browser, Proton Pass extension/mobile, and deployment-host checks remain required by the spec. This follow-up resolves the three scoped visual findings; it does not claim full release acceptance.
