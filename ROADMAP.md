# Roadmap

Ideas and fixes, roughly in the order they'll land. Many came from people trying the dashboard; thanks.

## Done in v2.1

- **Stale prompt safety.** Answering a permission prompt in the terminal while the dashboard is down must clear "Needs you" when it reconnects, and a new prompt replacing an old one must look new: each card shows the tool, the command or target, and when it was asked, and briefly flags "new prompt". A test covers prompt → dashboard down → answered in terminal → reconnect.
- **Ready vs needs you.** "Done, waiting for your next prompt" stays out of the Needs you queue but gets its own calm "Ready (N)" chip, so idle sessions are findable without looking urgent.
- **Looping detection.** A session silently retrying a failing test is the expensive kind of stuck. New "Looping" state when the same tool and command fails N times in a row, or an edit → test → fail cycle repeats on the same failure, or tokens keep burning with no new passing check. The card says how long, how many failures and the estimated cost since it started, with a link to the first failing call. Thresholds are configurable.
- **Tokens since last file change** (from replies). Per lane and per item: new tokens (input, output, cache write) and time passed since the last successful file edit, reset by every Edit / Write / apply_patch (a failed edit does not count); cache reads are shown apart and never counted. Shown on lane cards ("41k tok (+3.1M cached) since last change · 18m") and as a sortable column in the Home and project tables, and used by the looping rule for burning tokens (300k new tokens, or an optional est. cost, and 10 minutes with no file change, no passing check, and 3 failures or a failed check; configurable).
- **Faster "Needs you".** Claude Code's PermissionRequest hook (fires when the permission dialog opens, not ~6 s later like the permission Notification, which stays as the fallback), and `GET /api/events` pushes "changed" to the page as soon as a hook line lands or a live session file grows; polling stays as the fallback.

## Done in v2.2

- Fixed: the Usage page left blank space under the harness cards at some widths, and one empty cell on phones.
- Fixed: a subagent file that failed to read once stayed hidden until it changed; it is now retried on the next request.
- Fixed: Haiku 3 was priced at the Haiku 3.5 rate; it now has its own list price.
- Fixed (Codex): a sibling tool call's hook could clear a wait while another approval was still open (parallel tools). Waits are keyed by tool call id when the hook payload has one.
- Codex: `CODEX_HOME` is honoured (sessions default to `$CODEX_HOME/sessions`).
- Prices for newer OpenAI models (gpt-6-astra, gpt-6.1-sol, gpt-5.6-sol/terra/luna, gpt-5.5, gpt-5.4, gpt-5.4-mini) from OpenAI's pricing page, short-context Standard rates. Models not on that page stay unpriced (–).
- Calls joined to config: the Calls tab lists each configured MCP server and skill as used, loaded but not used, or failing (by error rate); the project page names MCP servers no recent session called. Config files are read for names only.
- Same-file warning: two sessions or runs of one project (any worktrees) that edited the same repo-relative path within 30 minutes show a warning on the project page and on both items' rails.
- Turns view: each assistant turn's input, cache read, cache write and output tokens with an estimated cost, sortable by cost, with markers where the context dropped sharply (compaction) and a short "why expensive" hint. Claude Code and Codex.
- Cost per pull request (branches mapped to PRs through `gh`, cached, optional) and budgets per project, worktree or branch in `~/.mission-control/config.json`, with bars on the Usage page and a top-bar chip at 80% and 100%.
- Usage-window estimate (Claude Code): the current rolling window from local logs, with "at this rate you hit the limit in ~1h 40m" when you set your own limit in `config.json` (`usageWindow`), or "no limit set". Always labelled an estimate; it never claims Anthropic's actual limits.
- Hook targets mask obvious secrets; the Codex approval message shows the masked command, never the model's description.
- A subagent's permission request that Claude Code auto-denies (background, no prompt possible) leaves Needs you after 10 s unless the permission notification confirms it.
- Checks are recognised by the program at the head of a command (or the npm/pnpm/yarn/bun script name), not by a word anywhere in it.
- Same-file warnings ignore a resumed or forked session replaying its parent's edits; PR lookups run in parallel per project.

## Later

- Answer prompts from the browser (allow / deny / pick an option) through the hooks, not by reading the terminal screen.
- Cost per task (spec-kit task, Ronin stage).
- Approve and steer from a phone (local-first PWA).
- Rewind or fork a session from its log.
- More readers: opencode, Pi.
- A terminal UI over the same data.
- Fleets (from a reply showing Skiff): a level above projects that groups several repos, so one view covers a release across all of them.
- Hand-off ledger: what was handed from one session or run to another, to whom, and how far along it is (for example 0/4 items done), with a link to each result.
- Unread: sessions and runs that finished since you last opened them, as a count in the top bar and a dot in the sidebar.

## Known small issues

None open right now.

## Verified by ronin, 2026-11-03 (specs/001-mission-control-v2-3-answer)

- **Date:** 2026-11-03.
- **Device:** none. This was a code and documentation review only. No phone, emulator or live Claude Code or Codex session was used.
- **Cases tried:**
  - README and docs statements against the hook code.
  - The `sw.js` `/api/` bypass: expected no caching, observed network-only.
  - The hook timeout (`waitSeconds + 15`): observed.
  - `onFailure` in `src/`: only a comment mentions it.
  - Hex and rgb literals in the remote UI files: none found.
  - The spike outcome in the docs: Claude Code B (2.1.317), Codex C (0.159.3).
- **Not verified:**
  - T21: no per-class test results were provided, so that task is open.
  - T22: the temp-home test setup was not inspected.
  - T24–T26: no device or tailnet, no pairing, no live prompts, no installability or offline checks, and `audit.jsonl` was not read.
  - iOS Safari and the Android install flow.
- **T27:** open. `ROADMAP.md` is unchanged. It still lists "Answer prompts from the browser" (line 33) and "Approve and steer from a phone" (line 35) under Later, and has no "Done in v2.3". Ronin needs to add "Done in v2.3" with the remote answering items. It should remove both Later lines, with a note that steering is still not done.
- **T23:** the docs name the outcomes and versions. `test/remote-spike-outcome.test.mjs` exists and is described as covering them. I did not see it pass.

Done: none
