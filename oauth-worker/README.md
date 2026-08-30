# OAuth bridge

This stateless Cloudflare Worker adapts Meta's Threads token lifecycle to the
standard OAuth response expected by Tapestry. It exchanges the one-hour token
for a 60-day token and maps Meta token refreshes onto the normal
`refresh_token` grant.

It stores no tokens or feed data.

## Deploy

1. Create a Meta app with the Threads use case.
2. Add `https://iconfactory.com/tapestry-oauth` to the app's valid OAuth redirect
   URIs.
3. Deploy this directory with Wrangler.
4. Store `META_APP_ID` and `META_APP_SECRET` as Worker secrets.
5. Replace the connector's `oauth_token` value with
   `https://YOUR-WORKER-DOMAIN/token`.
6. Rebuild the `.tapestry` package.

During feed setup, enter the same Meta Threads App ID and App Secret. Tapestry
stores them in its keychain; the Worker validates them before exchanging or
refreshing a token.
