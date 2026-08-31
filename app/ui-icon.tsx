export type UiIconName =
  | "calendar"
  | "external"
  | "info"
  | "lock"
  | "log"
  | "plus"
  | "settings"
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
      {name === "lock" ? (
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
      ) : name === "plus" ? (
        <path d="M12 5v14M5 12h14" />
      ) : name === "external" ? (
        <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </>
      )}
    </svg>
  );
}
