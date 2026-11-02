# Roadmap

Ideas and fixes, roughly in the order they'll land. Many came from people trying the dashboard; thanks.

## v2.1 (in progress)

- **Stale prompt safety.** Answering a permission prompt in the terminal while the dashboard is down must clear "Needs you" when it reconnects, and a new prompt replacing an old one must look new: each card shows the tool, the command or target, and when it was asked, and briefly flags "new prompt". A test covers prompt → dashboard down → answered in terminal → reconnect.
- **Ready vs needs you.** "Done, waiting for your next prompt" stays out of the Needs you queue but gets its own calm "Ready (N)" chip, so idle sessions are findable without looking urgent.
- **Looping detection.** A session silently retrying a failing test is the expensive kind of stuck. New "Looping" state when the same tool and command fails N times in a row, or an edit → test → fail cycle repeats on the same failure, or tokens keep burning with no new passing check. The card says how long, how many failures and the estimated cost since it started, with a link to the first failing call. Thresholds are configurable.
- **Tokens since last file change** (from replies). Per lane and per item: tokens used and time passed since the last successful file edit, reset by every Edit / Write / apply_patch (a failed edit does not count). Shown on lane cards ("412k tok since last change · 18m") and as a sortable column in the Home and project tables, and used by the looping rule for burning tokens (300k tokens and 10 minutes with no file change and no passing check, configurable).
- **Faster "Needs you".** Use Claude Code's PermissionRequest hook where available (fires when the permission dialog opens, not later), and push updates to the page as soon as a hook line lands instead of waiting for the next poll.

## Later

- Answer prompts from the browser (allow / deny / pick an option) through the hooks, not by reading the terminal screen.
- Calls joined to config: MCP servers and skills that are loaded but never used, or used and failing.
- Why a turn was expensive: per-turn context, cache and compaction view.
- Two agents editing the same file in different worktrees: warning on the project page.
- Cost per task, PR or worktree with budget alerts.
- "Will this finish before my usage window resets?"
- Approve and steer from a phone (local-first PWA).
- Rewind or fork a session from its log.
- More readers: opencode, Pi. `CODEX_HOME` support for Codex.
- Price table entries for newer OpenAI models.
- A terminal UI over the same data.

## Known small issues

- Usage page leaves blank space under the harness cards at some widths; one empty cell on phones.
- A subagent file that fails to read once stays hidden until it changes.
- Haiku 3 is priced at the Haiku 3.5 rate.
- Codex: a sibling tool call's hook can clear a wait while another approval is still open (parallel tools).
