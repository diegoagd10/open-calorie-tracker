# UI reference

`docs/mocks/` is the approved visual and interaction reference for the product UI.

Before creating or modifying UI, open `docs/mocks/index.html` in a browser and inspect the relevant responsive layout and interaction states. Use `index.html`, `styles.css`, and `script.js` together to understand the intended hierarchy, visual language, and behavior.

Apply the mock's patterns within the production codebase's architecture and accessibility requirements. When the mock does not cover a needed state, extend its visual language rather than introducing an unrelated pattern.

UI work is complete when every affected surface and state has been rendered and compared with the relevant mock at each affected breakpoint; any deliberate visual or interaction deviation is reported to the user.
