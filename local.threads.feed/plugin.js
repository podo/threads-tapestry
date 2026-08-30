const PROFILE_CACHE_KEY = "threadsProfilesV1";
const LOAD_STATE_KEY = "threadsLoadStateV1";
const MAX_ACCOUNTS = 20;
const REQUEST_BATCH_SIZE = 4;

function parseAccounts(value) {
  const source = String(value || "");
  const tokens = source.split(/[\s,;]+/);
  const results = [];
  const seen = {};

  for (const tokenValue of tokens) {
    let token = tokenValue.trim();
    if (!token) continue;

    const urlMatch = token.match(/threads\.(?:com|net)\/@?([A-Za-z0-9._]+)/i);
    if (urlMatch) token = urlMatch[1];
    token = token.replace(/^@+/, "").split(/[/?#]/)[0].trim().toLowerCase();

    if (!/^[a-z0-9._]+$/.test(token) || seen[token]) continue;
    seen[token] = true;
    results.push(token);
  }

  return results;
}

function requireAccounts() {
  const parsed = parseAccounts(typeof accounts === "undefined" ? "" : accounts);
  if (parsed.length === 0) {
    throw new Error("Enter at least one Threads username.");
  }
  if (parsed.length > MAX_ACCOUNTS) {
    throw new Error(`Enter no more than ${MAX_ACCOUNTS} Threads usernames.`);
  }
  return parsed;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseResponse(text, account) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (_) {
    throw new Error(`Threads returned an unreadable response for @${account}.`);
  }

  if (envelope && typeof envelope.status === "number" && Object.prototype.hasOwnProperty.call(envelope, "body")) {
    let body = {};
    try {
      body = envelope.body ? JSON.parse(envelope.body) : {};
    } catch (_) {
      body = {};
    }
    if (envelope.status < 200 || envelope.status >= 300) {
      const detail = body.error && body.error.message
        ? body.error.message
        : body.error_message || `HTTP ${envelope.status}`;
      throw new Error(`@${account}: ${detail}`);
    }
    return body;
  }

  if (envelope && envelope.error) {
    throw new Error(`@${account}: ${envelope.error.message || "Threads API error"}`);
  }
  return envelope;
}

function requestJson(url, account) {
  return sendRequest(url, "GET", null, null, true)
    .then(text => parseResponse(text, account));
}

function runInBatches(values, batchSize, mapper) {
  const output = [];
  let offset = 0;

  function next() {
    if (offset >= values.length) return Promise.resolve(output);
    const batch = values.slice(offset, offset + batchSize);
    offset += batchSize;
    return Promise.all(batch.map(mapper)).then(results => {
      output.push.apply(output, results);
      return next();
    });
  }

  return next();
}

function profileLookup(username) {
  const fields = [
    "username",
    "name",
    "profile_picture_url",
    "biography",
    "follower_count",
    "is_verified"
  ].join(",");
  const url = `${site}/v1.0/profile_lookup?username=${encodeURIComponent(username)}&fields=${encodeURIComponent(fields)}`;
  return requestJson(url, username).then(profile => ({ username, profile }));
}

function profilePosts(username, limit) {
  const fields = [
    "id",
    "media_type",
    "media_url",
    "permalink",
    "username",
    "text",
    "timestamp",
    "shortcode",
    "thumbnail_url",
    "children{id,media_type,media_url,thumbnail_url,alt_text}",
    "is_quote_post",
    "quoted_post",
    "reposted_post",
    "alt_text",
    "link_attachment_url",
    "gif_url",
    "poll_attachment",
    "topic_tag",
    "is_spoiler_media",
    "text_entities",
    "is_verified",
    "profile_picture_url"
  ].join(",");
  const url = `${site}/v1.0/profile_posts?username=${encodeURIComponent(username)}&limit=${limit}&fields=${encodeURIComponent(fields)}`;
  return requestJson(url, username).then(json => ({ username, posts: json.data || [] }));
}

function readProfileCache() {
  if (typeof getItem !== "function") return {};
  try {
    return JSON.parse(getItem(PROFILE_CACHE_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

function writeProfileCache(profiles) {
  if (typeof setItem === "function") {
    setItem(PROFILE_CACHE_KEY, JSON.stringify(profiles));
  }
}

function verify() {
  let usernames;
  try {
    usernames = requireAccounts();
  } catch (error) {
    processError(error);
    return;
  }

  runInBatches(usernames, REQUEST_BATCH_SIZE, username =>
    profileLookup(username).catch(error => ({ username, error }))
  ).then(results => {
    const failures = results.filter(result => result.error);
    if (failures.length) {
      throw new Error(`Could not verify ${failures.map(item => `@${item.username}`).join(", ")}. ${failures[0].error.message}`);
    }

    const profiles = {};
    for (const result of results) profiles[result.username] = result.profile;
    writeProfileCache(profiles);

    const first = results[0].profile || {};
    const displayName = results.length === 1
      ? `Threads · @${results[0].username}`
      : `Threads · ${results.length} accounts`;
    const verification = { displayName };
    if (first.profile_picture_url) verification.icon = first.profile_picture_url;
    processVerification(verification);
  }).catch(processError);
}

function itemBody(post) {
  const parts = [];
  if (post.text) parts.push(`<p>${escapeHtml(post.text).replace(/\n/g, "<br>")}</p>`);
  if (post.topic_tag) parts.push(`<p>Topic: ${escapeHtml(post.topic_tag)}</p>`);
  return parts.join("");
}

function makeMediaAttachment(media) {
  const url = media.media_url || media.gif_url;
  if (!url || typeof MediaAttachment === "undefined") return null;
  const attachment = MediaAttachment.createWithUrl(url);
  const type = String(media.media_type || "").toUpperCase();
  if (media.gif_url) attachment.mimeType = "image/gif";
  else if (type === "VIDEO") attachment.mimeType = "video";
  else if (type === "AUDIO") attachment.mimeType = "audio";
  else attachment.mimeType = "image";
  if (media.thumbnail_url) attachment.thumbnail = media.thumbnail_url;
  if (media.alt_text) attachment.text = media.alt_text;
  return attachment;
}

function attachmentsForPost(post) {
  const attachments = [];
  const children = post.children && Array.isArray(post.children.data) ? post.children.data : [];
  if (children.length) {
    for (const child of children) {
      const attachment = makeMediaAttachment(child);
      if (attachment) attachments.push(attachment);
    }
  } else {
    const attachment = makeMediaAttachment(post);
    if (attachment) attachments.push(attachment);
  }

  if (post.gif_url && !post.media_url) {
    const gif = makeMediaAttachment({ gif_url: post.gif_url, alt_text: post.alt_text });
    if (gif) attachments.push(gif);
  }

  if (!attachments.length && post.link_attachment_url && typeof LinkAttachment !== "undefined") {
    attachments.push(LinkAttachment.createWithUrl(post.link_attachment_url));
  }
  return attachments;
}

function annotation(text, uri) {
  if (typeof Annotation === "undefined") return null;
  const result = Annotation.createWithText(text);
  if (uri) result.uri = uri;
  return result;
}

function postToItem(post, profiles) {
  if (!post.permalink || !post.timestamp) return null;
  const item = Item.createWithUriDate(post.permalink, new Date(post.timestamp));
  const body = itemBody(post);
  if (body) item.body = body;

  const username = String(post.username || "").toLowerCase();
  const profile = profiles[username] || {};
  const name = profile.name || post.username || "Threads user";
  const identity = Identity.createWithName(name);
  identity.username = `@${post.username || username}`;
  identity.uri = `https://www.threads.com/@${encodeURIComponent(post.username || username)}`;
  const avatar = post.profile_picture_url || profile.profile_picture_url;
  if (avatar) identity.avatar = avatar;
  item.author = identity;

  const attachments = attachmentsForPost(post);
  if (attachments.length) item.attachments = attachments;

  const annotations = [];
  if (String(post.media_type || "").toUpperCase() === "REPOST_FACADE" || post.reposted_post) {
    const value = annotation("Reposted on Threads", identity.uri);
    if (value) annotations.push(value);
  }
  if (post.is_quote_post) {
    const value = annotation("Quoted a Threads post", post.permalink);
    if (value) annotations.push(value);
  }
  if (annotations.length) item.annotations = annotations;

  if (post.is_spoiler_media || (Array.isArray(post.text_entities) && post.text_entities.length)) {
    item.contentWarning = "Spoiler";
  }
  return item;
}

function loadSignature(usernames) {
  return [
    usernames.join(","),
    String(typeof posts_per_account === "undefined" ? "25" : posts_per_account),
    String(typeof include_reposts === "undefined" ? "off" : include_reposts),
    String(typeof include_quotes === "undefined" ? "on" : include_quotes)
  ].join("|");
}

function shouldThrottle(signature) {
  if (typeof getItem !== "function") return false;
  try {
    const state = JSON.parse(getItem(LOAD_STATE_KEY) || "null");
    const minutes = Math.max(30, parseInt(typeof refresh_interval === "undefined" ? "30" : refresh_interval, 10) || 30);
    return state && state.signature === signature && Date.now() - state.loadedAt < minutes * 60000;
  } catch (_) {
    return false;
  }
}

function rememberLoad(signature) {
  if (typeof setItem === "function") {
    setItem(LOAD_STATE_KEY, JSON.stringify({ signature, loadedAt: Date.now() }));
  }
}

function load() {
  let usernames;
  try {
    usernames = requireAccounts();
  } catch (error) {
    processError(error);
    return;
  }

  const signature = loadSignature(usernames);
  if (shouldThrottle(signature)) {
    processResults(null);
    return;
  }

  const parsedLimit = parseInt(typeof posts_per_account === "undefined" ? "25" : posts_per_account, 10);
  const limit = [10, 25, 50].indexOf(parsedLimit) >= 0 ? parsedLimit : 25;

  runInBatches(usernames, REQUEST_BATCH_SIZE, username =>
    profilePosts(username, limit).catch(error => ({ username, error }))
  ).then(results => {
    const successes = results.filter(result => !result.error);
    if (!successes.length) {
      const firstError = results[0] && results[0].error;
      throw firstError || new Error("Threads returned no account feeds.");
    }

    const failures = results.filter(result => result.error);
    if (failures.length && typeof console !== "undefined") {
      console.warn(`Threads accounts skipped: ${failures.map(value => `@${value.username}`).join(", ")}`);
    }

    const profiles = readProfileCache();
    const items = [];
    const seen = {};
    for (const result of successes) {
      for (const post of result.posts) {
        const mediaType = String(post.media_type || "").toUpperCase();
        if ((mediaType === "REPOST_FACADE" || post.reposted_post) && include_reposts !== "on") continue;
        if (post.is_quote_post && include_quotes === "off") continue;
        const item = postToItem(post, profiles);
        if (!item || seen[item.uri]) continue;
        seen[item.uri] = true;
        items.push(item);
      }
    }

    items.sort((left, right) => right.date.getTime() - left.date.getTime());
    rememberLoad(signature);
    processResults(items);
  }).catch(processError);
}
