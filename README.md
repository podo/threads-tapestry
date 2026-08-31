# Threads connector for Tapestry

Single cookie-authenticated Threads connector. Default feed is **Following**
(stable REST). **For You** is optional GraphQL and only needs a `doc_id` when
that mode is selected.

## Setup

1. Sign in at [threads.com](https://www.threads.com/login/).
2. DevTools → Application → Cookies → copy **sessionid** and **csrftoken**.
3. In Loom, paste those fields, leave Feed on `following`, Verify, Load.

For You: paste a home-feed GraphQL `doc_id` from DevTools Network into the
optional field.

## Development

Open the directory containing `local.threads.web` as the Connectors Folder in
Tapestry Loom.

```sh
npm test
npm run build
npm run test:e2e
```

Build output: `dist/Threads.tapestry`.

## Versioning

Releases use semantic versioning from `VERSION`. Bump the integer `version` in
`plugin-config.json` whenever installed copies must notice an update.
