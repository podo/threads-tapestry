# Threads Home (Beta)

This connector creates a single authenticated Threads home feed in Tapestry,
without entering accounts one by one. It maps the native feed into Tapestry
posts with the author profile picture, full name, handle, text, images, video,
GIFs, carousels, quoted posts, repost/reply context, and rendered URL preview
cards when Threads supplies link-preview metadata.

This is a read-only beta connector. It uses the private mobile timeline endpoint
used by current Threads clients, not Meta's documented Threads Graph API. Meta
can change or block this endpoint at any time, and repeated requests can trigger
login checkpoints or temporary rate limits. Use a separate Threads account if
you are not comfortable with that risk. The official **Threads Feed** connector
in this package remains the supported account-by-account fallback.

## Setup

1. [Sign up or log in to Threads](https://www.threads.com/) and enable any
   two-factor or checkpoint flow on the account.
2. Run a local Bloks-capable login helper (for example the login flow in
   [threads-go](https://github.com/teslashibe/threads-go)). It returns an
   `IGT:2:...` mobile bearer token and the stable `android-...` device ID. A
   turnkey helper is intentionally not bundled with this installable package.
3. Paste those two values into the connector. The token is needed because web
   cookies do not authenticate the native mobile timeline endpoint.
4. Choose **For You** first. **Following** is experimental until the exact
   request parameter is confirmed against a live account.

The token is entered as a connector variable because Tapestry cannot perform
the private Bloks login flow itself. Do not paste a password, session cookie,
or token into a public issue or commit it to source control. A future release
can move token entry behind a JWT adapter once a private auth helper is hosted.

## Privacy and reliability

Feed requests go directly from Tapestry to `i.instagram.com`. The connector
does not log credentials or send feed content to a server. Threads mobile
tokens can expire after hours or days; re-run the helper and paste a new token
when the connector asks you to reauthorize.

## Development

Open the directory containing `local.threads.home` as the Connectors Folder in
Tapestry Loom. The package is built with:

```sh
npm test
npm run build
```

The installable connector is written to `dist/ThreadsHome.tapestry`.
