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

1. Caption body: escaped HTML with linked URLs, `@mentions`, and `#hashtags`
   (caption and trailing URL in separate `<p>` blocks when possible).
2. Native media: image, GIF, video (with poster), carousel slides, then titled
   link card (media + card when both exist).
3. Quoted post as nested `Item` attachment (depth ≤ 1).
4. Annotations: repost / reply context, plus like/reply/repost counts when present.
5. Actions: like, save, repost (toggle state machines), open in Threads, thread
   context. Cookie writes use Instagram-style `/web/…` then `/media/…` ladders on
   `www.threads.com`; failures surface a clear read-only message.
6. Author identity last: avatar, display name, `@username`, profile URI
   (`Identity.createWithName` + assign fields) — Loom identity quirks.
7. `contentWarning` only from explicit spoiler flags.

Desired order: author → visual → caption → annotations → actions. Native Tapestry
attachments may render under the HTML body; that is an API limitation.

## Feed modes

- **Following:** `current_user` → following list (capped at 12 accounts, 4-way
  parallel, 8 posts each) → merge by time. Works with session cookies alone.
- **For You:** GraphQL home feed with built-in variables; requires optional
  `doc_id` when Meta's persisted query ID is needed.

## Packaging

`actions.json`, `discovery.json`, `suggestions.json`, `apps.json` ship in the
`.tapestry` archive. Reload proof: `connectorBuildId` + plugin `version` + body
HTML comment / `actions._connectorBuild`.

## Loom done checklist

- Verify with sessionid + csrftoken on Following; durable Threads logo retained.
- Blue body `<a href>` links; titled link cards; media+URL keep both.
- Text, image, video (+ poster), carousel, link card, quote, repost, reply.
- Like / save / repost toggle icons when cookie writes succeed; clear error if not.
- Empty `doc_id` does not break Following; For You errors clearly when missing.
- No cookies printed or screenshot in diagnostics.
