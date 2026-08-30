# Safari on iPhone release checklist

Use this checklist against the production HTTPS URL after the Chromium browser
suite passes. Record the device, iOS version, Safari version, URL, date, and
tester with the release evidence.

This application does not install a service worker. Do not certify airplane-mode
or disconnected use.

## Preparation

- Use a supported iPhone in portrait orientation with Safari at the default text
  size and page zoom.
- Remove an older Home Screen icon for the same URL before testing installation.
- Start with a private test account that can be deleted after the release check.
- Confirm the production USDA key is configured, then keep one saved Food Entry
  available for the provider-unavailable check.

## Layout, touch, and accessibility

- Open registration, setup, today's Food Log, History, Settings, password change,
  food search, Food Entry edit, and Water Event add/edit surfaces.
- Confirm every surface fits at 100% and 200% page zoom without horizontal page
  scrolling, clipped controls, or overlapping the Safari chrome or safe areas.
- Rotate to landscape and back on the Food Log and in each dialog; confirm content
  remains readable and the focused field stays usable.
- Activate every visible control near its edge. Confirm links, buttons, date cells,
  carousel controls, fields, and dialog close controls respond without requiring
  pixel-precise taps.
- With Reduce Motion enabled in iOS, confirm Food Entry interactions do not animate.
- With a hardware keyboard if available, confirm the skip link, focus indicator,
  dialog focus loop, Escape close behavior, and mobile Settings sign-out action.

## Authentication and persistence

- Register, complete setup, close Safari, reopen it from the app switcher, and
  confirm the authenticated session persists.
- Sign out from mobile Settings, confirm the login page appears, then sign in again.
- Change the password, confirm the current phone remains signed in, and confirm the
  old password no longer signs in from a second private Safari tab.

## Food Log, date behavior, and summaries

- Move to the previous day and back to today with the date rail; open History and
  select a logged day.
- Confirm tomorrow and later dates cannot accept Food Entries or Water Events.
- Search USDA for a food, choose a measurement and quantity, and add it to the log.
- Edit the saved Food Entry name and quantity, then confirm calories and nutrient
  summaries update. Confirm an incomplete nutrient is announced as incomplete and
  is not presented as zero.
- Switch both nutrition carousel pages and confirm progress semantics remain
  understandable with VoiceOver.
- While the USDA test endpoint is unavailable, reopen the saved day and confirm the
  local Food Entry and its Nutrition Snapshot remain readable.
- Delete the Food Entry and confirm the daily summaries update.

## Goals and Water Events

- Save a Goal Version for today or a future local date and confirm the success
  message names the effective date.
- Return to an earlier Food Log date and confirm it retains the goals effective on
  that date.
- Add a Water Event from a preset, edit it to an exact amount and time, and confirm
  the Water summary changes after each action.
- Delete the Water Event and confirm it disappears and the Water summary decreases.

## Add to Home Screen

- In Safari, use Share → Add to Home Screen.
- Confirm the preview uses the Open Calory Tracker title and the supplied app icon.
- Add it, launch it from the Home Screen, and confirm it opens at the canonical app
  URL in a standalone window with the expected theme colors.
- Sign in if needed, close the standalone window, relaunch it, and confirm the
  authenticated Food Log opens with the same saved records and local date.

## Release record

Mark each section pass or fail. For a failure, capture the page, orientation, zoom
or accessibility setting, exact action, expected result, actual result, and a
screenshot or screen recording. Do not ship until every failure is resolved or
explicitly accepted for the release.
