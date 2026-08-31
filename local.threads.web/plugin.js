const STATE_KEY = "threadsWebStateV1";
const MAX_BACKFILL_PAGES = 3;
const MAX_STORED_IDS = 100;
const DEFAULT_FOLLOWING_CAP = 12;
const POSTS_PER_FOLLOWING = 8;
const FOLLOWING_CONCURRENCY = 4;
const AVATAR_EMBED_CONCURRENCY = 4;
const MAX_AVATAR_BYTES = 200000;
const GRAPHQL_PATH = "/api/graphql/";
// Threads rejects desktop browser UAs on cookie REST with "useragent mismatch".
const READ_USER_AGENT = "Barcelona 289.0.0.14.109 Android";
const THREADS_APP_ID = "238260118697367";
const DEFAULT_GRAPHQL_VARIABLES = { first: 25, after: "__CURSOR__", scale: 2 };
const connectorBuildId = "2026-08-31T21:45Z-feed-label";
const connectorPluginVersion = 10;
const connectorRelease = "0.7.1";

let avatarDataUrlCache = null;

function connectorStamp() {
  return `${connectorBuildId}@plugin${connectorPluginVersion}@${connectorRelease}`;
}

function logBuild(stage) {
  try { console.log(`threads-web ${stage} ${connectorStamp()}`); } catch (_) { /* Loom console optional */ }
}

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

function looksLikeHttpUrl(value) {
  return /^(?:https?:\/\/|www\.)[^\s<>"']+/i.test(stringValue(value).trim());
}

function trimUrlPunctuation(raw) {
  let label = stringValue(raw);
  let trailing = "";
  while (/[),.!?;:]$/.test(label)) {
    trailing = label.slice(-1) + trailing;
    label = label.slice(0, -1);
  }
  return { label, trailing };
}

function linkifyInline(escapedHtml) {
  let html = stringValue(escapedHtml);
  html = html.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+)/gi, (whole, prefix, raw) => {
    const trimmed = trimUrlPunctuation(raw);
    const href = safeUrl(trimmed.label.replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
    if (!href || !looksLikeHttpUrl(trimmed.label.replace(/&amp;/g, "&"))) return whole;
    return `${prefix}<a href="${escapeHtml(href)}">${trimmed.label}</a>${trimmed.trailing}`;
  });
  html = html.replace(/(^|[\s(])@([A-Za-z0-9._]+)/g, (whole, prefix, handle) =>
    `${prefix}<a href="https://www.threads.com/@${encodeURIComponent(handle)}">@${escapeHtml(handle)}</a>`);
  html = html.replace(/(^|[\s(])#([^\s<#]+)/g, (whole, prefix, tag) =>
    `${prefix}<a href="https://www.threads.com/search?q=${encodeURIComponent("#" + tag)}&serp_type=tags">#${escapeHtml(tag)}</a>`);
  // Final pass: wrap leftover plain https://; skip open tags and existing <a> bodies.
  html = html.replace(/https?:\/\/[^\s<]+/gi, (match, offset, full) => {
    const preceding = full.slice(0, offset);
    if (preceding.lastIndexOf("<") > preceding.lastIndexOf(">")) return match;
    const lastOpen = preceding.lastIndexOf("<a ");
    const lastClose = preceding.lastIndexOf("</a>");
    if (lastOpen > lastClose) return match;
    const trimmed = trimUrlPunctuation(match);
    const href = safeUrl(trimmed.label);
    if (!href) return match;
    return `<a href="${escapeHtml(href)}">${trimmed.label}</a>${trimmed.trailing}`;
  });
  return html;
}

function isThreadsUrl(url) {
  const host = urlHost(url);
  return /(^|\.)threads\.(com|net)$/i.test(host);
}

function articleUrlForPost(post) {
  const preview = linkPreviewForPost(post) || {};
  const fromPreview = safeUrl(firstValue(preview, ["url", "uri", "link_url"]));
  if (fromPreview && !isThreadsUrl(fromPreview)) return fromPreview;
  const external = safeUrl(firstValue(post, ["externalUrl", "external_url"]));
  if (external && !isThreadsUrl(external)) return external;
  const text = stringValue(postText(post));
  const match = text.match(/(?:https?:\/\/|www\.)[^\s<>"']+/i);
  if (!match) return "";
  const trimmed = trimUrlPunctuation(match[0]);
  const href = safeUrl(trimmed.label);
  return href && !isThreadsUrl(href) ? href : "";
}

function metricsCountsForPost(post) {
  return {
    likes: Number(firstValue(post, ["like_count", "likeCount", "likes"]) || 0),
    replies: Number(firstValue(post, ["reply_count", "replyCount", "comment_count"]) || firstValue(appInfo(post), ["direct_reply_count", "reply_count"]) || 0),
    reposts: Number(firstValue(post, ["repost_count", "repostCount", "reshare_count"]) || firstValue(appInfo(post), ["repost_count"]) || 0)
  };
}

function metricsTextFromCounts(metrics) {
  const details = [];
  if (metrics.replies > 0) details.push(`${metrics.replies} ${metrics.replies === 1 ? "reply" : "replies"}`);
  if (metrics.reposts > 0) details.push(`${metrics.reposts} reposts`);
  if (metrics.likes > 0) details.push(`${metrics.likes} likes`);
  return details.join(" - ");
}

function metricsMetaHtml(text) {
  return `<p class="threads-meta-metrics"><small>${escapeHtml(text)}</small></p>`;
}

function postMetaHtml(post) {
  const blocks = [];
  const article = articleUrlForPost(post);
  if (article) {
    const label = urlHost(article) || article;
    blocks.push(`<p class="threads-meta-host"><a href="${escapeHtml(article)}">${escapeHtml(label)}</a></p>`);
  }
  if (showMetrics()) {
    const text = metricsTextFromCounts(metricsCountsForPost(post));
    if (text) blocks.push(metricsMetaHtml(text));
  }
  return blocks.join("");
}

function buildSplitLinkBody(text) {
  const value = stringValue(text).trim();
  if (!value) return "";
  const urls = [];
  let caption = value.replace(/(?:https?:\/\/|www\.)[^\s<]+/gi, match => {
    const trimmed = trimUrlPunctuation(match);
    const href = safeUrl(trimmed.label);
    if (!href) return match;
    urls.push(href);
    return trimmed.trailing || "";
  });
  caption = caption.replace(/[ \t]{2,}/g, " ").replace(/^\s+|\s+$/g, "");
  const blocks = [];
  if (caption) {
    blocks.push(`<p>${linkifyInline(escapeHtml(caption).replace(/\r?\n/g, "<br>"))}</p>`);
  }
  const seen = {};
  for (const url of urls) {
    if (seen[url]) continue;
    seen[url] = true;
    blocks.push(`<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`);
  }
  if (!blocks.length) {
    return `<p>${linkifyInline(escapeHtml(value).replace(/\r?\n/g, "<br>"))}</p>`;
  }
  return blocks.join("");
}

function postBody(post) {
  const meta = postMetaHtml(post);
  const caption = buildSplitLinkBody(postText(post));
  const html = meta + caption;
  if (!html) return `<!-- ${escapeHtml(connectorStamp())} -->`;
  return `${html}<!-- ${escapeHtml(connectorStamp())} -->`;
}

function parseMetricsFromText(text) {
  const value = stringValue(text);
  const metrics = { replies: 0, reposts: 0, likes: 0 };
  const replies = value.match(/([\d,.]+)\s+replies?/i);
  const reposts = value.match(/([\d,.]+)\s+reposts?/i);
  const likes = value.match(/([\d,.]+)\s+likes?/i);
  if (replies) metrics.replies = Number(String(replies[1]).replace(/,/g, "")) || 0;
  if (reposts) metrics.reposts = Number(String(reposts[1]).replace(/,/g, "")) || 0;
  if (likes) metrics.likes = Number(String(likes[1]).replace(/,/g, "")) || 0;
  if (!replies && !reposts && !likes) return null;
  return metrics;
}

function adjustEngagementBodyMetrics(body, actionId) {
  const html = stringValue(body);
  const match = html.match(/<p class="threads-meta-metrics">([\s\S]*?)<\/p>/i);
  if (!match) return body;
  const inner = stringValue(match[1]).replace(/<\/?small>/gi, "");
  const metrics = parseMetricsFromText(inner);
  if (!metrics) return body;
  if (actionId === "like") metrics.likes += 1;
  else if (actionId === "unlike") metrics.likes = Math.max(0, metrics.likes - 1);
  else if (actionId === "repost") metrics.reposts += 1;
  else if (actionId === "unrepost") metrics.reposts = Math.max(0, metrics.reposts - 1);
  else return body;
  const nextText = metricsTextFromCounts(metrics);
  if (!nextText) return html.replace(match[0], "");
  return html.replace(match[0], metricsMetaHtml(nextText));
}

function urlHost(url) {
  const match = stringValue(url).match(/^https?:\/\/([^/?#]+)/i);
  return match ? match[1].replace(/^www\./i, "") : "";
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
    try {
      const raw = stringValue(envelope.body).trim();
      body = raw ? parseJsonChunks(raw) : {};
    } catch (_) {
      try { body = JSON.parse(envelope.body); } catch (__) { body = {}; }
    }
    if (envelope.status === 401 || envelope.status === 403) {
      const error = new Error("Threads web session expired or was rejected.");
      error.authorization = true;
      throw error;
    }
    if (envelope.status < 200 || envelope.status >= 300) {
      const message = firstValue(body.error || {}, ["message", "error_user_msg"]) ||
        firstValue(body, ["message", "error_message", "status"]) || `HTTP ${envelope.status}`;
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

function feedKind() {
  const value = stringValue(typeof feed_kind === "undefined" ? "following" : feed_kind).toLowerCase().replace(/\s+/g, "_");
  return value === "for_you" || value === "foryou" ? "for_you" : "following";
}

function sourceLabel() {
  return feedKind() === "for_you" ? "For You" : "Following";
}

function credentials() {
  const sessionId = stringValue(typeof sessionid === "undefined" ? "" : sessionid).trim();
  const csrfToken = stringValue(typeof csrftoken === "undefined" ? "" : csrftoken).trim();
  if (!sessionId || !csrfToken) {
    throw new Error("Enter sessionid and csrftoken from Application → Cookies on threads.com.");
  }
  let dsUserId = stringValue(typeof ds_user_id === "undefined" ? "" : ds_user_id).trim();
  if (!dsUserId) {
    const match = decodeURIComponent(sessionId).match(/^(\d+)/);
    if (match) dsUserId = match[1];
  }
  if (!dsUserId) throw new Error("Enter ds_user_id, or use a sessionid that starts with your numeric user id.");
  return {
    sessionid: sessionId,
    csrftoken: csrfToken,
    ds_user_id: dsUserId,
    mid: stringValue(typeof mid === "undefined" ? "" : mid).trim(),
    ig_did: stringValue(typeof ig_did === "undefined" ? "" : ig_did).trim(),
    rur: "",
    docId: stringValue(typeof query_doc_id === "undefined" ? "" : query_doc_id).trim(),
    bearer: stringValue(typeof authorization_bearer === "undefined" ? "" : authorization_bearer).trim()
  };
}

function cookieHeader(auth) {
  const values = [`sessionid=${auth.sessionid}`, `csrftoken=${auth.csrftoken}`, `ds_user_id=${auth.ds_user_id}`];
  if (auth.mid) values.push(`mid=${auth.mid}`);
  if (auth.ig_did) values.push(`ig_did=${auth.ig_did}`);
  if (auth.rur) values.push(`rur=${auth.rur}`);
  return values.join("; ");
}

function requestHeaders(auth, contentType, forWrite) {
  const headers = {
    "Accept": "*/*",
    "Cookie": cookieHeader(auth),
    "Origin": site,
    "Referer": `${site}/`,
    "User-Agent": READ_USER_AGENT,
    "X-CSRFToken": auth.csrftoken,
    "X-IG-App-ID": THREADS_APP_ID
  };
  if (contentType) headers["Content-Type"] = contentType;
  if (forWrite && auth.bearer) {
    headers.Authorization = /^Bearer\s+/i.test(auth.bearer) ? auth.bearer : `Bearer ${auth.bearer}`;
  }
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
  return replaceVariables(JSON.parse(JSON.stringify(DEFAULT_GRAPHQL_VARIABLES)), cursor);
}

function restGet(auth, path, query) {
  const url = `${site}${path}${query ? `?${query}` : ""}`;
  return sendRequest(url, "GET", null, requestHeaders(auth), true).then(parseFullResponse);
}

function restPost(auth, path, body) {
  return sendRequest(`${site}${path}`, "POST", body, requestHeaders(auth, "application/x-www-form-urlencoded", true), true)
    .then(parseFullResponse);
}

function requestGraphqlPage(auth, cursor) {
  if (!auth.docId) {
    return Promise.reject(new Error("For You needs a home-feed GraphQL doc_id. Capture it from the Threads Network tab, or switch Feed to Following."));
  }
  const params = [
    "fb_api_caller_class=RelayModern",
    `variables=${encodeURIComponent(JSON.stringify(variablesFor(cursor)))}`,
    `doc_id=${encodeURIComponent(auth.docId)}`,
    "server_timestamps=true"
  ].join("&");
  return sendRequest(`${site}${GRAPHQL_PATH}`, "POST", params, requestHeaders(auth, "application/x-www-form-urlencoded"), true)
    .then(parseFullResponse);
}

function readState() {
  if (typeof getItem !== "function") return {};
  try { return JSON.parse(getItem(STATE_KEY) || "{}") || {}; } catch (_) { return {}; }
}

function writeState(value) {
  if (typeof setItem === "function") setItem(STATE_KEY, JSON.stringify(value));
}

function modeStateKey() {
  return feedKind();
}

function readModeState() {
  const all = readState();
  const modes = all.modes && typeof all.modes === "object" ? all.modes : {};
  const mode = modes[modeStateKey()];
  if (mode && typeof mode === "object") return mode;
  // Migrate pre-0.6 flat lastSeenAt onto the active mode once.
  if (all.lastSeenAt && modeStateKey() === "following") {
    return { lastSeenAt: all.lastSeenAt, ids: Array.isArray(all.ids) ? all.ids : [] };
  }
  return { lastSeenAt: 0, ids: [] };
}

function writeModeState(feedSignature, modePartial) {
  const all = readState();
  const modes = Object.assign({}, all.modes && typeof all.modes === "object" ? all.modes : {});
  modes[modeStateKey()] = Object.assign({}, modes[modeStateKey()] || {}, modePartial);
  writeState({
    signature: feedSignature,
    loadedAt: Date.now(),
    modes
  });
}

function refreshMinutes() {
  const parsed = parseInt(typeof refresh_interval === "undefined" ? "30" : refresh_interval, 10);
  return [30, 60, 120].indexOf(parsed) >= 0 ? parsed : 30;
}

function showMetrics() {
  return stringValue(typeof show_metrics === "undefined" ? "on" : show_metrics) !== "off";
}

function followingAccountCap() {
  const parsed = parseInt(typeof following_account_cap === "undefined" ? String(DEFAULT_FOLLOWING_CAP) : following_account_cap, 10);
  return [8, 12, 20, 40].indexOf(parsed) >= 0 ? parsed : DEFAULT_FOLLOWING_CAP;
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
  const hd = firstValue(user, ["hdProfilePicURL", "hd_profile_pic_url", "hd_profile_pic_url_info"]);
  if (typeof hd === "string") return hd;
  if (hd && hd.url) return hd.url;
  return firstValue(user, ["profilePicURL", "profile_pic_url", "avatar", "avatar_url"]);
}

function uriForUser(user) {
  const handle = usernameForUser(user);
  return handle ? `https://www.threads.com/@${encodeURIComponent(handle)}` : "https://www.threads.com/";
}

function identityForUser(user) {
  if (typeof Identity === "undefined" || typeof Identity.createWithName !== "function") return null;
  const name = nameForUser(user);
  const handle = usernameForUser(user);
  const identity = Identity.createWithName(name);
  if (handle) identity.username = `@${handle}`;
  identity.uri = uriForUser(user);
  const avatar = avatarForUser(user);
  if (avatar) identity.avatar = avatar;
  return identity;
}

function summarizeAvatar(url) {
  const raw = stringValue(url);
  if (!raw) return "missing";
  if (raw.indexOf("data:image/") === 0) return `data:${raw.length}`;
  const host = urlHost(raw);
  return host ? `url:${host}` : "url";
}

function shouldEmbedAvatarUrl(url) {
  const host = urlHost(url);
  return !!host && /(cdninstagram|fbcdn|instagram\.|threads\.|scontent)/i.test(host);
}

function bytesToBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (first << 16) | (second << 8) | third;
    result += alphabet[(triple >> 18) & 63];
    result += alphabet[(triple >> 12) & 63];
    result += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    result += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return result;
}

function base64ToBytes(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const cleaned = stringValue(value).replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes = [];
  for (let index = 0; index < cleaned.length; index += 4) {
    const a = alphabet.indexOf(cleaned[index]);
    const b = alphabet.indexOf(cleaned[index + 1]);
    const c = alphabet.indexOf(cleaned[index + 2]);
    const d = alphabet.indexOf(cleaned[index + 3]);
    if (a < 0 || b < 0) break;
    bytes.push(((a << 2) | (b >> 4)) & 255);
    if (c >= 0) bytes.push(((b << 4) | (c >> 2)) & 255);
    if (d >= 0) bytes.push(((c << 6) | d) & 255);
  }
  return bytes;
}

function responseBodyBytes(envelope) {
  const body = envelope && envelope.body;
  if (body == null) return [];
  if (Array.isArray(body)) return body.map(value => Number(value) & 255);
  if (typeof body === "object" && Array.isArray(body.data)) return body.data.map(value => Number(value) & 255);
  if (typeof body !== "string") return [];
  const trimmed = body.trim();
  if (trimmed.indexOf("data:image/") === 0) {
    const comma = trimmed.indexOf(",");
    return comma >= 0 ? base64ToBytes(trimmed.slice(comma + 1)) : [];
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length >= 24 && trimmed.length % 4 === 0) {
    const decoded = base64ToBytes(trimmed);
    if (decoded.length) return decoded;
  }
  const bytes = [];
  for (let i = 0; i < body.length; i += 1) bytes.push(body.charCodeAt(i) & 255);
  return bytes;
}

function headerValue(headers, name) {
  if (!headers) return "";
  const target = stringValue(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (stringValue(key).toLowerCase() === target) return stringValue(headers[key]);
  }
  return "";
}

function avatarDataUrlForUrl(url) {
  const normalized = safeUrl(url);
  if (!normalized || !shouldEmbedAvatarUrl(normalized)) return Promise.resolve(normalized || url);
  if (!avatarDataUrlCache) avatarDataUrlCache = {};
  if (Object.prototype.hasOwnProperty.call(avatarDataUrlCache, normalized)) {
    return Promise.resolve(avatarDataUrlCache[normalized]);
  }
  return sendRequest(normalized, "GET", null, {
    "User-Agent": READ_USER_AGENT,
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
  }, true).then(text => {
    let envelope;
    try { envelope = JSON.parse(text); } catch (_) { envelope = null; }
    if (!envelope || typeof envelope.status !== "number" || envelope.status < 200 || envelope.status >= 400) {
      avatarDataUrlCache[normalized] = normalized;
      return normalized;
    }
    const mime = (headerValue(envelope.headers, "content-type").split(";")[0] || "image/jpeg").trim() || "image/jpeg";
    const bytes = responseBodyBytes(envelope);
    if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
      avatarDataUrlCache[normalized] = normalized;
      return normalized;
    }
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    avatarDataUrlCache[normalized] = dataUrl;
    return dataUrl;
  }).catch(() => {
    avatarDataUrlCache[normalized] = normalized;
    return normalized;
  });
}

function embedItemAvatar(item) {
  if (!item || !item.author || !item.author.avatar) return Promise.resolve(item);
  const input = item.author.avatar;
  if (stringValue(input).indexOf("data:image/") === 0) {
    if (item.actions) {
      item.actions._authorAvatarInput = summarizeAvatar(input);
      item.actions._authorAvatarAssigned = summarizeAvatar(input);
    }
    return Promise.resolve(item);
  }
  return avatarDataUrlForUrl(input).then(assigned => {
    item.author.avatar = assigned || input;
    if (item.actions) {
      item.actions._authorAvatarInput = summarizeAvatar(input);
      item.actions._authorAvatarAssigned = summarizeAvatar(item.author.avatar);
    }
    return item;
  });
}

function embedItemAvatars(items) {
  return mapPool(items, AVATAR_EMBED_CONCURRENCY, embedItemAvatar).then(() => items);
}

function userId(user) {
  return stringValue(firstValue(user, ["pk", "id", "pk_id", "user_id", "userId"]));
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
  const audioUrl = safeUrl(firstValue(post, ["audioUrl", "audio_url"]));
  const url = gifUrl || mediaUrl(video) || audioUrl || mediaUrl(image) || mediaUrl(post);
  if (!url) return null;
  const attachment = MediaAttachment.createWithUrl(url);
  if (gifUrl || type.indexOf("gif") >= 0) attachment.mimeType = "image/gif";
  else if (video || type.indexOf("video") >= 0 || Number(type) === 2) attachment.mimeType = "video/mp4";
  else if (audioUrl || type.indexOf("audio") >= 0) attachment.mimeType = "audio";
  else attachment.mimeType = "image";
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
  if (!safeUrl(image)) {
    const media = makeMedia(post);
    if (media && media.mimeType !== "video/mp4") image = media.url;
    else if (media && media.thumbnail) image = media.thumbnail;
  }
  link.title = stringValue(title || siteName || urlHost(url) || url);
  if (description) link.subtitle = description;
  if (siteName) link.siteName = siteName;
  else if (urlHost(url)) link.siteName = urlHost(url);
  if (safeUrl(image)) link.image = safeUrl(image);
  const aspect = dimensionsFor(preview);
  if (aspect) link.aspectSize = aspect;
  return link;
}

function makePollAttachment(post) {
  if (typeof PollAttachment === "undefined" || typeof PollAttachment.create !== "function") return null;
  if (typeof PollOption === "undefined" || typeof PollOption.create !== "function") return null;
  const poll = firstValue(post, ["poll"]) || firstValue(appInfo(post), ["poll_attachment", "pollAttachment", "poll"]);
  const options = poll && (poll.options || poll.tallies || poll.choices);
  if (!Array.isArray(options) || !options.length) return null;
  const attachment = PollAttachment.create();
  attachment.options = options.map(option => {
    const title = stringValue(firstValue(option, ["text", "title", "label", "option"]) || "Option");
    const votes = Number(firstValue(option, ["count", "votes", "vote_count"]) || 0);
    return PollOption.create(title, votes);
  });
  return attachment;
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
  return !!nestedPost(post, ["repostedPost", "reposted_post", "repost"]) || !!post.isRepost || !!post.is_repost;
}

function isQuote(post) {
  return !!nestedPost(post, ["quotedPost", "quoted_post", "quoted_post_media"]) || !!post.isQuotePost || !!post.is_quote_post;
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
  const poll = makePollAttachment(post);
  if (poll) attachments.push(poll);
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

function mediaIdForPost(post) {
  return stringValue(firstValue(post, ["pk", "id", "media_id", "mediaId", "fbid"]));
}

function booleanFlag(post, names) {
  for (const name of names) {
    if (post && post[name] === true) return true;
    if (post && post[name] === false) return false;
  }
  return false;
}

function actionPayload(post, uri) {
  return JSON.stringify({ id: mediaIdForPost(post), uri: uri || "" });
}

function actionsForPost(post, uri, bodyHtml) {
  const actions = {};
  const id = mediaIdForPost(post);
  const payload = actionPayload(post, uri);
  if (id) {
    actions[booleanFlag(post, ["has_liked", "hasLiked", "viewer_has_liked"]) ? "unlike" : "like"] = payload;
    actions[booleanFlag(post, ["has_viewer_saved", "saved", "viewer_has_saved"]) ? "unsave" : "save"] = payload;
    actions[booleanFlag(post, ["has_viewer_reposted", "viewer_has_reposted", "is_reposted"]) ? "unrepost" : "repost"] = payload;
    actions.thread = payload;
  }
  if (uri) actions.openLink = payload;
  actions._connectorBuild = connectorStamp();
  actions._bodyAnchorCount = stringValue(bodyHtml).split("<a ").length - 1;
  return actions;
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

  const body = postBody(sourcePost);
  if (body) item.body = body;

  if (post.isSpoilerMedia || post.is_spoiler_media || post.contentWarning || post.content_warning) {
    item.contentWarning = post.contentWarning || post.content_warning || "Spoiler";
  }

  // Loom renders native annotations above Service/Author — only arrival context.
  const annotations = [];
  if (originalRepost) {
    const reposter = userForPost(post);
    const handle = usernameForUser(reposter);
    const text = handle ? `Reposted by @${handle}` : `Reposted by ${nameForUser(reposter)}`;
    const annotation = createAnnotation(text, uriForUser(reposter), avatarForUser(reposter));
    if (annotation) annotations.push(annotation);
  }
  if (isReply(post)) {
    const parent = nestedPost(post, ["replyTo", "reply_to", "parent", "reply_to_post"]);
    const parentUser = parent ? userForPost(parent) : {};
    const handle = usernameForUser(parentUser);
    const text = handle ? `Reply to @${handle}` : "Reply";
    const annotation = createAnnotation(text, uriForUser(parentUser), avatarForUser(parentUser));
    if (annotation) annotations.push(annotation);
  }
  if (annotations.length) item.annotations = annotations;

  const attachments = mediaAttachments(sourcePost);
  const quote = nestedPost(sourcePost, ["quotedPost", "quoted_post", "quoted_post_media"]);
  if (quote) {
    const quotedItem = postToItem(quote, depth + 1);
    if (quotedItem) attachments.push(quotedItem);
  }
  if (attachments.length) item.attachments = attachments;

  // Assign author last — matches X / Bluesky and Loom identity quirks.
  item.author = identityForUser(sourceUser);
  if (depth === 0) item.actions = actionsForPost(sourcePost, uri, body);
  return item;
}

function parseActionValue(actionValue) {
  if (actionValue && typeof actionValue === "object") return actionValue;
  const raw = stringValue(actionValue).trim();
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (_) {
    return looksLikeHttpUrl(raw) ? { uri: raw } : { id: raw };
  }
}

function actionPaths(actionId, mediaId) {
  const id = encodeURIComponent(mediaId);
  const map = {
    like: [`/api/v1/web/likes/${id}/like/`, `/api/v1/media/${id}/like/`],
    unlike: [`/api/v1/web/likes/${id}/unlike/`, `/api/v1/media/${id}/unlike/`],
    save: [`/api/v1/web/save/${id}/save/`, `/api/v1/media/${id}/save/`],
    unsave: [`/api/v1/web/save/${id}/unsave/`, `/api/v1/media/${id}/unsave/`],
    repost: [`/api/v1/web/media/${id}/repost/`, `/api/v1/media/${id}/repost/`],
    unrepost: [`/api/v1/web/media/${id}/unrepost/`, `/api/v1/media/${id}/unrepost/`]
  };
  return map[actionId] || [];
}

function performMediaAction(auth, actionId, mediaId) {
  const paths = actionPaths(actionId, mediaId);
  if (!paths.length) return Promise.reject(new Error(`Unsupported Threads action: ${actionId}`));
  const params = `_csrftoken=${encodeURIComponent(auth.csrftoken)}`;
  function tryAt(index) {
    if (index >= paths.length) {
      return Promise.reject(new Error(`Threads could not ${actionId}. Cookie session may be read-only for writes.`));
    }
    return restPost(auth, paths[index], params).catch(error => {
      if (error && /HTTP 404/.test(stringValue(error.message))) return tryAt(index + 1);
      throw error;
    });
  }
  return tryAt(0);
}

function toggleRemoteAction(item, actionId) {
  if (!item) return item;
  const replacements = {
    like: "unlike",
    unlike: "like",
    save: "unsave",
    unsave: "save",
    repost: "unrepost",
    unrepost: "repost"
  };
  const replacement = replacements[actionId];
  if (!replacement) return item;
  const actions = Object.assign({}, item.actions || {});
  const payload = actions[actionId] || actions[replacement] || actionPayload({ pk: mediaIdFromActions(actions) }, item.uri);
  delete actions[actionId];
  actions[replacement] = payload;
  actions._connectorBuild = connectorStamp();
  item.actions = actions;
  if (actionId === "like" || actionId === "unlike" || actionId === "repost" || actionId === "unrepost") {
    item.body = adjustEngagementBodyMetrics(item.body, actionId);
  }
  return item;
}

function mediaIdFromActions(actions) {
  for (const key of ["like", "unlike", "save", "unsave", "repost", "unrepost", "thread"]) {
    const value = parseActionValue(actions && actions[key]);
    if (value.id) return value.id;
  }
  return "";
}

function loadThreadItems(auth, mediaId, item) {
  const paths = [
    `/api/v1/text_feed/${encodeURIComponent(mediaId)}/replies/`,
    `/api/v1/media/${encodeURIComponent(mediaId)}/comments/`
  ];
  function tryAt(index) {
    if (index >= paths.length) return Promise.resolve(item ? [item] : []);
    return restGet(auth, paths[index], "count=20").then(page => {
      const replies = flattenPage(page).map(post => postToItem(post, 0)).filter(Boolean);
      if (!item) return replies;
      return [item].concat(replies.filter(reply => reply.uri !== item.uri));
    }).catch(() => tryAt(index + 1));
  }
  return tryAt(0);
}

function performAction(actionId, actionValue, item) {
  performActionAsync(actionId, actionValue, item)
    .then(result => {
      if (typeof actionComplete === "function") actionComplete(result, null);
    })
    .catch(error => {
      if (error && error.authorization && typeof raiseCondition === "function") {
        raiseCondition("authorize", "Threads web session expired", "Sign in again, paste fresh sessionid and csrftoken, and update the connector.");
      }
      if (typeof actionComplete === "function") actionComplete(null, error);
      else if (typeof processError === "function") processError(error);
    });
}

function performActionAsync(actionId, actionValue, item) {
  if (actionId === "openLink") return Promise.resolve(item);
  let auth;
  try { auth = credentials(); } catch (error) { return Promise.reject(error); }
  const value = parseActionValue(actionValue);
  const mediaId = stringValue(value.id || value.mediaId || value.pk);
  if (actionId === "thread") {
    if (!mediaId) return Promise.reject(new Error("Could not determine the Threads post ID for this thread."));
    return loadThreadItems(auth, mediaId, item);
  }
  if (["like", "unlike", "save", "unsave", "repost", "unrepost"].indexOf(actionId) < 0) {
    return Promise.reject(new Error(`Unsupported Threads action: ${actionId}`));
  }
  if (!mediaId) return Promise.reject(new Error(`Could not determine the Threads media ID for ${actionId}.`));
  return performMediaAction(auth, actionId, mediaId).then(() => toggleRemoteAction(item, actionId));
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
    const children = firstValue(value, ["thread_items", "threadItems", "items", "threads"]);
    if (Array.isArray(children) && children.length) {
      for (const child of children) {
        if (child && child.post && typeof child.post === "object") posts.push(child.post);
        else visit(child);
      }
      return;
    }
    if (value.post && typeof value.post === "object" && looksLikePost(value.post)) {
      posts.push(value.post);
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
    feedKind(),
    stringValue(typeof query_doc_id === "undefined" ? "" : query_doc_id),
    stringValue(typeof include_reposts === "undefined" ? "on" : include_reposts),
    stringValue(typeof include_quotes === "undefined" ? "on" : include_quotes),
    stringValue(typeof include_replies === "undefined" ? "off" : include_replies),
    stringValue(typeof show_metrics === "undefined" ? "on" : show_metrics),
    stringValue(typeof following_account_cap === "undefined" ? String(DEFAULT_FOLLOWING_CAP) : following_account_cap)
  ].join("|");
}

function shouldInclude(post) {
  if (isRepost(post) && include_reposts !== "on") return false;
  if (isQuote(post) && include_quotes === "off") return false;
  if (isReply(post) && include_replies !== "on") return false;
  return true;
}

function currentUser(auth) {
  return restGet(auth, "/api/v1/accounts/current_user/", "edit=true").then(body => {
    const user = firstValue(body, ["user", "current_user"]) || body.user || body;
    if (!userId(user) && !usernameForUser(user)) throw new Error("Threads did not return the signed-in account. Refresh sessionid and csrftoken.");
    return user;
  });
}

function followingUsers(auth, selfId) {
  const cap = followingAccountCap();
  return restGet(auth, `/api/v1/friendships/${encodeURIComponent(selfId)}/following/`, `count=${cap}`).then(body => {
    const users = Array.isArray(body.users) ? body.users : [];
    return users.slice(0, cap);
  });
}

function userThreads(auth, id) {
  return restGet(auth, `/api/v1/text_feed/${encodeURIComponent(id)}/profile/`, `count=${POSTS_PER_FOLLOWING}`);
}

function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  function run() {
    if (nextIndex >= items.length) return Promise.resolve();
    const index = nextIndex;
    nextIndex += 1;
    return Promise.resolve()
      .then(() => worker(items[index], index))
      .then(value => { results[index] = value; })
      .catch(() => { results[index] = null; })
      .then(run);
  }
  const runners = [];
  const count = Math.min(concurrency, Math.max(items.length, 1));
  for (let i = 0; i < count; i += 1) runners.push(run());
  return Promise.all(runners).then(() => results.filter(Boolean));
}

function collectFollowingPages(auth) {
  return currentUser(auth).then(self => {
    const selfId = userId(self);
    return followingUsers(auth, selfId).then(users => {
      const targets = [{ id: selfId }].concat(users.map(user => ({ id: userId(user) })));
      const unique = [];
      const seen = {};
      for (const target of targets) {
        if (!target.id || seen[target.id]) continue;
        seen[target.id] = true;
        unique.push(target);
      }
      // ponytail: capped parallel Following merge; raise following_account_cap if Loom timeout budget grows
      return mapPool(unique, FOLLOWING_CONCURRENCY, target => userThreads(auth, target.id));
    });
  });
}

function collectGraphqlPages(auth, limit) {
  const pages = [];
  function next(cursor, remaining) {
    if (remaining <= 0) return Promise.resolve(pages);
    return requestGraphqlPage(auth, cursor).then(page => {
      pages.push(page);
      const cursorValue = nextCursor(page);
      return !cursorValue || cursorValue === cursor ? pages : next(cursorValue, remaining - 1);
    });
  }
  return next(null, limit);
}

function collectPages(auth, limit) {
  return feedKind() === "for_you" ? collectGraphqlPages(auth, limit) : collectFollowingPages(auth);
}

function handleError(error) {
  if (error.authorization && typeof raiseCondition === "function") {
    raiseCondition("authorize", "Threads web session expired", "Sign in again, paste fresh sessionid and csrftoken, and update the connector.");
  } else {
    processError(error);
  }
}

function verify() {
  logBuild("verify");
  let auth;
  try { auth = credentials(); } catch (error) { processError(error); return; }
  currentUser(auth).then(user => {
    // Loom chrome: Service · Feed Type (author @handle lives on item.author, not here).
    const verification = {
      displayName: `Threads · ${sourceLabel()}`,
      accountIdentity: identityForUser(user)
    };
    processVerification(verification);
  }).catch(handleError);
}

function load() {
  logBuild("load");
  avatarDataUrlCache = {};
  let auth;
  try { auth = credentials(); } catch (error) { processError(error); return; }
  const state = readState();
  const feedSignature = signature();
  const modeState = readModeState();
  if (state.signature === feedSignature && state.loadedAt && Date.now() - state.loadedAt < refreshMinutes() * 60000) {
    processResults([], true);
    return;
  }
  const knownIds = {};
  for (const id of modeState.ids || []) knownIds[id] = true;
  const pageLimit = feedKind() === "for_you" ? (modeState.lastSeenAt ? 1 : MAX_BACKFILL_PAGES) : 1;
  collectPages(auth, pageLimit).then(pages => {
    const items = [];
    const seen = {};
    const ids = [];
    let newest = Number(modeState.lastSeenAt || 0);
    for (const page of pages) {
      for (const post of flattenPage(page)) {
        if (!shouldInclude(post)) continue;
        const date = normalizeDate(post);
        const item = postToItem(post, 0);
        if (!date || !item || seen[item.uri]) continue;
        if (knownIds[item.uri]) continue;
        if (modeState.lastSeenAt && date.getTime() <= Number(modeState.lastSeenAt)) continue;
        seen[item.uri] = true;
        ids.push(item.uri);
        newest = Math.max(newest, date.getTime());
        items.push(item);
      }
    }
    items.sort((left, right) => right.date.getTime() - left.date.getTime());
    const retained = ids.concat((modeState.ids || []).filter(id => !seen[id])).slice(0, MAX_STORED_IDS);
    return embedItemAvatars(items).then(() => {
      writeModeState(feedSignature, { lastSeenAt: newest, ids: retained });
      processResults(items, true);
    });
  }).catch(handleError);
}
