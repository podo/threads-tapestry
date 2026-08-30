const STATE_KEY = "threadsWebStateV1";
const MAX_BACKFILL_PAGES = 3;
const MAX_STORED_IDS = 100;
const GRAPHQL_PATH = "/api/graphql/";
const THREADS_APP_ID = "238260118697367";

function stringValue(value) {
  return value == null ? "" : String(value);
}

function firstValue(object, names) {
  if (!object) return null;
  for (const name of names) {
    if (object[name] != null && object[name] !== "") return object[name];
  }
  return null;
}

function escapeHtml(value) {
  return stringValue(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(value) {
  const url = stringValue(value).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  return "";
}

function textBody(value) {
  let html = escapeHtml(value).replace(/\r?\n/g, "<br>");
  if (!html) return "";
  html = html.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+)/gi, (whole, prefix, raw) => {
    let label = raw;
    let trailing = "";
    while (/[),.!?;:]$/.test(label)) {
      trailing = label.slice(-1) + trailing;
      label = label.slice(0, -1);
    }
    const href = safeUrl(label.replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
    return href ? `${prefix}<a href="${escapeHtml(href)}">${label}</a>${trailing}` : whole;
  });
  return `<p>${html}</p>`;
}

function parseJsonChunks(body) {
  const text = stringValue(body).trim();
  if (!text) return {};
  try {
    return JSON.parse(text.replace(/^for \(;;\);\s*/, ""));
  } catch (_) {
    const chunks = [];
    for (const line of text.split(/\r?\n/)) {
      const cleaned = line.replace(/^data:\s*/, "").replace(/^for \(;;\);\s*/, "").trim();
      if (!cleaned || cleaned === "[DONE]") continue;
      try { chunks.push(JSON.parse(cleaned)); } catch (_) { /* Relay may mix boundary lines with JSON. */ }
    }
    if (chunks.length) return { chunks };
    throw new Error("Threads returned an unreadable GraphQL response.");
  }
}

function parseFullResponse(text) {
  let envelope;
  try { envelope = JSON.parse(text); } catch (_) { throw new Error("Threads returned an unreadable response."); }
  if (envelope && typeof envelope.status === "number" && Object.prototype.hasOwnProperty.call(envelope, "body")) {
    let body = {};
    try { body = parseJsonChunks(envelope.body); } catch (_) { body = {}; }
    if (envelope.status === 401 || envelope.status === 403) {
      const error = new Error("Threads web session expired or was rejected.");
      error.authorization = true;
      throw error;
    }
    if (envelope.status < 200 || envelope.status >= 300) {
      const message = firstValue(body.error || {}, ["message", "error_user_msg"]) ||
        firstValue(body, ["message", "error_message"]) || `HTTP ${envelope.status}`;
      throw new Error(`Threads web feed: ${message}`);
    }
    if (body && Array.isArray(body.errors) && body.errors.length) {
      const message = firstValue(body.errors[0], ["message", "description"]) || "GraphQL query failed.";
      const error = new Error(`Threads web feed: ${message}`);
      if (/login|session|auth/i.test(message)) error.authorization = true;
      throw error;
    }
    return body;
  }
  return envelope || {};
}

function requiredSetting(name, value) {
  const result = stringValue(value).trim();
  if (!result) throw new Error(`Enter the Threads ${name} in connector settings.`);
  return result;
}

function credentials() {
  return {
    sessionid: requiredSetting("sessionid cookie", typeof sessionid === "undefined" ? "" : sessionid),
    csrftoken: requiredSetting("csrftoken cookie", typeof csrftoken === "undefined" ? "" : csrftoken),
    ds_user_id: requiredSetting("ds_user_id cookie", typeof ds_user_id === "undefined" ? "" : ds_user_id),
    mid: requiredSetting("mid cookie", typeof mid === "undefined" ? "" : mid),
    ig_did: requiredSetting("ig_did cookie", typeof ig_did === "undefined" ? "" : ig_did),
    rur: stringValue(typeof rur === "undefined" ? "" : rur).trim(),
    docId: requiredSetting("home-feed GraphQL doc_id", typeof query_doc_id === "undefined" ? "" : query_doc_id)
  };
}

function cookieHeader(auth) {
  const values = [
    `sessionid=${auth.sessionid}`,
    `csrftoken=${auth.csrftoken}`,
    `ds_user_id=${auth.ds_user_id}`,
    `mid=${auth.mid}`,
    `ig_did=${auth.ig_did}`
  ];
  if (auth.rur) values.push(`rur=${auth.rur}`);
  return values.join("; ");
}

function requestHeaders(auth) {
  const headers = {
    "Accept": "*/*",
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": cookieHeader(auth),
    "Origin": site,
    "Referer": `${site}/`,
    "User-Agent": "Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    "X-CSRFToken": auth.csrftoken,
    "X-IG-App-ID": THREADS_APP_ID
  };
  const friendlyName = stringValue(typeof query_name === "undefined" ? "" : query_name).trim();
  if (friendlyName) headers["X-FB-Friendly-Name"] = friendlyName;
  return headers;
}

function replaceVariables(value, cursor) {
  if (Array.isArray(value)) return value.map(item => replaceVariables(item, cursor));
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value)) output[key] = replaceVariables(value[key], cursor);
    return output;
  }
  if (value === "__CURSOR__") return cursor || null;
  return value;
}

function variablesFor(cursor) {
  const raw = stringValue(typeof query_variables === "undefined" ? "" : query_variables).trim();
  let parsed;
  try { parsed = JSON.parse(raw || "{}"); } catch (_) { throw new Error("Captured variables must be valid JSON."); }
  return replaceVariables(parsed, cursor);
}

function requestPage(cursor) {
  const auth = credentials();
  const params = [
    "fb_api_caller_class=RelayModern",
    `variables=${encodeURIComponent(JSON.stringify(variablesFor(cursor)))}`,
    `doc_id=${encodeURIComponent(auth.docId)}`,
    "server_timestamps=true"
  ].join("&");
  return sendRequest(`${site}${GRAPHQL_PATH}`, "POST", params, requestHeaders(auth), true).then(parseFullResponse);
}

function readState() {
  if (typeof getItem !== "function") return {};
  try { return JSON.parse(getItem(STATE_KEY) || "{}") || {}; } catch (_) { return {}; }
}

function writeState(value) {
  if (typeof setItem === "function") setItem(STATE_KEY, JSON.stringify(value));
}

function refreshMinutes() {
  const parsed = parseInt(typeof refresh_interval === "undefined" ? "30" : refresh_interval, 10);
  return [30, 60, 120].indexOf(parsed) >= 0 ? parsed : 30;
}

function normalizeDate(post) {
  const raw = firstValue(post, ["takenAt", "taken_at", "timestamp", "createdAt", "created_at", "published_at"]);
  if (raw == null) return null;
  if (typeof raw === "number" || /^\d+$/.test(stringValue(raw))) {
    const number = Number(raw);
    const date = new Date(number < 100000000000 ? number * 1000 : number);
    return isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return isNaN(date.getTime()) ? null : date;
}

function userForPost(post) {
  return firstValue(post, ["user", "author", "owner", "account"]) || {};
}

function usernameForUser(user) {
  return stringValue(firstValue(user, ["username", "handle", "user_name"])).replace(/^@+/, "");
}

function nameForUser(user) {
  return stringValue(firstValue(user, ["fullName", "full_name", "name", "displayName", "display_name"])) || usernameForUser(user) || "Threads user";
}

function avatarForUser(user) {
  const hd = firstValue(user, ["hdProfilePicURL", "hd_profile_pic_url"]);
  if (typeof hd === "string") return hd;
  if (hd && hd.url) return hd.url;
  return firstValue(user, ["profilePicURL", "profile_pic_url", "avatar", "avatar_url"]);
}

function uriForUser(user) {
  const handle = usernameForUser(user);
  return handle ? `https://www.threads.com/@${encodeURIComponent(handle)}` : "https://www.threads.com/";
}

function identityForUser(user) {
  const name = nameForUser(user);
  const handle = usernameForUser(user);
  let identity;
  if (typeof Identity !== "undefined" && typeof Identity.create === "function") {
    identity = Identity.create(name, handle ? `@${handle}` : null, avatarForUser(user) || null, uriForUser(user));
  } else if (typeof Identity !== "undefined" && typeof Identity.createWithName === "function") {
    identity = Identity.createWithName(name);
    if (handle) identity.username = `@${handle}`;
    if (avatarForUser(user)) identity.avatar = avatarForUser(user);
    identity.uri = uriForUser(user);
  }
  return identity;
}

function dimensionsFor(value, fallbackWidth, fallbackHeight) {
  const width = Number(firstValue(value, ["width", "originalWidth", "original_width"]) || fallbackWidth || 0);
  const height = Number(firstValue(value, ["height", "originalHeight", "original_height"]) || fallbackHeight || 0);
  return width > 0 && height > 0 ? { width, height } : null;
}

function bestVariant(values) {
  if (!Array.isArray(values) || !values.length) return null;
  return values.slice().sort((left, right) => {
    const l = Number(firstValue(left, ["width", "config_width"]) || 0) * Number(firstValue(left, ["height", "config_height"]) || 0);
    const r = Number(firstValue(right, ["width", "config_width"]) || 0) * Number(firstValue(right, ["height", "config_height"]) || 0);
    return r - l;
  })[0];
}

function imageVariants(post) {
  const direct = firstValue(post, ["imageVersions", "image_versions", "images"]);
  if (Array.isArray(direct)) return direct;
  return post && post.image_versions2 && Array.isArray(post.image_versions2.candidates) ? post.image_versions2.candidates : [];
}

function videoVariants(post) {
  const values = firstValue(post, ["videoVersions", "video_versions", "videos"]);
  return Array.isArray(values) ? values : [];
}

function mediaUrl(value) {
  return safeUrl(firstValue(value, ["url", "mediaUrl", "media_url", "src", "source"]));
}

function makeMedia(post) {
  if (typeof MediaAttachment === "undefined" || typeof MediaAttachment.createWithUrl !== "function") return null;
  const type = stringValue(firstValue(post, ["mediaType", "media_type", "productType", "product_type"])).toLowerCase();
  const video = bestVariant(videoVariants(post));
  const image = bestVariant(imageVariants(post));
  const gifUrl = safeUrl(firstValue(post, ["gifUrl", "gif_url"]));
  const url = gifUrl || mediaUrl(video) || mediaUrl(image) || mediaUrl(post);
  if (!url) return null;
  const attachment = MediaAttachment.createWithUrl(url);
  attachment.mimeType = gifUrl || type.indexOf("gif") >= 0 ? "image/gif" : (video || type.indexOf("video") >= 0 || Number(type) === 2 ? "video/mp4" : "image");
  const thumb = safeUrl(firstValue(post, ["thumbnail", "thumbnailUrl", "thumbnail_url", "coverUrl", "cover_url"])) || mediaUrl(image);
  if (thumb && attachment.mimeType === "video/mp4") attachment.thumbnail = thumb;
  const aspect = dimensionsFor(post, firstValue(video || image || {}, ["width", "config_width"]), firstValue(video || image || {}, ["height", "config_height"]));
  if (aspect) attachment.aspectSize = aspect;
  const alt = firstValue(post, ["altText", "alt_text", "accessibleText", "accessible_text", "accessibility_caption"]);
  if (alt) attachment.text = alt;
  return attachment;
}

function carouselForPost(post) {
  const value = firstValue(post, ["carouselMedia", "carousel_media", "carousel"]);
  if (Array.isArray(value)) return value;
  return value && Array.isArray(value.items) ? value.items : [];
}

function appInfo(post) {
  return firstValue(post, ["text_post_app_info", "textPostAppInfo"]) || {};
}

function linkPreviewForPost(post) {
  const info = appInfo(post);
  return firstValue(post, ["linkPreview", "link_preview", "link_preview_attachment", "linkAttachment", "link_attachment"]) ||
    firstValue(info, ["link_preview_attachment", "linkPreviewAttachment"]) || null;
}

function makeLinkAttachment(post) {
  if (typeof LinkAttachment === "undefined" || typeof LinkAttachment.createWithUrl !== "function") return null;
  const preview = linkPreviewForPost(post) || {};
  const url = safeUrl(firstValue(preview, ["url", "uri", "displayUrl", "display_url", "link_url"])) || safeUrl(firstValue(post, ["externalUrl", "external_url"]));
  if (!url) return null;
  const link = LinkAttachment.createWithUrl(url);
  const title = firstValue(preview, ["title", "headline"]);
  const description = firstValue(preview, ["description", "subtitle", "summary"]);
  const siteName = firstValue(preview, ["siteName", "site_name", "displayUrl", "display_url", "domain"]);
  let image = firstValue(preview, ["imageUrl", "image_url", "image", "thumbnailUrl", "thumbnail_url"]);
  if (image && typeof image === "object") image = firstValue(image, ["url", "uri"]);
  if (title) link.title = title;
  if (description) link.subtitle = description;
  if (siteName) link.siteName = siteName;
  if (safeUrl(image)) link.image = safeUrl(image);
  const aspect = dimensionsFor(preview);
  if (aspect) link.aspectSize = aspect;
  return link;
}

function shareInfo(post) {
  return firstValue(appInfo(post), ["share_info", "shareInfo"]) || {};
}

function nestedPost(post, names) {
  let value = firstValue(post, names);
  if (!value) value = firstValue(shareInfo(post), names);
  if (value && value.post && typeof value.post === "object") value = value.post;
  if (value && value.media && typeof value.media === "object") value = value.media;
  return value && typeof value === "object" ? value : null;
}

function isRepost(post) {
  return !!nestedPost(post, ["repostedPost", "reposted_post", "repost"] ) || !!post.isRepost || !!post.is_repost;
}

function isQuote(post) {
  return !!nestedPost(post, ["quotedPost", "quoted_post", "quoted_post_media"] ) || !!post.isQuotePost || !!post.is_quote_post;
}

function isReply(post) {
  return !!nestedPost(post, ["replyTo", "reply_to", "parent", "reply_to_post"]) || !!post.isReply || !!post.is_reply || !!post.isReplyToAuthor;
}

function postPermalink(post, user) {
  const direct = safeUrl(firstValue(post, ["permalink", "url", "webUrl", "web_url"]));
  if (direct) return direct;
  const handle = usernameForUser(user);
  const code = firstValue(post, ["code", "shortcode", "shortCode", "id", "pk", "fbid"]);
  if (handle && code) return `https://www.threads.com/@${encodeURIComponent(handle)}/post/${encodeURIComponent(code)}`;
  return code ? `https://www.threads.com/post/${encodeURIComponent(code)}` : "";
}

function postText(post) {
  const caption = post && post.caption;
  if (caption && typeof caption === "object") return firstValue(caption, ["text", "value"]);
  return firstValue(post, ["text", "body", "message", "caption"]);
}

function mediaAttachments(post) {
  const attachments = [];
  const carousel = carouselForPost(post);
  if (carousel.length) {
    for (const child of carousel) {
      const media = makeMedia(child);
      if (media) attachments.push(media);
    }
  } else {
    const media = makeMedia(post);
    if (media) attachments.push(media);
  }
  const link = makeLinkAttachment(post);
  if (link) attachments.push(link);
  return attachments;
}

function createAnnotation(text, uri, icon) {
  if (typeof Annotation === "undefined" || typeof Annotation.createWithText !== "function") return null;
  const value = Annotation.createWithText(text);
  if (uri) value.uri = uri;
  if (icon) value.icon = icon;
  return value;
}

function postToItem(post, depth) {
  if (!post || depth > 1) return null;
  const originalRepost = nestedPost(post, ["repostedPost", "reposted_post", "repost"]);
  const sourcePost = originalRepost || post;
  const sourceUser = userForPost(sourcePost);
  const date = normalizeDate(post) || normalizeDate(sourcePost);
  const uri = postPermalink(post, userForPost(post)) || postPermalink(sourcePost, sourceUser);
  if (!date || !uri || typeof Item === "undefined" || typeof Item.createWithUriDate !== "function") return null;
  const item = Item.createWithUriDate(uri, date);
  const body = textBody(postText(sourcePost));
  if (body) item.body = body;
  item.author = identityForUser(sourceUser);
  const attachments = mediaAttachments(sourcePost);
  const quote = nestedPost(sourcePost, ["quotedPost", "quoted_post", "quoted_post_media"]);
  if (quote) {
    const quotedItem = postToItem(quote, depth + 1);
    if (quotedItem) attachments.push(quotedItem);
  }
  if (attachments.length) item.attachments = attachments;
  const annotations = [];
  if (originalRepost) {
    const reposter = userForPost(post);
    const annotation = createAnnotation(`Reposted by ${nameForUser(reposter)}`, uriForUser(reposter), avatarForUser(reposter));
    if (annotation) annotations.push(annotation);
  }
  if (isReply(post)) {
    const parent = nestedPost(post, ["replyTo", "reply_to", "parent", "reply_to_post"]);
    const parentUser = parent ? userForPost(parent) : {};
    const annotation = createAnnotation(`Replying to ${usernameForUser(parentUser) || nameForUser(parentUser)}`, uriForUser(parentUser), avatarForUser(parentUser));
    if (annotation) annotations.push(annotation);
  }
  if (annotations.length) item.annotations = annotations;
  if (post.isSpoilerMedia || post.is_spoiler_media || post.contentWarning || post.content_warning) item.contentWarning = post.contentWarning || post.content_warning || "Spoiler";
  return item;
}

function looksLikePost(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const id = firstValue(value, ["id", "pk", "code", "fbid"]);
  const user = userForPost(value);
  const hasUser = !!firstValue(user, ["username", "handle", "full_name", "fullName"]);
  const hasContent = postText(value) != null || imageVariants(value).length || videoVariants(value).length || carouselForPost(value).length ||
    !!linkPreviewForPost(value) || isRepost(value) || isQuote(value);
  return !!id && hasUser && hasContent;
}

function flattenPage(page) {
  const posts = [];
  const seenObjects = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (seenObjects.indexOf(value) >= 0) return;
    seenObjects.push(value);
    if (looksLikePost(value)) {
      posts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const key of Object.keys(value)) visit(value[key]);
  }
  visit(page);
  return posts;
}

function nextCursor(page) {
  let result = "";
  const seen = [];
  function visit(value) {
    if (result || !value || typeof value !== "object" || seen.indexOf(value) >= 0) return;
    seen.push(value);
    const info = firstValue(value, ["page_info", "pageInfo"]);
    if (info && firstValue(info, ["has_next_page", "hasNextPage"]) !== false) {
      const cursor = firstValue(info, ["end_cursor", "endCursor", "next_cursor", "nextCursor"]);
      if (cursor) { result = stringValue(cursor); return; }
    }
    const direct = firstValue(value, ["next_max_id", "nextMaxId", "next_cursor", "nextCursor"]);
    if (direct) { result = stringValue(direct); return; }
    for (const key of Object.keys(value)) visit(value[key]);
  }
  visit(page);
  return result;
}

function signature() {
  return [
    stringValue(typeof query_doc_id === "undefined" ? "" : query_doc_id),
    stringValue(typeof include_reposts === "undefined" ? "on" : include_reposts),
    stringValue(typeof include_quotes === "undefined" ? "on" : include_quotes),
    stringValue(typeof include_replies === "undefined" ? "off" : include_replies)
  ].join("|");
}

function shouldInclude(post) {
  if (isRepost(post) && include_reposts !== "on") return false;
  if (isQuote(post) && include_quotes === "off") return false;
  if (isReply(post) && include_replies !== "on") return false;
  return true;
}

function collectPages(limit) {
  const pages = [];
  function next(cursor, remaining) {
    if (remaining <= 0) return Promise.resolve(pages);
    return requestPage(cursor).then(page => {
      pages.push(page);
      const cursorValue = nextCursor(page);
      return !cursorValue || cursorValue === cursor ? pages : next(cursorValue, remaining - 1);
    });
  }
  return next(null, limit);
}

function identityFromPage(page) {
  const first = flattenPage(page)[0];
  return first ? userForPost(first) : null;
}

function handleError(error) {
  if (error.authorization && typeof raiseCondition === "function") {
    raiseCondition("authorize", "Threads web session expired", "Sign in again, copy fresh Threads cookies, and update the connector.");
  } else {
    processError(error);
  }
}

function verify() {
  try { credentials(); variablesFor(null); } catch (error) { processError(error); return; }
  requestPage(null).then(page => {
    const user = identityFromPage(page);
    if (!user) {
      throw new Error("The selected GraphQL query returned no feed posts. Capture the /api/graphql pagination request created when scrolling the home feed, then paste its matching doc_id and complete variables JSON.");
    }
    const handle = user ? usernameForUser(user) : "";
    const verification = { displayName: handle ? `Threads Web · @${handle}` : "Threads Web" };
    if (user) {
      verification.accountIdentity = identityForUser(user);
      if (avatarForUser(user)) verification.icon = avatarForUser(user);
    }
    processVerification(verification);
  }).catch(handleError);
}

function load() {
  try { credentials(); variablesFor(null); } catch (error) { processError(error); return; }
  const state = readState();
  const feedSignature = signature();
  if (state.signature === feedSignature && state.loadedAt && Date.now() - state.loadedAt < refreshMinutes() * 60000) {
    processResults([], true);
    return;
  }
  collectPages(state.lastSeenAt ? 1 : MAX_BACKFILL_PAGES).then(pages => {
    const items = [];
    const seen = {};
    const ids = [];
    let newest = Number(state.lastSeenAt || 0);
    for (const page of pages) {
      for (const post of flattenPage(page)) {
        if (!shouldInclude(post)) continue;
        const date = normalizeDate(post);
        const item = postToItem(post, 0);
        if (!date || !item || seen[item.uri]) continue;
        if (state.lastSeenAt && date.getTime() <= Number(state.lastSeenAt)) continue;
        seen[item.uri] = true;
        ids.push(item.uri);
        newest = Math.max(newest, date.getTime());
        items.push(item);
      }
    }
    items.sort((left, right) => right.date.getTime() - left.date.getTime());
    writeState({ signature: feedSignature, loadedAt: Date.now(), lastSeenAt: newest, ids: ids.slice(0, MAX_STORED_IDS) });
    processResults(items, true);
  }).catch(handleError);
}
