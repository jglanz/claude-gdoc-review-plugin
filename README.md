# claude-gdoc-review-plugin

A Claude Code plugin that turns plan approval into a Google Doc review round.
Instead of the built-in `ExitPlanMode` dialog, every attempt to present a plan
first syncs the plan markdown into a Google Doc, has Claude answer and resolve
the reviewer comments the new revision addresses, posts a revision-log entry,
and then shows its own approval menu with the Doc URL — so a plan is approved
the way a document is approved, with the comment thread as the record. The
plugin is inert until you run `/gdoc-review` for a plan: with no review state
for the current plan file, the hooks print nothing and Claude Code behaves
exactly as it does without the plugin.

## The menu

Once a plan is synced, Claude presents exactly four options (plus the free-text
"Other" row `AskUserQuestion` always adds):

| Option                                            | What happens                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Approve and Use Auto Mode**                     | Plan approved; the session switches to `acceptEdits` with no built-in dialog. |
| **Approve Manual Mode**                           | Plan approved; the session switches to `default` (approve each edit).         |
| **Check Google Doc for new comments and changes** | Claude re-reads the Doc, revises the plan, syncs again and asks again.        |
| **Do something else**                             | Claude does what you asked and stays in plan mode.                            |

Free text typed into "Other" is treated like **Do something else**: the hook
quotes your words back to Claude inside explicit delimiters and keeps the
session in plan mode.

The first row's description names the mode it actually switches to, which is
`acceptEdits` by default and `auto` when `approveAutoMode` says so — the menu
Claude presents and the hook that reads the answer both derive it from that one
setting.

## Prerequisites

- **Node >= 24.9** on `PATH` (the hooks run `node` directly).
- **A `workspace-mcp` server connected in Claude Code** with at least
  `--tools docs drive`. Any server name works: the plugin matches tools by
  suffix (`mcp__<server>__update_drive_file`), never by server name. If several
  such servers are connected, Claude asks which one to use.

That server has two calling rules the skill and the round protocol restate on
every round, because breaking either one fails the call or silently destroys the
formatting:

1. **Every parameter key must be present.** Omitted optionals fail client-side
   validation ("expected nonoptional, received undefined") — pass JSON `null`
   for every parameter you do not use.
2. **Always pass `source_format: "md"`.** A Doc title carries no extension, so
   auto-detection can fall back to plain text.

## Install

Clone the repository, build the runtime once, then point Claude Code at the
checkout:

```bash
git clone https://github.com/jglanz/claude-gdoc-review-plugin
cd claude-gdoc-review-plugin
pnpm install && pnpm build
claude --plugin-dir "$PWD"
```

The runtime is the single bundle `dist/gdoc-review.cjs`, which is a build output
and not committed, so a checkout needs that one build before the hooks can run.
Rebuild after pulling changes.

## Usage

Enter plan mode, then set up the review once per plan:

```
/gdoc-review PersonalDrive "design/plans/MySpecialPlan"
/gdoc-review SharedDrive Engineering "design/plans/MySpecialPlan"
```

The quoted argument is a Drive folder path whose **last segment is the Doc
title**; the earlier segments are folders, created when they do not exist. An
existing Doc at that path is reused, so re-running the command never creates a
second Doc. Share the Doc with your reviewers yourself — the plugin never
changes its sharing.

From then on, every `ExitPlanMode`:

1. is denied while the Doc does not hold the current plan text, with the full
   round protocol as the tool error;
2. Claude reads the comments, revises the plan for what it addresses, syncs the
   Doc, replies to and resolves the answered threads, and posts
   `🤖 Rev N synced … — addressed X, open Y` on the revision-log thread;
3. Claude shows the four-option menu with the Doc URL and the counters;
4. on either approve option Claude calls `ExitPlanMode` again — this time the
   gate is silent, and the plugin answers the permission prompt with the mode
   switch, so no approval dialog appears.

Reviewer comments that arrive while you are deciding are picked up by option 3:
Claude revises the plan file, which invalidates the recorded sync and forces a
fresh round before the next approval.

An approval is **single-use and short-lived**: the plugin answers the first
permission prompt it fits and marks it spent, and it stops counting 30 minutes
after you gave it. While the review is still active, a decision that was already
spent — or one older than 30 minutes, or dated in the future — counts as no
decision at all, so the next `ExitPlanMode` is denied with the menu again. Once
an approval has actually been spent the review is `approved` and the gate stops
firing for that plan altogether, so a later `ExitPlanMode` is not gated at all
and Claude Code's own dialog answers it; `reactivate` puts the plan back under
review. Only an answer you gave on the menu itself skips the dialog — an
approval recorded with the `decision` command opens the gate but leaves Claude
Code's own approval dialog in place, which is the intended fallback.

## Configuration

`~/.claude/gdoc-review/config.json` (or
`$CLAUDE_CONFIG_DIR/gdoc-review/config.json`); every key is optional, and each
has an environment override that wins over the file.

| Key               | Values                 | Default       | Environment override       |
| ----------------- | ---------------------- | ------------- | -------------------------- |
| `approveAutoMode` | `acceptEdits`, `auto`  | `acceptEdits` | `GDOC_REVIEW_APPROVE_MODE` |
| `syncMode`        | `content`, `file_path` | `content`     | `GDOC_REVIEW_SYNC_MODE`    |
| `replyPrefix`     | any string             | `🤖`          | `GDOC_REVIEW_REPLY_PREFIX` |
| `logLevel`        | `log`…`fatal`          | `info`        | `GDOC_REVIEW_LOG_LEVEL`    |

`approveAutoMode: "auto"` is opt-in: when the permission prompt does not offer
`auto`, the plugin falls back to `acceptEdits`. It also changes what the first
menu row says it will do, so the row you read names the mode you are approving.

`syncMode: "file_path"` makes Claude sync by handing the server the plan file
path instead of the plan text. It only works when the server is started with
that directory allowed, e.g. `ALLOWED_FILE_DIRS=$HOME/.claude/plans`; the
default `content` mode needs no server-side file access. The value is read when
a review is created and stored on it, so changing it later affects new reviews;
`register --sync-mode` overrides it for one review.

`replyPrefix` is any non-empty string Claude puts in front of everything it
writes into the Doc. The round protocol quotes it, and the revision-log thread
is recognized by `<prefix> Revision log` — so changing it changes both together.

`logLevel` is one of `log`, `trace`, `debug`, `info`, `warn`, `error`, `fatal` —
the levels `tracer` exposes as logger methods, from most to least verbose. It is
resolved on its own, before the rest of the configuration exists:
`GDOC_REVIEW_LOG_LEVEL`, then this key, then `info`. A missing or malformed
`config.json` leaves the default in place rather than failing a hook.

The same is true of every other key: a `config.json` that is not JSON, or an
environment override naming a value the key does not accept, is reported at
`warn` in `log.jsonl` and the layer that named it is ignored. A rejected
environment override does **not** fall back to the built-in default on its own —
it falls back to `config.json` first, and only then to the default.

`approveAutoMode` is security-relevant: it picks the permission mode the plugin
switches the session into without the built-in dialog. Degrading rather than
failing is still the right answer for it — a value the schema refuses falls back
to the narrower mode, while failing the hook would take the `ExitPlanMode` gate
down with it and let a plan through unreviewed.

The file is read from the state directory the invocation works against, so
`--state-dir X` reads `X/config.json` and the hooks read the one next to the
state they write. The diagnostics follow the same directory: `--state-dir X`
writes `X/log.jsonl`, so the log of an invocation is always beside the state it
wrote.

## State layout

Everything lives under `$CLAUDE_CONFIG_DIR/gdoc-review/` (default
`~/.claude/gdoc-review/`):

```
reviews/<plan-slug>.json   one document per plan: status, Drive target, Doc,
                           revision, lastSync digest, decision, comment log
sessions/<session-id>      cached transcript scan: { planFile,
                           transcriptMtimeMs, transcriptSize }
config.json                the keys above
log.jsonl                  diagnostics, one JSON object per line
```

The plan slug is the plan file's basename without `.md`, plus the first eight
hex characters of the SHA-256 of its absolute path — so two projects that each
have a `plan.md` are two reviews, and moving a plan file never lets it inherit
another plan's recorded approval. Everything the plugin writes is owner-only
(`0600` for files, `0700` for directories).

**Which plan a hook is about.** The session transcript is authoritative: Claude
Code appends a plan-mode attachment every time plan mode is entered, and the
last main-agent one names the plan being presented. The sessions entry is a
cache of one such scan, stamped with the transcript's size and modification
time. A hook skips the scan only while both still match — an unchanged
transcript cannot name a different plan — and rescans otherwise, which is what
makes entering plan mode a second time with a different plan land on the right
review. The entry is used as a source in its own right only when the transcript
no longer names any plan at all, which is what a compaction leaves behind. An
entry written by an older version held a bare path with no stamp; it is ignored
and rescanned.

Nothing but that scan writes the entry. A `--plan` value on an auto-allowed CLI
call is checked against it, never recorded as it.

## CLI reference

The runtime is also the CLI: `node <plugin>/dist/gdoc-review.cjs <command>`, or
`<plugin>/bin/gdoc-review <command>`. `/gdoc-review` and the hooks run these for
you; they are listed because they are also the recovery path. Every command
takes `--state-dir` to point at a different state directory: `--state-dir X`
reads and writes `X/reviews/`, `X/sessions/`, `X/config.json` and `X/log.jsonl`,
so an invocation's diagnostics land beside the state it wrote. It is on no
subcommand's Bash allow-list, so a call carrying it always asks you.

| Command                                                                                                                       | What it does                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `init --plan <file> --kind personal\|shared [--drive-name X] --path "a/b/Doc" [--force]`                                      | Creates the review (`setup`); refuses an existing one without `--force`.                      |
| `register --plan <file> --doc-id … --doc-url … --folder-id … --server <name> [--drive-id …] [--sync-mode content\|file_path]` | Attaches the Doc, records the MCP server it lives on, and activates the review.               |
| `log-thread --plan <file> --comment-id <id>`                                                                                  | Records the revision-log thread.                                                              |
| `decision --plan <file> --choice approve_auto\|approve_manual\|check_doc\|other [--text …]`                                   | Records a menu answer against the current plan text. **Never auto-allowed.**                  |
| `synced --plan <file>`                                                                                                        | Records that the Doc holds the current plan text; bumps the revision. **Never auto-allowed.** |
| `status [--plan <file>] [--json]`                                                                                             | Reports one review, or lists the active ones.                                                 |
| `cancel --plan <file>`                                                                                                        | Stops gating the plan; the built-in dialog comes back. **Never auto-allowed.**                |
| `reactivate --plan <file>`                                                                                                    | Gates the plan again and drops the recorded decision. **Never auto-allowed.**                 |
| `hook [--input <file>]`                                                                                                       | The hook entry point: reads the payload on stdin, prints hook JSON.                           |

`hook` never fails: an unreadable payload, an unknown event or a handler error
is logged and answered with empty output and exit code 0, because a hook must
never break the session it runs in. The one exception is the `ExitPlanMode`
gate, which answers its own failures with a deny — see above. That applies at
the process boundary too: the payload is parsed before anything else is built,
so a failure to build the plugin's own context still produces the deny for a
`PreToolUse` on `ExitPlanMode`, and silence for every other event.

`register` takes a `--doc-id` that is either a bare Drive file id or a
`https://docs.google.com/document/d/<id>` link, and stores it as the bare id;
`--doc-url` must be such a link. Anything else is refused: that id is what every
later write is compared against. The link the plugin records and shows is then
**rebuilt from that id** as `https://docs.google.com/document/d/<id>/edit`, so
the value you passed is validated and discarded rather than echoed — a link with
a crafted tail can never reach Claude's context through a Doc reference.

`--folder-id` and `--drive-id` are validated for **shape only** — a Drive file
id, and a Shared Drive id, which is shorter and so has its own lower length
floor; `root` and a bare folder name are refused either way. They are metadata
the `status` report prints. Nothing is authorised by them, because the write
gate compares every later call against the registered Doc alone. `--server` is
the `<server>` of the `mcp__<server>__` tools the skill is calling, without the
prefix; it is recorded with the Doc and compared against the server of every
call the gate considers.

**What the plugin auto-allows through Bash.** Only `init`, `register`,
`log-thread` and `status`, only while the session is in plan mode, only for a
plan that already has a review (`init` excepted, since it is what creates one),
and only as a single plain invocation with no shell metacharacter. A session
whose plan file cannot be located from the transcript gets nothing at all,
`init` included: with no plan-mode attachment the only source left would be the
command line's own `--plan`, which is the claim this gate exists not to act on.

Each auto-allowed subcommand has its own list of accepted long flags, and a flag
outside it — `--state-dir`, or a flag another subcommand owns — is a refusal;
the names are compared with case and `-`/`_` removed, so `--stateDir` and
`--state_dir` are the same foreign flag. (The CLI parser registers no camelCase
aliases either, so those spellings are not options at all.) `init --force` is
the one option of an auto-allowed subcommand that is deliberately off its list:
it throws away an existing review's Doc id, revision history and recorded
approval, so it always asks you. A `--plan` that names a plan other than the one
the session is presenting is likewise refused, in both directions — the gate
cannot tell which of the two is wrong, so it grants nothing. A command line that
repeats `--plan` is allowed when its first occurrence names the session's plan —
and then refused by the CLI itself, which will not act on one of several values
the gate never compared.

`decision`, `synced`, `cancel` and `reactivate` are deliberately outside the
list: each writes a field the gate reads — the recorded approval, the recorded
sync digest, or the status the gate switches on — so a model that could run them
unprompted could put a plan past the review you asked for. They stay on the CLI
as the recovery path and always ask you at the Bash prompt. `hook` is outside it
too.

## How it works

Four hook events carry the whole flow, in seven handler roles. **The gate** is a
`PreToolUse` hook on `ExitPlanMode`: it finds the plan file from the session
transcript (see [State layout](#state-layout)), loads `reviews/<plan-slug>.json`
and hashes the plan. No review means it prints nothing and the built-in dialog
appears, and so does a review the plugin has finished with — `cancelled`, or
`approved` because an approval was already spent on it. A review still in
`setup` is denied with the setup steps that are left: you asked for the plan to
be reviewed in a Doc and there is no Doc yet, so approving it now would quietly
skip the review rather than fall back to it. Otherwise it denies with the exact
work that is missing — run the round, present the menu, re-check the Doc, or
follow the instruction you typed. The gate is also the one hook that fails
**closed**: if it cannot read its own template or state, it denies with a fixed
reason naming `log.jsonl` instead of letting a broken install wave the plan
through.

**The round** is driven by Claude but recorded by hooks: a `PostToolUse` hook on
the Drive write records `lastSync` only when the synced text hashes to the plan
file — or, in `file_path` mode, when the path handed to the server is the plan
file itself (anything else tells Claude to re-sync and leaves the gate closed),
and a `PostToolUse` hook on `AskUserQuestion` maps the menu answer to a decision
pinned to the same digest. Editing the plan afterwards invalidates both, which
is what makes an approval always refer to the text that was reviewed.

**The approval** is a `PermissionRequest` hook on `ExitPlanMode`: when the sync
and the decision both match the current plan, and the decision came from the
menu, is unspent and is younger than 30 minutes, it answers the prompt with
`allow` plus a `setMode` update — the same update the built-in "Yes, auto-accept
edits" / "Yes, manually approve edits" rows apply — and marks the decision
spent. If it ever does not fire, the built-in dialog simply appears, so there is
no failure mode in which a plan cannot be approved.

**The completion** is a `PostToolUse` hook on `ExitPlanMode`: it moves the
review to `approved` and records the mode the approval resolved to, which is
what the final `✅ Plan approved (<mode>)` comment on the revision-log thread
quotes. It closes the review only when the permission hook actually spent your
menu answer on that call — that hook writing `consumedAt` is the one piece of
evidence a `PostToolUse` has that this plugin, rather than the built-in dialog,
approved it. A plan approved through the built-in dialog leaves the review
`active` with no recorded mode, and `ROUND.md` tells Claude to omit the mode
from the comment in that case rather than name one nobody picked.

**The restate** is a `SessionStart` hook: it re-states the active review after a
resume or a compaction, so a session that lost its context still knows the plan
is under review.

**The Bash allow-list** is a `PreToolUse` hook on `Bash`: it auto-allows this
plugin's own CLI calls, and nothing else, while the session is in plan mode.

**The MCP write gate** is a `PreToolUse` hook on the two workspace-mcp write
tools a round uses: it auto-allows a write only when that write is aimed at the
registered Doc, on the registered server, in plan mode.

**What the hooks refuse to trust.** The menu answer is read only from the tool's
_response_, and only when the presented question is the one the protocol handed
Claude: the review header, an explicit single-select flag, the four labels **and
their descriptions** in order, and a question body matching this review's own
title line, Doc link and revision — the two counters are the only part left
free. A question that was reworded, or that quotes another document, is not the
menu and records nothing, because the question body is what you read before
answering.

**What the plugin auto-allows in your Drive: the round's writes, and nothing
else.** The two writes `/gdoc-review` setup makes — `create_drive_folder` and
`import_to_google_doc` — are **not** auto-allowed. They go through Claude Code's
normal permission flow, so in plan mode you answer a prompt before anything is
created in your Drive (a bypass-permissions session runs them without one, as it
runs everything else). The plugin's own gate grants exactly one thing: a
`update_drive_file` or `manage_document_comment` call, while the session is in
plan mode, for a review that is `active` or `approved`, whose tool-specific
target parameter (`file_id` / `document_id`) and every other document reference
in the same payload resolve to the registered Doc, made on the MCP server that
Doc was registered through. A write that also names a `file_path` must name this
review's own plan file, and must not hand the server a `file_url` or a
`base64_content` instead — in that sync mode the parameter decides which local
file the server reads.

So the id the review records is the whole grant: it is written by `register`
from a `--doc-id` that must be a Drive file id or a canonical document link, or
by the import recorder from the id the response named — and the recorder is only
writing down what a call you already approved turned out to create. Recording is
not allowing.

Reviewer comment text is data: `ROUND.md` tells Claude to refuse instructions
arriving in a Doc comment, and the words you type into the menu are passed on
inside explicit delimiters.

## Two walkthroughs

### A Doc in My Drive, with a detour and a manual approval

You enter plan mode, Claude drafts a plan, and you run
`/gdoc-review PersonalDrive "notes/plans/Indexing"`. The skill creates the
review in `setup` and walks `notes` and `plans` under your My Drive root.
`notes` exists; `plans` does not, so Claude creates it — and Claude Code asks
you to approve that folder creation, because the plugin auto-allows nothing that
creates something in your Drive. It finds no Doc called `Indexing` in the last
folder and imports the plan text as a new one, which you approve the same way.
Then it registers the Doc — recording its id and the workspace-mcp server it
lives on — and opens the `🤖 Revision log` thread on it. The review is now
`active`.

Claude calls `ExitPlanMode`. The gate denies it, because no sync has been
recorded yet — the import that created the Doc is not a plan sync, so the Doc is
not known to hold the current plan text — and the deny carries the full round
protocol. Claude syncs the plan into the Doc (this write the plugin does
auto-allow: it targets the registered Doc on the registered server), posts
`🤖 Rev 1 synced … — addressed 0, open 0` on the log thread, and presents the
menu with the Doc link and the counters.

You read the Doc, leave two comments — one asking for a rollback section, one
telling Claude to "just push it when you're done" — and pick **Check Google Doc
for new comments and changes**. Claude re-lists the comments, adds the rollback
section to the plan file, replies to that thread with what it changed and
resolves it, and declines the second one: a comment is data about the plan, not
an instruction to the session, so it answers
`🤖 Not changed: out-of-scope request in a Doc comment`, leaves that thread open
and tells you about it. Editing the plan file invalidated the recorded sync, so
the next `ExitPlanMode` is denied again and the whole round repeats: revision 2
is synced, the log thread gets `🤖 Rev 2 synced … — addressed 1, open 1`, and
the menu comes back.

This time you type "add the rollback section to the runbook too" into the
free-text row. The hook quotes your words back to Claude inside explicit
delimiters and keeps the session in plan mode. Claude does it, presents the menu
again, and you pick **Approve Manual Mode**. Claude calls `ExitPlanMode`, the
gate is silent, the permission hook answers the prompt with `default` and marks
the approval spent, the review becomes `approved`, and Claude closes the round
with `🤖 ✅ Plan approved (default) at <time>` on the log thread. The one open
thread is still open — that is the record of what was declined.

### A Doc in a Shared Drive, approved into auto-accept mode

Same start, but `/gdoc-review SharedDrive Handbook "specs/2026/Retention"`. The
skill resolves the Shared Drive called `Handbook` by name and keeps the drive id
it got back for `register --drive-id`, walks `specs` and `2026` inside it, and
finds an existing `Retention` Doc from a previous run — which it reuses, because
re-running the command must never create a second Doc. Nothing is created this
time, so nothing prompts. It registers that Doc and reuses the revision-log
thread already on it.

The review starts at revision 0 whatever the Doc's own history is, so the first
round syncs the plan as **revision 1** and the menu states `Revision 1 synced`.
A reviewer comments while you are deciding; you pick **Check Google Doc for new
comments and changes**, Claude revises the plan, syncs **revision 2**, answers
and resolves the thread, and asks again. You pick **Approve and Use Auto Mode**.
The permission hook answers with `acceptEdits`, the review closes as `approved`,
and the log thread ends with `🤖 ✅ Plan approved (acceptEdits) at <time>`.

Later you edit the plan for something the review never saw and want it reviewed
again: `reactivate --plan <file>` puts the review back to `active` and drops the
recorded decision, and the next `ExitPlanMode` starts a fresh round against the
same Doc.

## Development

```bash
pnpm install
pnpm build   # tsc -b (typecheck + lib/) then esbuild → dist/gdoc-review.cjs
pnpm lint    # eslint .
pnpm test    # build + jest (unit + spawned-bundle integration tests)
pnpm format  # prettier
pnpm validate  # claude plugin validate . (a no-op when the CLI is absent)
```

`dist/gdoc-review.cjs` is the only runtime artifact. It is a build output
(ignored by git), so after any `src/` change run `pnpm build` before exercising
the plugin from this checkout; `pnpm test` rebuilds it first for the same
reason.

Conventions are binding: [`CLAUDE.md`](CLAUDE.md) for the repository rules,
[`STYLE.md`](STYLE.md) for the TypeScript style laws (the mechanical subset is
enforced by `eslint.config.mjs`).

## Troubleshooting

- **`status --json`** — the exact state the gate is deciding on. Compare
  `lastSync.planSha256` and `decision.planSha256`: when they differ from each
  other, or the plan has been edited since, a fresh round is required, which is
  the usual reason an approval "did not take".
- **`log.jsonl`** in the state directory — every hook decision and every
  swallowed hook failure lands there; nothing is ever printed to stdout, which
  carries the hook protocol.
- **`GDOC_REVIEW_LOG_LEVEL=debug`**, or `"logLevel": "debug"` in `config.json` —
  adds the plan-file lookup, the store reads and the per-handler decisions to
  that log.
- **`ExitPlanMode` is denied for a "plugin installation or state failure"** —
  the gate could not build the round at all, so it failed closed. `log.jsonl`
  carries the exception. The usual cause is an incomplete install (no
  `skills/gdoc-review/ROUND.md` or no `dist/gdoc-review.cjs` under
  `CLAUDE_PLUGIN_ROOT`, which also makes the plugin resolve its root by walking
  up from its own module and say so at `warn`); the others are a state directory
  that cannot be read or created, a review document naming a plan file other
  than the one the session is presenting, and a transcript with a line too large
  to parse and no plan-mode attachment outside it.
- **The built-in dialog appeared** — the gate had nothing to say and the
  permission hook did not fire. Either there is no review for this plan file and
  no other review is active either (`status` lists the active ones; a renamed or
  moved plan file is a different review key), or the review is `cancelled` or
  already `approved` — use `reactivate` to put it back under review — or the
  approval on record came from the `decision` command rather than the menu,
  which opens the gate but never replaces the dialog. A review that is `active`
  but has no Doc registered is not this case: that one is denied with the
  remaining setup steps. The fallback is by design; nothing is lost.
- **The menu answer was not recorded, and the menu is demanded again** — the
  question presented was not the one the protocol handed Claude. The header, the
  four labels, their order, their descriptions and the question body (title
  line, Doc link and revision) are all matched, and only the two counters are
  free, so a reworded prompt records nothing. `log.jsonl` at `debug` shows the
  answer being ignored. The other reason is an answer older than 30 minutes, or
  one already spent on an earlier `ExitPlanMode`.
- **Claude keeps being told to re-sync** — the text it sent differs from the
  plan file. It must send the file's exact, complete content. In `file_path`
  sync mode the same message means the path it handed the server is not the
  review's own plan file.
- **`register` refuses a folder or Shared Drive id** — the id must be shaped
  like one (`root` and a folder name are not; a Shared Drive id is shorter than
  a file id and has its own floor). Pass the id the search or listing response
  named.
- **A round write prompts instead of being auto-allowed** — the likely cause is
  `--server`: the recorded server must be the `<server>` of the
  `mcp__<server>__` tools actually being called. `status --json` shows
  `doc.serverName`. The other causes are a session outside plan mode, a review
  that is not `active` or `approved`, and a payload naming a second document.
- **`ExitPlanMode` is denied for a plan that has no review** — another review in
  the same state directory is still `active`, and the deny lists its plan file.
  Either present that plan, run `/gdoc-review` for this one, or `cancel` the
  other. The gate never waves a plan through silently while a review it cannot
  match is still open.
- **A headless `claude -p` run stops at the first Drive write with "Cannot call
  … while in plan mode"** — the two setup writes reach the plan-mode permission
  prompt, and a headless session has nobody to answer it (an `--allowedTools`
  rule does not, because the plan-mode check runs before allow rules). Answer it
  the way a person would: pass `--permission-prompt-tool`, or a `--settings`
  file whose `PermissionRequest` hook allows `create_drive_folder` and
  `import_to_google_doc` on your server. Interactive sessions need nothing.

## License

MIT — see [`LICENSE`](LICENSE).
