# WAMP play count

The WAMP spotlight displays the same `/api/v1/plays` total as the catalog cards.
It uses the exact integer so each new counted play is visible after reloading.
Failed requests omit the count instead of displaying a hardcoded historical total.

## Historical starting point

Production WAMP D1 was queried read-only on October 17, 2026. There were 66,766
`room_runs` before `2026-10-17T18:37:26.000Z`, when the new production counter
first recorded a play. They span March 13 through October 17.

The import excludes 181 records: 34 in a test-labelled room, four with a legacy
generated-account display name, and 143 with failed server verification. These
sets did not overlap at the audit. The resulting starting count is **66,585**.
Retries and unsuccessful gameplay remain included. No gameplay records were
deleted. This removes identifiable test/invalid activity; old unlabelled manual
testing cannot be distinguished retrospectively from ordinary play.

The audit joins `room_runs` to `users` and `rooms`, filters `started_at` before
the cutover, and excludes these predicates:

- Lowercased `COALESCE(published_title, draft_title, '')` contains `test`, `smoke`
  or `fixture`.
- The run display name starts with `playfun-`, or the user has a
  `playfun_user_links` entry and has neither email nor wallet.
- `verification_status = 'failed'`.

This is a conservative legacy starting count, not a unique-player measure.
Course/expanded-room copies and guest visit counts are not added, avoiding
overlap and differing retention windows.

## Continuing growth

Migration 0011 inserts the starting count once under a separate historical
source. Reapplying it does nothing. It never replaces the `direct` or `mann.cool`
sources, so existing plays and concurrent arrivals are preserved.

F091's WAMP integration adds one play after each successful production app boot.
This is the same opening-based convention used by the other mann.cool games;
it is not an ongoing sum of every WAMP room attempt. The displayed count is the
historical starting point plus these new plays. Localhost and Pages previews
do not report; automated canonical-domain checks must intercept the play POST
so their traffic does not enter the public count.

To verify: run `npm run test:external-plays`, then load the homepage with a
mocked API total before/after an increment. On production compare the card to
both the single-game and all-games API totals. Do not leave verification plays
in the public total.
