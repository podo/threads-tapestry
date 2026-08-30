# Threads connectors for Tapestry

This project contains three Tapestry connectors: an official API connector that
combines manually selected public accounts, a beta connector for the private
mobile endpoint, and a cookie-authenticated beta connector for the Threads web
home feed.

## Current status

Version `0.3.1` improves Threads Web query validation, removes the misleading
generic variables default, and supplies a durable connector logo. Version
`0.3.0` added the Threads Web beta connector and packaged end-to-end
render tests. It supports profile pictures, full names, handles, text, images,
video, carousels, quote posts, repost/reply context, and URL preview cards.

Meta's Standard Access can be used to test selected official Meta accounts.
Arbitrary profiles must be public, have at least 100 followers, and be
accessible to an app approved for Advanced Access.

## Official Threads Feed features

- One comma-separated account list; accepts usernames and full profile URLs
- Up to 20 accounts, normalized and deduplicated
- Strict chronological merge across accounts
- 10, 25, or 50 recent posts per account
- Optional repost and quote-post filtering
- Images, video thumbnails, GIFs, carousels, links, topic tags, and alt text
- Author display names and avatars cached during feed verification
- Per-account failure isolation
- Persistent 30, 60, or 120-minute request throttling
- Stateless 60-day token exchange and refresh bridge

## Threads Home (Beta)

`local.threads.home` creates one authenticated feed without entering account
names individually. It maps profile pictures, full names, handles, text,
images, video, GIFs, carousels, quotes, repost/reply context, and URL preview
cards into native Tapestry attachments.

The beta uses the private mobile endpoint served by `i.instagram.com`. It is
read-only and may break when Meta changes the endpoint or challenges the
account. The **For You** request is the verified path; **Following** is exposed
as experimental until its exact request parameter is validated against a live
account. Web cookies alone do not authenticate this endpoint; the connector
requires the mobile `IGT:2:...` bearer token and its stable device ID.

The beta intentionally remains a separate connector so the official API feed
continues to work when private endpoints are unavailable.

## Threads Web (Beta)

`local.threads.web` recreates the signed-in web feed without entering accounts
one by one. It replays a captured, read-only Threads Relay GraphQL request using
the browser's `sessionid`, `csrftoken`, `ds_user_id`, `mid`, and `ig_did`
cookies. [Sign up for or log in to Threads](https://www.threads.com/login/), then
follow the connector's README to capture the home-feed `doc_id`, friendly name,
and variables JSON from browser Developer Tools.

The GraphQL persisted-query ID is private and rotates, so it is intentionally a
setting rather than hard-coded. Browser cookies are account credentials: do not
share them, and revoke any session whose cookie values were exposed. The web
connector still needs live validation in Tapestry Loom because the host app may
restrict an explicitly supplied `Cookie` header.

## Meta app setup

1. [Sign up or log in at Meta for Developers](https://developers.facebook.com/),
   then create a Meta app and add the Threads use case.
2. Request `threads_basic` and `threads_profile_discovery`.
3. Add `https://iconfactory.com/tapestry-oauth` as a valid OAuth redirect URI.
4. During development, test with the official Meta accounts allowed by Standard
   Access.
5. Complete Meta App Review for Advanced Access before using arbitrary public
   profiles.

## OAuth

The connector initially points directly at Meta's token endpoint so its basic
OAuth request can be tested. Meta returns a short-lived one-hour token and then
requires a non-standard exchange and refresh flow.

For a durable feed, deploy `oauth-worker`, set its `META_APP_ID` and
`META_APP_SECRET` secrets, replace `oauth_token` in
`local.threads.feed/plugin-config.json` with the Worker's `/token` URL, increment
the connector version, and rebuild.

The Worker stores no tokens and no feed content.

## Development

Open the directory containing `local.threads.feed` as the Connectors Folder in
Tapestry Loom.

Run the mocked test suite, build all installable connectors, and execute the
packaged connector through the full rendering fixture:

```sh
npm test
npm run build
npm run test:e2e
```

The build writes `dist/ThreadsFeed.tapestry`, `dist/ThreadsHome.tapestry`, and
`dist/ThreadsWeb.tapestry`.

GitHub Actions runs the tests and package build on every push and pull request.
Changing `VERSION` on `main` creates a matching `vX.Y.Z` GitHub release with
the installable connector attached.

## Versioning

Releases use semantic versioning from `VERSION`. Connector configuration also
has an integer `version` field, which must increase whenever an installed
connector needs to recognize an update.
