# Threads Web — Item Design

Single cookie-authenticated Threads connector for Tapestry. Default feed is
**Following** via stable REST on `www.threads.com` (no GraphQL `doc_id`).
**For You** is optional and uses Relay GraphQL when a `doc_id` is supplied.

## Settings

| Field | Required | Notes |
|-------|----------|--------|
| sessionid | yes | Application → Cookies |
| csrftoken | yes | Application → Cookies |
| ds_user_id | optional | Can be left blank (derived from sessionid when empty) |
| mid / ig_did | optional | Can be left blank |
| Feed | choices | `following` (default) or `for_you` |
| Home-feed doc_id | optional | Can be left blank; needed only for For You |
| Include reposts / quotes / replies | switches | Defaults: on / on / off |
| Show Metrics | switch | Default on |
| Following Account Cap | choices | 8 / 12 / 20 / 40 (default 12) |
| Authorization Bearer | optional | Can be left blank; only for writes if cookie likes fail |
| Refresh interval | choices | 30 / 60 / 120 |

Tapestry has no `optional` flag on inputs. Optional means: not present in UI, or
empty text accepted by `verify()` / `load()` without throwing.

## Item information architecture

Card chrome order (Loom `post` style):

1. Native annotations: `Originally by @handle` / `Reply to @handle` only (above Service). Reposts use the reposter as `item.author`.
2. Service · Feed Type via verify `displayName` (`Threads · Following` / `Threads · For You`).
3. Author: display name + `@handle` on `item.author` (assigned last).
4. Body meta (host + metrics) → caption → URL paragraphs → attachments
   (media → poll → link → quote) → actions.

Native Tapestry attachments may render under the HTML body; that is an API limitation.

## Feed modes

- **Following:** Prefer native timeline (`/api/v1/feed/text_post_app_timeline/`) when
  cookies allow; optional GraphQL `doc_id` from the **Following** tab Network tab;
  otherwise profile-merge (configurable cap, rotated across refreshes, 8 posts each).
- **For You:** GraphQL home feed with built-in variables; requires optional
  `doc_id` when Meta's persisted query ID is needed.
- High-water sync is **per mode** (`modes.following` / `modes.for_you`: URI ids +
  `lastSeenAt`) so incremental refresh does not cross-contaminate.

## Packaging

`actions.json`, `discovery.json`, `suggestions.json`, `apps.json`, `TESTING.md`
ship in the `.tapestry` archive. Reload proof: `connectorBuildId` + plugin
`version` + body HTML comment / `actions._connectorBuild`.

## Loom done checklist

See `TESTING.md`. Never print or screenshot cookies / Bearer tokens.
