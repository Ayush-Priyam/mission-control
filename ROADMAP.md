# Roadmap

Ideas and fixes, roughly in the order they'll land. Many came from people trying the dashboard; thanks.

## v2.1 (in progress)

- **Stale prompt safety.** Answering a permission prompt in the terminal while the dashboard is down must clear "Needs you" when it reconnects, and a new prompt replacing an old one must look new: each card shows the tool, the command or target, and when it was asked, and briefly flags "new prompt". A test covers prompt → dashboard down → answered in terminal → reconnect.
- **Ready vs needs you.** "Done, waiting for your next prompt" stays out of the Needs you queue but gets its own calm "Ready (N)" chip, so idle sessions are findable without looking urgent.
- **Tokens since last file change.** A per-lane count of tokens and minutes since the agent last changed a file, shown on lane cards and as a column, so a session that looks busy but makes no diff stands out.
- **Looping detection.** A session silently retrying a failing test is the expensive kind of stuck. New "Looping" state when the same tool and command fails N times in a row, or an edit → test → fail cycle repeats on the same failure, or tokens keep burning with no new passing check. The card says how long, how many failures and the estimated cost since it started, with a link to the first failing call. Thresholds are configurable.
- **Faster "Needs you".** Use Claude Code's PermissionRequest hook where available (fires when the permission dialog opens, not later), and push updates to the page as soon as a hook line lands instead of waiting for the next poll.

## Later

- Answer prompts from the browser (allow / deny / pick an option) through the hooks, not by reading the terminal screen.
- Why a turn was expensive: per-turn context, cache and compaction view.
- Two agents editing the same file in different worktrees: warning on the project page.
- Cost per task, PR or worktree with budget alerts.
- "Will this finish before my usage window resets?"
- Approve and steer from a phone (local-first PWA).
- Rewind or fork a session from its log.
- More readers: opencode, Pi.
- A terminal UI over the same data.

## Known small issues

None open right now.

## Done in v2.2

- Fixed: the Usage page left blank space under the harness cards at some widths, and one empty cell on phones.
- Fixed: a subagent file that failed to read once stayed hidden until it changed; it is now retried on the next request.
- Fixed: Haiku 3 was priced at the Haiku 3.5 rate; it now has its own list price.
- Fixed (Codex): a sibling tool call's hook could clear a wait while another approval was still open (parallel tools). Waits are keyed by tool call id when the hook payload has one.
- Codex: `CODEX_HOME` is honoured (sessions default to `$CODEX_HOME/sessions`).
- Prices for newer OpenAI models (gpt-6-astra, gpt-6.1-sol, gpt-5.6-sol/terra/luna, gpt-5.5, gpt-5.4, gpt-5.4-mini) from OpenAI's pricing page, short-context Standard rates. Models not on that page stay unpriced (–).
- Calls joined to config: the Calls tab lists each configured MCP server and skill as used, loaded but not used, or failing (by error rate); the project page names MCP servers no recent session called. Config files are read for names only.
