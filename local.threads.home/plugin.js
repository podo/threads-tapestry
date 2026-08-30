const STATE_KEY = "threadsHomeStateV1";
const MAX_BACKFILL_PAGES = 3;
const MAX_BACKFILL_ITEMS = 1000;
const MAX_STORED_IDS = 100;
const TIMELINE_PATH = "/api/v1/feed/text_post_app_timeline/";

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
  let text = stringValue(value);
  if (!text) return "";
  let html = escapeHtml(text).replace(/\r?\n/g, "<br>");
  html = html.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+)/gi, (whole, prefix, raw) => {
    let label = raw;
    let trailing = "";
    while (/[),.!?;:]$/.test(label)) {
      trailing = label.slice(-1) + trailing;
      label = label.slice(0, -1);
    }
    const href = safeUrl(label.replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
    if (!href) return whole;
    return `${prefix}<a href="${escapeHtml(href)}">${label}</a>${trailing}`;
  });
  return `<p>${html}</p>`;
}

function parseFullResponse(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (_) {
    throw new Error("Threads returned an unreadable response.");
  }

  if (envelope && typeof envelope.status === "number" && Object.prototype.hasOwnProperty.call(envelope, "body")) {
    let body = {};
    try {
      body = envelope.body ? JSON.parse(envelope.body) : {};
    } catch (_) {
      body = {};
    }
    if (envelope.status === 401 || envelope.status === 403) {
      const authError = new Error("Threads authorization expired or was rejected.");
      authError.authorization = true;
      throw authError;
    }
    if (envelope.status < 200 || envelope.status >= 300) {
      const message = firstValue(body.error || {}, ["message", "error_message"]) ||
        firstValue(body, ["error_message", "message"]) || `HTTP ${envelope.status}`;
      throw new Error(`Threads home feed: ${message}`);
    }
    return body;
  }

  if (envelope && envelope.error) {
    const error = new Error(envelope.error.message || "Threads home feed error.");
    if (envelope.error.code === 401 || envelope.error.code === 403) error.authorization = true;
    throw error;
  }
  return envelope || {};
}

function credentials() {
  const token = stringValue(typeof mobile_token === "undefined" ? "" : mobile_token).trim();
  const device = stringValue(typeof device_id === "undefined" ? "" : device_id).trim();
  if (!token) throw new Error("Paste the Threads mobile token (IGT:2:…) into the connector settings.");
  if (!device) throw new Error("Enter the stable android-… device ID used by the token helper.");
  return { token, device };
}

function requestHeaders(token, device) {
  return {
    "Authorization": `Bearer ${token}`,
    "User-Agent": "Barcelona 289.0.0.77.109 Android",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "X-IG-App-ID": "238260118697367",
    "X-IG-Capabilities": "3brTvx0=",
    "X-IG-Connection-Type": "WIFI",
    "X-Device-ID": device
  };
}

function timelineUrl(cursor, kind, device) {
  const params = [
    `feed_type=${encodeURIComponent(kind || "for_you")}`,
    "feed_view_info=%5B%5D",
    "reason=cold_start_fetch",
    `client_session_id=${encodeURIComponent(device)}`,
    "pagination_source_module=feed_unit"
  ];
  if (cursor) params.push(`max_id=${encodeURIComponent(cursor)}`);
  return `${site}${TIMELINE_PATH}?${params.join("&")}`;
}

function requestPage(cursor) {
  const auth = credentials();
  const kind = stringValue(typeof feed_kind === "undefined" ? "for_you" : feed_kind).toLowerCase();
  const validKind = kind === "following" ? "following" : "for_you";
  return sendRequest(
    timelineUrl(cursor, validKind, auth.device),
    "GET",
    null,
    requestHeaders(auth.token, auth.device),
    true
  ).then(parseFullResponse);
}

function readState() {
  if (typeof getItem !== "function") return {};
  try {
    return JSON.parse(getItem(STATE_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function writeState(value) {
  if (typeof setItem === "function") setItem(STATE_KEY, JSON.stringify(value));
}

function refreshMinutes() {
  const parsed = parseInt(typeof refresh_interval === "undefined" ? "30" : refresh_interval, 10);
  return [30, 60, 120].indexOf(parsed) >= 0 ? parsed : 30;
}

function isThrottled(state, signature) {
  return state && state.signature === signature && state.loadedAt &&
    Date.now() - state.loadedAt < refreshMinutes() * 60000;
}

function normalizeDate(post) {
  const raw = firstValue(post, ["takenAt", "taken_at", "timestamp", "createdAt", "created_at"]);
  if (raw == null) return null;
  if (typeof raw === "number") {
    const milliseconds = raw < 100000000000 ? raw * 1000 : raw;
    const numericDate = new Date(milliseconds);
    return isNaN(numericDate.getTime()) ? null : numericDate;
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
  return stringValue(firstValue(user, ["fullName", "full_name", "name", "displayName", "display_name"])) ||
    usernameForUser(user) || "Threads user";
}

function avatarForUser(user) {
  return firstValue(user, ["hdProfilePicURL", "hd_profile_pic_url", "profilePicURL", "profile_pic_url", "avatar"]);
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
    identity.uri = uriForUser(user);
    if (avatarForUser(user)) identity.avatar = avatarForUser(user);
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
  const source = firstValue(post, ["imageVersions", "image_versions", "images"]);
  if (Array.isArray(source)) return source;
  const nested = post && post.image_versions2 && post.image_versions2.candidates;
  return Array.isArray(nested) ? nested : [];
}

function videoVariants(post) {
  const source = firstValue(post, ["videoVersions", "video_versions", "videos"]);
  return Array.isArray(source) ? source : [];
}

function mediaUrl(value) {
  return safeUrl(firstValue(value, ["url", "mediaUrl", "media_url", "src", "source"]));
}

function makeMedia(post) {
  if (typeof MediaAttachment === "undefined" || typeof MediaAttachment.createWithUrl !== "function") return null;
  const type = stringValue(firstValue(post, ["mediaType", "media_type", "productType", "product_type"])).toLowerCase();
  const videos = videoVariants(post);
  const images = imageVariants(post);
  const video = bestVariant(videos);
  const image = bestVariant(images);
  const gifUrl = safeUrl(firstValue(post, ["gifUrl", "gif_url"]));
  const url = gifUrl || mediaUrl(video) || mediaUrl(image) || mediaUrl(post);
  if (!url) return null;

  const attachment = MediaAttachment.createWithUrl(url);
  attachment.mimeType = gifUrl || type.indexOf("gif") >= 0 ? "image/gif" :
    (video || type.indexOf("video") >= 0 ? "video/mp4" : "image");
  const thumb = safeUrl(firstValue(post, ["thumbnail", "thumbnailUrl", "thumbnail_url", "coverUrl", "cover_url"])) ||
    safeUrl(firstValue(video || {}, ["thumbnail", "thumbnailUrl", "thumbnail_url"]));
  if (thumb) attachment.thumbnail = thumb;
  const aspect = dimensionsFor(post, firstValue(video || image || {}, ["width", "config_width"]), firstValue(video || image || {}, ["height", "config_height"]));
  if (aspect) attachment.aspectSize = aspect;
  const alt = firstValue(post, ["altText", "alt_text", "accessibleText", "accessible_text"]);
  if (alt) attachment.text = alt;
  return attachment;
}

function carouselForPost(post) {
  const carousel = firstValue(post, ["carouselMedia", "carousel_media", "carousel"]);
  if (Array.isArray(carousel)) return carousel;
  if (carousel && Array.isArray(carousel.items)) return carousel.items;
  return [];
}

function linkPreviewForPost(post) {
  return firstValue(post, ["linkPreview", "link_preview", "link_preview_attachment", "linkAttachment", "link_attachment"]) || null;
}

function makeLinkAttachment(post) {
  if (typeof LinkAttachment === "undefined" || typeof LinkAttachment.createWithUrl !== "function") return null;
  const preview = linkPreviewForPost(post) || {};
  const url = safeUrl(firstValue(preview, ["url", "uri", "displayUrl", "display_url"])) ||
    safeUrl(firstValue(post, ["linkAttachmentUrl", "link_attachment_url", "externalUrl", "external_url"]));
  if (!url) return null;
  const link = LinkAttachment.createWithUrl(url);
  const title = firstValue(preview, ["title", "headline"]);
  const description = firstValue(preview, ["description", "subtitle", "summary"]);
  const siteName = firstValue(preview, ["siteName", "site_name", "displayUrl", "display_url"]);
  const image = safeUrl(firstValue(preview, ["imageUrl", "image_url", "image", "thumbnailUrl", "thumbnail_url"]));
  if (title) link.title = title;
  if (description) link.subtitle = description;
  if (siteName) link.siteName = siteName;
  if (image) link.image = image;
  const aspect = dimensionsFor(preview);
  if (aspect) link.aspectSize = aspect;
  return link;
}

function nestedPost(post, names) {
  const value = firstValue(post, names);
  return value && typeof value === "object" ? value : null;
}

function isRepost(post) {
  const type = stringValue(firstValue(post, ["mediaType", "media_type", "productType", "product_type"])).toLowerCase();
  return !!nestedPost(post, ["repostedPost", "reposted_post"]) || type.indexOf("repost") >= 0 || !!post.isRepost || !!post.is_repost;
}

function isQuote(post) {
  return !!nestedPost(post, ["quotedPost", "quoted_post"]) || !!post.isQuotePost || !!post.is_quote_post;
}

function isReply(post) {
  return !!nestedPost(post, ["replyTo", "reply_to", "parent"]) || !!post.isReply || !!post.is_reply || !!post.isReplyToAuthor;
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
      const attachment = makeMedia(child);
      if (attachment) attachments.push(attachment);
    }
  } else {
    const attachment = makeMedia(post);
    if (attachment) attachments.push(attachment);
  }
  const link = makeLinkAttachment(post);
  if (link) attachments.push(link);
  return attachments;
}

function createAnnotation(text, uri, icon) {
  if (typeof Annotation === "undefined" || typeof Annotation.createWithText !== "function") return null;
  const result = Annotation.createWithText(text);
  if (uri) result.uri = uri;
  if (icon) result.icon = icon;
  return result;
}

function postToItem(post, depth) {
  if (!post || depth > 1) return null;
  const originalRepost = nestedPost(post, ["repostedPost", "reposted_post"]);
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
  const quote = nestedPost(sourcePost, ["quotedPost", "quoted_post"]);
  if (quote) {
    const quotedItem = postToItem(quote, depth + 1);
    if (quotedItem) attachments.push(quotedItem);
  }
  if (attachments.length) item.attachments = attachments;

  const annotations = [];
  if (originalRepost) {
    const reposter = userForPost(post);
    const reposterName = nameForUser(reposter);
    const value = createAnnotation(`Reposted by ${reposterName}`, uriForUser(reposter), avatarForUser(reposter));
    if (value) annotations.push(value);
  }
  if (isReply(post)) {
    const parent = nestedPost(post, ["replyTo", "reply_to", "parent"]);
    const parentUser = parent ? userForPost(parent) : {};
    const parentName = usernameForUser(parentUser) || nameForUser(parentUser);
    const value = createAnnotation(`Replying to ${parentName}`, uriForUser(parentUser), avatarForUser(parentUser));
    if (value) annotations.push(value);
  }
  if (annotations.length) item.annotations = annotations;

  if (post.isSpoilerMedia || post.is_spoiler_media || post.contentWarning || post.content_warning) {
    item.contentWarning = post.contentWarning || post.content_warning || "Spoiler";
  }
  return item;
}

function flattenPage(page) {
  const entries = Array.isArray(page.threads) ? page.threads :
    (Array.isArray(page.items) ? page.items : (Array.isArray(page.feed) ? page.feed : []));
  const posts = [];
  for (const entry of entries) {
    const children = firstValue(entry, ["threadItems", "thread_items", "items"]);
    if (Array.isArray(children) && children.length) {
      for (const child of children) posts.push(child);
    } else if (entry && entry.post && typeof entry.post === "object") {
      posts.push(entry.post);
    } else if (entry && typeof entry === "object") {
      posts.push(entry);
    }
  }
  return posts;
}

function nextCursor(page) {
  const raw = firstValue(page, ["next_max_id", "nextMaxId", "next_cursor", "nextCursor"]);
  return raw == null ? "" : String(raw);
}

function signature() {
  return [
    stringValue(typeof feed_kind === "undefined" ? "for_you" : feed_kind),
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

function pageLimit(state) {
  return state && state.lastSeenAt ? 1 : MAX_BACKFILL_PAGES;
}

function collectPages(state) {
  const pages = [];
  function next(cursor, remaining) {
    if (remaining <= 0) return Promise.resolve(pages);
    return requestPage(cursor).then(page => {
      pages.push(page);
      const nextId = nextCursor(page);
      if (!nextId || nextId === cursor) return pages;
      const posts = pages.reduce((count, value) => count + flattenPage(value).length, 0);
      if (posts >= MAX_BACKFILL_ITEMS) return pages;
      return next(nextId, remaining - 1);
    });
  }
  return next(null, pageLimit(state));
}

function accountIdentityFromPages(pages) {
  const configured = stringValue(typeof account_handle === "undefined" ? "" : account_handle).replace(/^@+/, "");
  for (const page of pages) {
    const post = flattenPage(page)[0];
    if (post) {
      const user = userForPost(post);
      if (usernameForUser(user) || nameForUser(user)) return user;
    }
  }
  return configured ? { username: configured, fullName: configured } : null;
}

function verify() {
  let auth;
  try {
    auth = credentials();
  } catch (error) {
    processError(error);
    return;
  }
  requestPage(null).then(page => {
    const user = accountIdentityFromPages([page]);
    const verification = { displayName: user ? `Threads · @${usernameForUser(user) || nameForUser(user)}` : "Threads Home" };
    if (user) {
      const identity = identityForUser(user);
      if (identity) verification.accountIdentity = identity;
      if (avatarForUser(user)) verification.icon = avatarForUser(user);
    }
    processVerification(verification);
  }).catch(error => {
    if (error.authorization && typeof raiseCondition === "function") {
      raiseCondition("authorize", "Threads authorization expired", "Run the local token helper and enter a fresh mobile token.");
    } else {
      processError(error);
    }
  });
}

function load() {
  let auth;
  try {
    auth = credentials();
  } catch (error) {
    processError(error);
    return;
  }
  const state = readState();
  const feedSignature = signature();
  if (isThrottled(state, feedSignature)) {
    processResults([], true);
    return;
  }

  collectPages(state).then(pages => {
    const items = [];
    const seen = {};
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const lastSeenAt = Number(state.lastSeenAt || 0);
    let newest = lastSeenAt;
    const ids = [];
    for (const page of pages) {
      for (const post of flattenPage(page)) {
        if (!shouldInclude(post)) continue;
        const date = normalizeDate(post);
        if (!date || date.getTime() < cutoff) continue;
        const item = postToItem(post, 0);
        if (!item || seen[item.uri]) continue;
        if (lastSeenAt && date.getTime() <= lastSeenAt && !state.replay) continue;
        seen[item.uri] = true;
        ids.push(item.uri);
        if (date.getTime() > newest) newest = date.getTime();
        items.push(item);
      }
    }
    items.sort((left, right) => right.date.getTime() - left.date.getTime());
    writeState({
      signature: feedSignature,
      loadedAt: Date.now(),
      lastSeenAt: newest,
      ids: ids.slice(0, MAX_STORED_IDS),
      device: auth.device
    });
    processResults(items, true);
  }).catch(error => {
    if (error.authorization && typeof raiseCondition === "function") {
      raiseCondition("authorize", "Threads authorization expired", "Run the local token helper and enter a fresh mobile token.");
    } else {
      processError(error);
    }
  });
}
