## Learned User Preferences

- Focus this repo on the single Threads Web connector; do not revive Feed, Home, or oauth-worker unless explicitly requested.
- Keep Loom setup minimal: only require what is needed for the default path to work.
- Settings labeled optional must actually accept empty values in `plugin.js` (Tapestry has no ui-config optional flag).
- Prefer separate cookie fields (`sessionid`, `csrftoken`, etc.) over a single Cookie Header paste for Application → Cookies setup.
- Do not require `doc_id` when Following works without it; For You may still need it.

## Learned Workspace Facts

- The shipped connector is `local.threads.web` (display name Threads); Feed, Home, and oauth-worker were removed.
- Following (default) uses cookie REST on `www.threads.com` with no GraphQL `doc_id`; For You uses Relay GraphQL and needs a home-feed `doc_id`.
- Threads cookie REST rejects desktop browser User-Agents (`useragent mismatch`); reads use a Barcelona Android UA.
- Required auth inputs are `sessionid` and `csrftoken`; `ds_user_id` is optional/derivable; `mid` and `ig_did` are optional.
