# Threads Web — Item Design

Single cookie-authenticated Threads connector for Tapestry. Default feed is
**Following** via stable REST on `www.threads.com` (no GraphQL `doc_id`).
**For You** is optional and uses Relay GraphQL when a `doc_id` is supplied.

## Settings

| Field | Required | Notes |
|-------|----------|--------|
| sessionid | yes | Application → Cookies |
| csrftoken | yes | Application → Cookies |
| ds_user_id | optional | Derived from sessionid if blank |
| mid / ig_did | optional | Empty accepted |
| Feed | choices | `following` (default) or `for_you` |
| Home-feed doc_id | optional | Only for For You; empty is fine on Following |
| Include reposts / quotes / replies | switches | Defaults: on / on / off |
| Show Metrics | switch | Default on |
| Following Account Cap | choices | 8 / 12 / 20 / 40 (default 12) |
| Authorization Bearer | optional | Writes only; leave blank unless cookie likes fail |
| Refresh interval | choices | 30 / 60 / 120 |

Tapestry has no `optional` flag on inputs. Optional means: not present in UI, or
empty text accepted by `verify()` / `load()` without throwing.

## Item information architecture

Card chrome order (Loom `post` style):

1. Native annotations: `Reposted by @handle` / `Reply to @handle` only (above Service).
2. Service · Feed Type via verify `displayName` (`Threads · Following` / `Threads · For You`).
3. Author: display name + `@handle` on `item.author` (assigned last).
4. Body meta (host + metrics) → caption → URL paragraphs → attachments
   (media → poll → link → quote) → actions.

Native Tapestry attachments may render under the HTML body; that is an API limitation.

## Feed modes

- **Following:** `current_user` → following list (configurable cap, 4-way parallel,
  8 posts each) → merge by time. Works with session cookies alone.
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
