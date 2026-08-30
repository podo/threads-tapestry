# Threads Feed

Creates one chronological Tapestry feed from a manually selected list of public
Threads accounts.

Enter up to 20 exact usernames separated by commas. Usernames can be written as
`@name`, `name`, or complete Threads profile URLs. The connector removes
duplicates automatically.

This connector uses Meta's official Threads Profile Discovery API. Arbitrary
public accounts require Advanced Access for `threads_profile_discovery`.
Profiles must be public and have at least 100 followers. Standard Access is
limited to selected official Meta accounts.

[Sign up or log in at Meta for Developers](https://developers.facebook.com/)
to create the Threads API app needed by this connector.

The initial OAuth implementation is intended for API verification. Meta's
short-lived access token expires after one hour. For normal use, deploy the
included OAuth bridge and replace `oauth_token` in `plugin-config.json` with
its `/token` URL before rebuilding the connector.
