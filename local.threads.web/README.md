# Threads Web (Beta)

This read-only Tapestry connector renders an authenticated Threads web feed.
It uses the same browser-session cookies and Relay GraphQL request that the
Threads website uses. It does not ask for a list of accounts.

## Setup

1. [Sign up for or log in to Threads](https://www.threads.com/login/).
2. In a desktop browser, open Developer Tools, select **Network**, reload the
   Threads home feed, and select the `/api/graphql` request that returns feed
   posts.
3. From that exact request, copy the `doc_id`, the optional
   `X-FB-Friendly-Name`, and the **complete** `variables` JSON. Replace only the
   pagination cursor value in the JSON with the literal string `__CURSOR__`.
4. From the browser's Threads cookies, enter `sessionid`, `csrftoken`,
   `ds_user_id`, `mid`, and `ig_did`. `rur` is optional.
5. Save the connector, then preview it in Tapestry Loom before normal use.

The feed query ID is a private, rotating implementation detail. When Threads
changes it, capture a fresh working request and update the two query fields.
The `BarcelonaFeedsTabGroupViewerQuery` request only fetches feed-tab metadata;
it does not contain posts and cannot be used as the home-feed query.

## Security

The `sessionid` cookie grants account access. Use this connector only for
personal testing, never send cookies to another person, and revoke an exposed
session by signing out of it in Threads/Instagram account security. Tapestry
connector variables may not have the same protection as a password manager or
the system Keychain.

This connector is unofficial, read-only, and may stop working when Meta changes
the web API or blocks custom `Cookie` headers from the host app.
