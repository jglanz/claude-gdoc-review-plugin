---
name: gdoc-review
description:
  "Set up a Google Doc review for the current plan: creates/finds the Doc in
  your Drive, then every ExitPlanMode becomes a sync-and-review round with a
  custom approval menu"
argument-hint: 'PersonalDrive|SharedDrive [DriveName] "folder/path/DocName"'
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/gdoc-review.cjs" *)
---

# Set up a Google Doc plan review

Turn the current plan into a Google Doc that reviewers can comment on. After
setup, every `ExitPlanMode` becomes a review round: the plan is synced into the
same Doc, reviewer comments are answered, and a custom approval menu replaces
the built-in approval dialog.

Work through the steps below in order. Report a clear error and stop if a step
cannot be completed — never invent a Doc id or a folder id.

The plugin auto-allows the `init`, `register` and `log-thread` calls below — and
`status` — while the session is in plan mode, and only with the flags each of
those subcommands documents. Any other flag falls back to the ordinary Bash
prompt, including `init --force`, which throws away an existing review.
`decision`, `synced`, `cancel` and `reactivate` are never auto-allowed: each
writes a field the approval gate reads, so they always go through the ordinary
Bash permission prompt.

**The two Drive writes of this setup will prompt, and that is expected.**
`create_drive_folder` and `import_to_google_doc` go through Claude Code's normal
permission flow: in plan mode the user answers a prompt for each one. Do not
treat that prompt as a failure and do not look for a way around it — the plugin
deliberately auto-allows nothing that creates something in the user's Drive. It
auto-allows only the round's own writes to the Doc once that Doc is registered.

The `--plan` value of an auto-allowed call must be the plan file this session is
presenting, written out as a literal absolute path. Do not substitute a shell
variable, a command substitution or a `~` for it: the gate compares the command
line as text, so an unexpanded `$PLAN` or `~/plans/x.md` is simply a different
plan to it, and the call falls back to the ordinary Bash prompt. A call naming a
different plan is refused for the same reason.

## Tool naming and calling rules

Google tools are named by suffix here. Use whichever workspace-mcp server is
connected: the real tool name is `mcp__<server>__<suffix>`, so the
`update_drive_file` tool of a server called `workspace` is
`mcp__workspace__update_drive_file`. If several such servers are connected, ask
the user which one to use.

Two rules apply to every call to that server:

1. **Every parameter key must be present.** Omitted optional parameters fail
   client-side validation with "expected nonoptional, received undefined". Pass
   JSON `null` for every parameter you do not use. `user_google_email` is the
   account the server is connected to.
2. **Always pass `source_format: "md"`** when writing a plan into a Doc. The Doc
   title carries no extension, so auto-detection can fall back to plain text.

## 1. Parse the arguments

`$ARGUMENTS` takes one of two forms:

- `PersonalDrive "<folder/path/DocName>"` — the Doc lives in My Drive.
- `SharedDrive <DriveName> "<folder/path/DocName>"` — the Doc lives in the named
  Shared Drive, for example `SharedDrive Engineering "design/plans/MyPlan"`.

The quoted path is a Drive folder path whose **last segment is the Doc title**;
every earlier segment is a folder. The path may be a bare title with no folders.
If the arguments match neither form, tell the user the expected form and stop.

## 2. Require plan mode

This command only works in plan mode: the plan file path comes from the
plan-mode system message of the session. If the session is not in plan mode, or
no plan file path is available, tell the user to enter plan mode and run
`/gdoc-review` again, then stop.

## 3. Create the review state

Run, through Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/gdoc-review.cjs" init --plan "<plan file>" --kind personal|shared [--drive-name <DriveName>] --path "<folder/path/DocName>"
```

Use `--kind personal` for `PersonalDrive` (omit `--drive-name`) and
`--kind shared` with `--drive-name <DriveName>` for `SharedDrive`. This creates
the review state with status `setup`.

## 4. Resolve the target drive

- **Personal**: the parent folder id is `root` and `drive_id` stays `null` in
  every search.
- **Shared**: resolve the drive by name with
  `list_drive_items(resource_type: "shared_drives", query: "name = '<DriveName>'", corpora: null, detailed: true, drive_id: null, file_type: null, folder_id: null, include_items_from_all_drives: true, include_organizers: false, order_by: null, page_size: 100, page_token: null, user_google_email: <connected account>)`.
  The returned drive id is also the id of the drive's root folder, so it is the
  first parent. Pass that id as `drive_id` and `corpora: "drive"` in every
  search below, and keep it for `register --drive-id` in step 7 — that value
  comes from this `list_drive_items` response and nowhere else. Stop and report
  if the drive is not found.

## 5. Walk the folder path

For each folder segment of the path, in order, search inside the current parent:

```
search_drive_files(query: "name = '<segment>' and '<parent id>' in parents", file_type: "folder", corpora: <"drive" for a Shared Drive, otherwise null>, detailed: true, drive_id: <drive id or null>, include_items_from_all_drives: true, include_trashed: false, order_by: null, page_size: 10, page_token: null, user_google_email: <connected account>)
```

Use the found folder id as the next parent. When a segment does not exist,
create it:

```
create_drive_folder(folder_name: "<segment>", parent_folder_id: "<parent id>", user_google_email: <connected account>)
```

Each creation asks the user, because it creates something in their Drive. Create
each folder directly under the parent you just resolved, and create the Doc in
the last folder of the path. The last folder id is the Doc's parent folder id,
and it is what `register --folder-id` takes.

## 6. Find or create the Doc

Search the parent folder for an existing Doc with the title from step 1:

```
search_drive_files(query: "name = '<DocName>' and '<parent id>' in parents", file_type: "document", corpora: <"drive" for a Shared Drive, otherwise null>, detailed: true, drive_id: <drive id or null>, include_items_from_all_drives: true, include_trashed: false, order_by: null, page_size: 10, page_token: null, user_google_email: <connected account>)
```

If a Doc exists, reuse it — re-running `/gdoc-review` must never create a second
Doc. Otherwise create it:

```
import_to_google_doc(file_name: "<DocName>", content: <the current plan file text, or "# <DocName>\n\n_Plan in progress…_" when the plan file does not exist yet>, source_format: "md", folder_id: "<parent id>", base64_content: null, base64_sha256: null, file_path: null, file_url: null, user_google_email: <connected account>)
```

Creating the Doc asks the user, the same way a folder creation does. The
response carries `Document ID:` and `Link:` — those are the Doc id and URL; the
plugin also records the Doc id from that response, which is bookkeeping, not
permission.

## 7. Register the Doc

Get the canonical link with
`get_drive_shareable_link(file_id: "<doc id>", user_google_email: <connected account>)`,
then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/gdoc-review.cjs" register --plan "<plan file>" --doc-id "<doc id>" --doc-url "<doc url>" --folder-id "<parent id>" --server "<mcp server name>" [--drive-id "<drive id>"] [--sync-mode content|file_path]
```

`--server` is the `<server>` of the `mcp__<server>__` tools you have been
calling, without the `mcp__` prefix and without the trailing `__` — for
`mcp__workspace__update_drive_file` it is `workspace`. The plugin records it and
auto-allows a later write to this Doc only on that same server, so passing the
wrong one makes every round write prompt instead.

`--drive-id` only for a Shared Drive, and only the id the `list_drive_items`
response of step 4 returned. `--doc-id` must be the bare Drive file id or the
canonical `https://docs.google.com/document/d/<id>` link (which is stored as its
id), and `--doc-url` must be that canonical link as the shareable-link call
returned it — the command refuses anything else, because every later write is
compared against that id. `--folder-id` and `--drive-id` are checked for shape
only (`root` and a folder name are refused); they are metadata the `status`
report prints, and nothing is authorised by them. The link the plugin records
and echoes is rebuilt from the id, so the value you pass is validated and then
discarded. Leave `--sync-mode` off unless the user asked for `file_path`
syncing, which additionally requires the server to allow reading the plan
directory. The review status becomes `active`.

Do not change the Doc's sharing. If the user asks for it, the
`set_drive_file_permissions` and `manage_drive_access` tools of the same server
do that.

## 8. Create the revision-log thread

List the existing comments with
`list_document_comments(document_id: "<doc id>", max_comments: null, user_google_email: <connected account>)`.
If no comment starts with `🤖 Revision log`, create one:

```
manage_document_comment(document_id: "<doc id>", action: "create", comment_content: "🤖 Revision log — Claude Code replies here after every sync.", comment_id: null, user_google_email: <connected account>)
```

`🤖` is the default reply prefix. If `replyPrefix` is set in
`$CLAUDE_CONFIG_DIR/gdoc-review/config.json`, open the comment with that prefix
instead: the plugin recognizes the revision-log thread by
`<reply prefix> Revision log`, and the round protocol quotes the same prefix
back to you.

Record the returned comment id:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/gdoc-review.cjs" log-thread --plan "<plan file>" --comment-id "<comment id>"
```

## 9. Report to the user

Tell the user:

- the Doc URL, and that the review is active for this plan;
- that they should share the Doc with the reviewers themselves;
- that every following `ExitPlanMode` will sync the plan into this Doc, answer
  reviewer comments, and show the four-option review menu instead of the
  built-in approval dialog.
