# Threads Web Connector — Improvement Plan

> **For agentic workers:** Implement phase-by-phase after user approval. Prefer TDD against `tests/web.test.js`. Keep Web-only (no Feed/Home/oauth-worker revival). Never log cookies.

**Goal:** Close the Loom UX gap between `local.threads.web` and sibling X/Instagram connectors while staying cookie-read-first and Following-safe.

**Status (2026-08-31):** Phases 0–2 + 3.1–3.3 + 4 packaging shipped through **v0.6.0**. Remaining: live Loom cookie-write spike (use optional Bearer only if cookies fail); Phase 3.4 Following timeline endpoint still deferred.

**Architecture:** Keep Following (REST merge) as the default path. Layer presentation, packaging, diagnostics, then optional engagement actions (writes need endpoints that work with web cookies — spike first).

**Tech stack:** Plain Tapestry plugin JS, existing mocked VM tests, Loom review gate.

---

## Baseline (today)

| Area | Threads | Best sibling |
|------|---------|--------------|
| Auth | Separate cookie fields + Barcelona UA | IG / X similar |
| Feeds | Following REST · For You GraphQL + optional doc_id | X dual home modes |
| Media | Image/video/GIF/carousel/link/quote/poll | Parity-ish with X/IG |
| Actions | **None** | X / IG / Readwise / Are.na |
| Packaging | No discovery/suggestions/apps | X / IG |
| Diagnostics | No build-id stamps | X |
| Linkify | Single `<p>`, regex URL/@/# | X multi-`<p>` + URL-API fallback |
| Avatars | Remote URL only | X data-URL embed |
| HWM | Date + signature | X per-mode ID high-water |

Official Iconfactory (Mastodon/Bluesky): HTML bodies with real `<a>`, native attachments under body, action state machines, Feed Finder via discovery.

---

## Phase 0 — Hygiene (small, ship first)

- Update `DESIGN.md` (still mentions Cookie Header; document Following cap/concurrency).
- Align docs with separate cookie fields and v0.4.x behavior.
- Bump `connectorBuildId` convention once Phase 1 diagnostics land.

---

## Phase 1 — Loom presentation (highest read-only impact)

**1.1 Body links (X skill)**  
- Caption and URLs in separate `<p>` blocks where helpful.  
- Linkify without gating on `new URL()`; final HTML pass that skips open tags.  
- Keep article URLs in body even when a `LinkAttachment` exists.

**1.2 Link cards**  
- Always set `LinkAttachment.title` (title → siteName → host → URL).  
- Emit titled card alongside media when both exist; borrow poster/image if card image missing.

**1.3 Avatars**  
- After remote assign, optionally fetch CDN avatar → data URL when Loom drops remote (cdninstagram / fbcdn), same pattern as X twimg. Cap size/concurrency.

**1.4 Assign author last**  
- Build body → attachments → annotations, then `item.author` (X identity quirk).

**Done when:** Loom shows blue body links, titled cards, and stable avatars on a live Following load (screenshot review, cookies redacted).

---

## Phase 2 — Packaging & reload proof

**2.1** Add `discovery.json`, `suggestions.json`, `apps.json` (threads.com profile/post patterns; open in Threads).  
**2.2** `connectorBuildId` + verify/load log + `_connectorBuild` / body HTML comment.  
**2.3** `TESTING.md` Loom checklist (mirror X, Threads-specific).  
**2.4** Include new JSON files in `scripts/build.sh` zip.

**Done when:** Loom version/build stamp visible on dumped items; Feed Finder can resolve a threads.com URL.

---

## Phase 3 — Feed quality

**3.1** Per-mode high-water keys (`following` vs `for_you`) using post id/URI, not only `lastSeenAt`.  
**3.2** Optional metric annotations (likes/replies/reposts) behind a switch (default on or off — decide in UI).  
**3.3** Following merge: configurable account cap / batch size in advanced settings (still optional empties).  
**3.4** Spike: true Following timeline endpoint if Meta exposes one for cookies; keep profile-merge fallback.

**Done when:** Incremental refresh does not cross-contaminate modes; metrics visible when enabled; load stays under Loom ~60s.

---

## Phase 4 — Actions (spike → ship)

**Spike first (cookie-only):** like / unlike / repost / unrepost / bookmark-or-save against `www.threads.com` REST (threads-go write APIs are Bearer). If cookie mutations fail, either:

- **A.** Document read-only + `openLink` / thread context only, or  
- **B.** Optional Bearer (`IGT:2`) advanced fields for writes (user explicitly opts in).

**If cookie writes work:** `actions.json` + `performAction` state machines; icons `heart` / `tapestry.boost` / `tapestry.bookmark`; context action for replies thread.

**Done when:** Toggles work in Loom and returned `item.actions` flip; failures are clear; no secrets in logs.

---

## Phase 5 — Release gate

- Tests for linkify, card titles, HWM, actions (mocked).  
- Rebuild `Threads.tapestry`; bump `VERSION` + plugin `version`.  
- Loom review checklist from skill: visual order, blue links, cards, avatars, modes, actions.  
- Push/publish as before.

---

## Out of scope (unless requested)

- Restoring Feed / Home / oauth-worker packages.  
- Official Meta Graph API OAuth feed.  
- Claiming media-first visual order beyond native-attachment-under-body limitation.

---

## Recommended sequence

Ship **Phase 0 → 1 → 2** as one or two releases (read-only Loom polish). Then **Phase 3**. Gate **Phase 4** on a short cookie-write spike.

## UI schema (after Phase 1–3)

```
BEFORE (v0.4.x):
┌ sessionid / csrftoken / optional ids ┐
│ Feed following|for_you               │
│ optional doc_id                      │
│ include switches · refresh           │
└──────────────────────────────────────┘

AFTER (target):
┌ same auth fields                     ┐
│ Feed · optional doc_id               │
│ Show Metrics (switch)                │
│ Advanced: following account cap      │
│ (+ actions appear on items, not UI)  │
│ packaging: discovery/suggestions/apps│
└──────────────────────────────────────┘
```
