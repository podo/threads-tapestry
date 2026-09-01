# Threads Web — Item Design

Single cookie-authenticated Threads connector for Tapestry. Default feed is
**Following** via stable REST on `www.threads.com`. **For You** and optional
**Following GraphQL** use Relay when a mode-specific `doc_id` is supplied.

## Settings

| Field | Required | Notes |
|-------|----------|--------|
| sessionid | yes | Application → Cookies |
| csrftoken | yes | Application → Cookies |
| ds_user_id | optional | Can be left blank (derived from sessionid when empty) |
| mid / ig_did | optional | Can be left blank |
| Feed | choices | `following` (default) or `for_you` |
| Following doc_id | optional | Capture from Following tab Network → graphql |
| For You doc_id | optional | Capture from For You tab Network → graphql |
| Legacy doc_id fallback | optional | Used when mode-specific doc_id is blank |
| Include reposts / quotes / replies | switches | Defaults: on / on / off |
| Reposts from followed only | switch | Default off; hides reposts whose original author you do not follow |
| Show Metrics | switch | Default on |
| Following Account Cap | choices | 8 / 12 / 20 / 40 (default 12) |
| Posts Per Account | choices | 4 / 8 / 12 (profile-merge fallback only; default 8) |
| Authorization Bearer | optional | Can be left blank; only for writes if cookie likes fail |
| Refresh interval | choices | 30 / 60 / 120 |

Tapestry has no `optional` flag on inputs. Optional means: not present in UI, or
empty text accepted by `verify()` / `load()` without throwing.

## Item information architecture

Card chrome order (Loom `post` style):

1. Native annotations: `Originally by @handle` / `Reply to @handle` only (above Service). Reposts use the reposter as `item.author`. Annotation icons are embedded when possible.
2. Service · Feed Type via verify `displayName` (`Threads · Following` / `Threads · For You`).
3. Author: display name + `@handle` on `item.author` (assigned last).
4. Body meta (host + metrics) → caption → URL paragraphs → attachments
   (media → poll → link → quote) → actions.

Native Tapestry attachments may render under the HTML body; that is an API limitation.

## Feed modes

- **Following:** POST then GET `/api/v1/feed/text_post_app_timeline/` when cookies
  allow; optional **Following doc_id** GraphQL; otherwise profile-merge (rotated cap,
  paced fetches, configurable posts per account). First load backfills up to 3 pages.
- **For You:** GraphQL home feed with built-in variables; requires **For You doc_id**
  (or legacy fallback) when Meta's persisted query ID is needed.
- Partial loads raise a Loom **warning** when many account fetches fail or very few
  posts return.
- High-water sync is **per mode** (`modes.following` / `modes.for_you`: URI ids +
  `lastSeenAt`) so incremental refresh does not cross-contaminate.

## Packaging

`actions.json`, `discovery.json`, `suggestions.json`, `apps.json`, `TESTING.md`
ship in the `.tapestry` archive. Reload proof: `connectorBuildId` + plugin
`version` + body HTML comment / `actions._connectorBuild`.

## Loom done checklist

See `TESTING.md`. Never print or screenshot cookies / Bearer tokens.
