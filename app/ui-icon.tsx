export type UiIconName =
  | "barcode"
  | "calendar"
  | "camera"
  | "cancel"
  | "copy"
  | "database"
  | "delete"
  | "external"
  | "goals"
  | "help"
  | "info"
  | "key"
  | "link"
  | "lock"
  | "log"
  | "plus"
  | "pencil"
  | "retry"
  | "search"
  | "save"
  | "settings"
  | "sparkle"
  | "users"
  | "utensils"
  | "water";

export function UiIcon({ name }: { name: UiIconName }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {name === "camera" ? (
        <>
          <path d="M8 5l1.5-2h5L16 5h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <circle cx="12" cy="13" r="4" />
        </>
      ) : name === "cancel" ? (
        <path d="M5 5l14 14M19 5 5 19" />
      ) : name === "copy" ? (
        <>
          <rect height="13" rx="2" width="13" x="8" y="8" />
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
        </>
      ) : name === "delete" ? (
        <>
          <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />
        </>
      ) : name === "save" ? (
        <>
          <path d="M3 3h14l4 4v14H3V3Z" />
          <path d="M7 3v6h9V3M7 21v-8h10v8M14 5v3" />
        </>
      ) : name === "search" ? (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </>
      ) : name === "barcode" ? (
        <path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 8v8M10 8v8M14 8v8M17 8v8" />
      ) : name === "pencil" ? (
        <path d="m16 3 5 5L9 20l-6 1 1-6ZM13 6l5 5" />
      ) : name === "retry" ? (
        <><path d="M21 12a9 9 0 1 1-3.36-7.03L21 8" /><path d="M21 3v5h-5" /></>
      ) : name === "lock" ? (
        <>
          <rect height="10" rx="2" width="14" x="5" y="10" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>
      ) : name === "settings" ? (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.87-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.35.3.57.65.6 1.1v3.5a1.7 1.7 0 0 0-.6 1.4Z" />
        </>
      ) : name === "calendar" ? (
        <>
          <rect height="16" rx="2" width="18" x="3" y="5" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </>
      ) : name === "utensils" ? (
        <path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M16 3v18M16 3c3 2 4 6 0 9" />
      ) : name === "water" ? (
        <path d="M12 2S5.5 9.4 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 9.4 12 2 12 2Z" />
      ) : name === "log" ? (
        <>
          <rect height="18" rx="2" width="16" x="4" y="3" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </>
      ) : name === "database" ? (
        <>
          <ellipse cx="12" cy="6" rx="7" ry="2.5" />
          <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
        </>
      ) : name === "goals" ? (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
        </>
      ) : name === "key" ? (
        <>
          <circle cx="8" cy="15" r="4" />
          <path d="m11 12 8-8M16 7l2 2" />
        </>
      ) : name === "link" ? (
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      ) : name === "sparkle" ? (
        <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
      ) : name === "users" ? (
        <>
          <circle cx="9" cy="8.5" r="3.5" />
          <path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.6.7 2.7 2.6 3 5.2" />
        </>
      ) : name === "plus" ? (
        <path d="M12 5v14M5 12h14" />
      ) : name === "external" ? (
        <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
      ) : name === "help" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.8 9a2.4 2.4 0 1 1 3.25 2.25c-.7.3-1.05.75-1.05 1.75M12 17h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </>
      )}
    </svg>
  );
}
