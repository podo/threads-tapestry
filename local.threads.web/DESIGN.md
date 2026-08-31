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

Card chrome order (Loom `post` style), matching X:

1. Native annotations **only** for `Reposted by @handle` / `Reply to @handle` (above Service).
2. Service → Author.
3. Body meta first: external link host, then metrics in
   `<p class="threads-meta-metrics"><small>…</small></p>` when **Show Metrics** is on.
4. Caption as normal `<p>` with linked URLs, `@mentions`, `#hashtags`; article URLs in
   their own `<p><a>` blocks.
5. Attachments under body: media → poll → titled link card → quoted item.
6. Actions: like / save / repost toggles also update the body metrics line;
   open in Threads; thread context.
7. Author identity assigned last; avatars embedded as data URLs when CDN fetch works.
8. `contentWarning` only from explicit spoiler flags.

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
