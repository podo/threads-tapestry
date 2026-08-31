# Threads for Tapestry

Cookie-authenticated Threads home connector. Default feed is **Following**
(stable REST on `www.threads.com`). **For You** is optional GraphQL and needs a
`doc_id` only when you select that mode.

## Setup

1. Sign in at [threads.com](https://www.threads.com/login/).
2. DevTools → **Application** → **Cookies** → `https://www.threads.com`.
3. Paste **sessionid** and **csrftoken** (required). **ds_user_id** is optional
   (derived from sessionid when blank). **mid** / **ig_did** are optional.
4. Leave **Feed** on `following` for cookie-only use. For **For You**, capture the
   home-feed `/api/graphql` `doc_id` from the Network tab and paste it into the
   optional field.
5. Optional: **Show Metrics**, **Following Account Cap**, and **Authorization
   Bearer** (writes only — leave blank unless cookie like/save fails).
6. Save, Verify, then Load in Tapestry Loom.

Treat cookie values as account credentials. Do not share them or commit them.

## Item support

Text (blue linked URLs, mentions, hashtags), images, GIFs, video with posters,
carousels, titled link preview cards, quotes, reposts, replies, metric
annotations, and embedded author avatars. Actions: like, save, repost, open in
Threads, thread context.

## Packaging

```sh
npm test
npm run build
```

Installable archive: `dist/Threads.tapestry`. Loom checklist: `TESTING.md`.
