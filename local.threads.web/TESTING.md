# Testing Threads for Tapestry

## Automated suite

```sh
env -u DYLD_INSERT_LIBRARIES /opt/homebrew/opt/node@22/bin/node tests/web.test.js
bash scripts/build.sh
env -u DYLD_INSERT_LIBRARIES /opt/homebrew/opt/node@22/bin/node tests/web-package-e2e.test.js
```

Covers: cookie fields, Following vs For You, linkify + titled cards, media variants,
actions state machines, per-mode high-water, metrics switch, following cap, avatar
data-URL embed path (mocked), packaging manifests.

## Package checks

```sh
unzip -t dist/Threads.tapestry
unzip -l dist/Threads.tapestry
```

Expect `plugin-config.json` `version` **8** for this release and
`actions` / `discovery` / `suggestions` / `apps` / `TESTING.md` in the archive.

## Loom review checklist

Install [v0.6.0 `Threads.tapestry`](https://github.com/podo/threads-tapestry/releases)
(or point Loom at `local.threads.web`). Never screenshot or paste cookie values.

### Reload proof

1. Console on Verify/Load: `threads-web … @plugin8@0.6.0`
2. Any item: `actions._connectorBuild` and body HTML comment match that stamp
3. `actions._authorAvatarAssigned` is `data:N` when embed worked, or `url:host` fallback

### Presentation (links → post → actions)

1. Blue `<a href>` body links; mentions/hashtags tappable
2. Titled link cards; media+URL posts keep both
3. Author last; caption `service-caption`; video posters; carousels
4. Metrics annotations when **Show Metrics** is on (off hides them)
5. Like / save / repost toggle filled icons on success
6. Thread context returns parent + replies when the replies endpoint works
7. Open in Threads opens the post URI

### Feeds

1. Following loads under ~60s at default cap 12 (try 8 if timeouts)
2. For You needs `doc_id`; empty doc_id must not break Following
3. Switching Following ↔ For You must not share high-water (no cross-mode skip)

### Cookie write spike (Phase 4)

1. Like a post with cookies only (no Bearer)
2. If success: leave Bearer blank
3. If clear “read-only for writes” / 404 ladder: paste optional `Authorization Bearer`
   (`IGT:2…` from a trusted capture) and retry like once
4. If still failing: treat actions as best-effort; use Open in Threads

Do not commit Bearer or cookies. Redact Network logs.

## Deferred

- True Following timeline endpoint (keep profile-merge until Meta exposes a stable cookie path)
- Avatar embed for annotation icons (author only today)
