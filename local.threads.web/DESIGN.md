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
| Refresh interval | choices | 30 / 60 / 120 |

Tapestry has no `optional` flag on inputs. Optional means: not present in UI, or
empty text accepted by `verify()` / `load()` without throwing.

## Item information architecture

1. Author identity: avatar, display name, `@username`, profile URI
   (`Identity.createWithName` + assign fields).
2. Native media: image, GIF, video (with poster), carousel slides, then link card.
3. Caption body: escaped HTML with linked URLs, `@mentions`, and `#hashtags`.
4. Quoted post as nested `Item` attachment (depth ≤ 1).
5. Annotations: repost / reply context.
6. `contentWarning` only from explicit spoiler flags.

Desired order: author → visual → caption → annotations. Native Tapestry
attachments may render under the HTML body; that is an API limitation.

## Feed modes

- **Following:** `current_user` → following list (capped) → each user's recent
  threads → merge by time. Works with Cookie Header alone.
- **For You:** GraphQL home feed with built-in variables; requires optional
  `doc_id` when Meta's persisted query ID is needed.

## Loom done checklist

- Verify with Cookie Header only on Following; durable Threads logo retained.
- Text, image, video (+ poster), carousel, link card, quote, repost, reply.
- Empty `doc_id` does not break Following; For You errors clearly when missing.
- No cookies printed or screenshot in diagnostics.
