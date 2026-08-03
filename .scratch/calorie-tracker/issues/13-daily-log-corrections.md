# 13 - Navigate and correct the Daily log

**What to build:** Complete the day-first log workflow for historical review and correction without changing reusable Foods or unrelated history.

**Blocked by:** 12 - Log a manual Food with an immutable Nutritional snapshot.

**Status:** ready-for-agent

**Mockup starting point:** Start with the Daily log date controls, past-date fixture, newest-first feed, entry overflow menu, delete dialog, and undo toast in `public/mockup.html`.

- [ ] Previous-day, next-day, date-picker, and Return to today controls load any Daily log using the User's configured Timezone; stored UTC timestamps display on the correct local date and time.
- [ ] Entries remain one newest-first chronological feed and support optional Breakfast, Lunch, Dinner, and Snack meal tags without creating visual meal sections.
- [ ] Edit Entry can change date, time, quantity, meal tag, and the entry's Food details while affecting only that Food entry and its resulting snapshot.
- [ ] Reusable Food definitions and other Food entries remain unchanged when one historical entry is edited.
- [ ] Delete requires confirmation, removes the entry atomically, and exposes a short-lived undo action that restores the entry with its snapshot.
- [ ] Daily summaries and missing-data warnings update correctly for every date and correction.
