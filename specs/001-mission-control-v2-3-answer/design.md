# Design

Chosen: Direction A (Jev mean 1.71 of 3)

| dimension | A | B |
|---|---|---|
| fit | 1.13 | 0.37 |
| tokens | 1.85 | 1.62 |
| density | 1.89 | 0.90 |
| a11y | 1.96 | 0.98 |
| mean | 1.71 | 0.97 |

## Direction A

**"The queue": a phone version of the desktop Needs you card, one card per entry in a scrolling list.**

**Screens and layout (390×844)**
- **Header:** the status bar, then "Needs you" in 22px semibold with the count in an amber pill, the mono sub-line "2 you can answer here · 1 at the terminal", and a `live` dot.
  - The dot follows the event stream: green and pulsing while it's connected, grey with no pulse after the stream has been down for 5 s.
- **List:** cards 16px from the edge with 12px gaps, oldest first.
  - **Permission card:** an eyebrow ("CLAUDE CODE · PERMISSION"), "asked 2m ago", the session title, a project line in mono, and the full masked target wrapped in an inset. Then **Deny | Allow** at 52px.
  - **Ask card:** the question header, the question, and one 60px option per choice.
    - One question: a tap sends.
    - Several questions: the options act as a radio group, and **Send answers** stays disabled until every question has a pick.
  - **Read-only card:** `--card` fill with a `--border` frame, plus a terminal icon and "answer where the agent runs".
- **Results (A-2):**
  - An answered card collapses in place to "Allowed", "Denied" or "Answered".
  - A refused card changes to a neutral frame and shows the reason in `--failed`, with no buttons.
  - If the prompt was replaced, the new prompt is a separate card with the "new prompt" badge.
  - Both kinds of card stay until the next fetch removes them.

**Components and tokens:**
- **Components:** the `Card` frame with the NeedsYouCard amber tint (`NeedsYouCard.tsx:64`); `Button` default as Allow; `Button destructive` with a 10% fill and a 40% border as Deny; `Button outline` for the options; `Badge outline` for "new prompt"; `Skeleton`; `Alert`.
- **Tokens:**
  - **Colours:** `--needs-you` #f59e0b, `--running` #22c55e, `--failed`/`--destructive` #ef4444, `--muted-foreground` #a1a1aa, `--faint` #8a8a93, `--border` #27272a, `--input` #3f3f46, `--card` #111113, `--background` #09090b, `--primary` #f4f4f5.
  - **Radii:** `--radius` 8px and radius-xl 11.2px.
  - **Type:** 15px base on the phone, with the 12px floor kept.

**States**

| State | What shows |
|---|---|
| First load | Two `Skeleton` cards from first paint until the first `/api/remote/prompts` response, and nothing else. |
| Later refetches | No skeletons. The current cards stay up and update in place. |
| First load fails at the network level | The "offline, can't answer" banner over the skeletons, which stop pulsing. Retries when the event stream reconnects. |
| Empty (`{prompts:[]}`) | A centred amber ring icon and "Nothing needs you right now." The live dot shows stream health. If offline, the banner sits above the copy. If result cards are still showing, it waits until the next fetch drops them. |
| Not paired (no cookie) | "Run `mission-control remote pair` on your computer." in a mono inset. |
| Revoked (401 with a cookie) | "This device was revoked. Pair again." plus the command. The list is cleared from memory. |
| Pairing `/pair` | A spinner and "Pairing this phone…". An expired or used link shows "pairing link expired or already used" and the command. A 429 shows "Too many tries. Wait a minute, then scan a new code." |
| In flight | **The whole tapped card locks.** The tapped button shows a spinner and "Allowing…", its siblings and options are disabled, and the card gets `aria-busy`. Other cards stay answerable. On a multi-question card, Send is the tapped button and every pick locks. |
| 200 | "Allowed", "Denied" or "Answered" with an icon and no buttons, until the next fetch removes it. |
| 409 | One of "prompt changed, nothing was approved", "already answered", "answered in terminal" or "no longer waiting". No buttons and no retry. |
| 401 mid-session | Goes to the Revoked screen. |
| Network failure or 10 s client timeout | "offline, can't answer" on that card. Its buttons unlock once the phone is online again. A retry that lands after the first POST did gets a 409 "already answered", which is safe. |
| Going offline while a POST is in flight | The banner appears and every unlocked card is disabled. The in-flight card keeps its spinner until its POST resolves. |
| 400 (malformed, a client bug) | Shown like a network failure. *(My call; the ux answer doesn't cover 400. Engineering should confirm.)* |
| Read-only, including multiSelect or free-text asks | No buttons, so no loading, lock or result states. |

**Accessibility:**
- **Targets:** buttons are at least 52px with 12px gaps.
- **Labels:** accessible names carry the tool, target and project. Each card is an `<article aria-labelledby>`. Options are a `group`, or a `radiogroup` with `aria-checked` on multi-question cards.
- **Announcements:** results and reasons are announced as `role="status"`. A refused card's reason line gets focus (`tabindex=-1`).
- **Not colour alone:** every status comes with an icon and text.
- **Focus:** the global 2px `--focus` ring is kept.
- **Contrast:** Deny is about 4.6:1 with the 10% fill (the stock 20% fill is about 4.3:1). `--faint` on the background is about 5.9:1.
- **Text size:** rem-based, so iOS text-size settings scale it.
- **Offline:** disabled buttons get `aria-disabled` and `aria-describedby` pointing at the banner.
- **Spinner:** the in-flight button keeps its text label next to the spinner, so a screen-reader user hears "Allowing…", not just a busy state.
- **Motion:** only the press (`scale(.97)`), the collapse (220ms, ease-out) and the spinner. Under reduced motion, the collapse is instant and the spinner becomes a static ring with "Allowing…".
