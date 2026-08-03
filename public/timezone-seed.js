(() => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone) return;
  fetch("/settings/timezone/seed", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ timezone }),
  }).then((response) => {
    if (response.status === 204) window.location.reload();
  }).catch(() => {
    // The configured bootstrap timezone remains usable if the browser cannot seed it.
  });
})();
