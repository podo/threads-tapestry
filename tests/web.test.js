const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "local.threads.web", "plugin.js"), "utf8");
const uiConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "local.threads.web", "ui-config.json"), "utf8"));
const pluginConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "local.threads.web", "plugin-config.json"), "utf8"));

function fullResponse(body, status = 200) {
  return JSON.stringify({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function user(username, fullName, pk) {
  return {
    pk: pk || username,
    username,
    full_name: fullName,
    profile_pic_url: `https://cdn.example/${username}.jpg`
  };
}

function postsFixture() {
  const alice = user("alice", "Alice Example", "1");
  return [
    {
      pk: "text-1", code: "text-1", taken_at: 1788087600, user: alice,
      caption: { text: "Hello @bob and #threads see https://example.com/read." }
    },
    {
      pk: "image-1", code: "image-1", taken_at: 1788087540, user: user("bob", "Bob Example", "2"),
      caption: { text: "An image" }, accessibility_caption: "A misty mountain",
      image_versions2: { candidates: [
        { url: "https://cdn.example/image-small.jpg", width: 320, height: 180 },
        { url: "https://cdn.example/image-large.jpg", width: 1600, height: 900 }
      ] }
    },
    {
      pk: "video-1", code: "video-1", taken_at: 1788087480, user: user("carol", "Carol Example", "3"),
      caption: { text: "A video" }, media_type: 2, width: 1080, height: 1920,
      video_versions: [{ url: "https://cdn.example/video.mp4", width: 1080, height: 1920 }],
      image_versions2: { candidates: [{ url: "https://cdn.example/video-cover.jpg", width: 1080, height: 1920 }] }
    },
    {
      pk: "carousel-1", code: "carousel-1", taken_at: 1788087420, user: user("dana", "Dana Example", "4"),
      caption: { text: "A carousel" }, carousel_media: [
        { image_versions2: { candidates: [{ url: "https://cdn.example/c1.jpg", width: 1000, height: 1000 }] } },
        { media_type: 2, video_versions: [{ url: "https://cdn.example/c2.mp4", width: 1920, height: 1080 }], image_versions2: { candidates: [{ url: "https://cdn.example/c2-cover.jpg", width: 1920, height: 1080 }] } }
      ]
    },
    {
      pk: "link-1", code: "link-1", taken_at: 1788087360, user: user("erin", "Erin Example", "5"),
      caption: { text: "Worth reading" }, text_post_app_info: {
        link_preview_attachment: {
          url: "https://news.example/story", title: "The rendered story", description: "A useful description",
          display_url: "news.example", image: { url: "https://cdn.example/link-card.jpg" }, width: 1200, height: 630
        }
      }
    },
    {
      pk: "quote-1", code: "quote-1", taken_at: 1788087300, user: user("frank", "Frank Example", "6"),
      caption: { text: "Adding context" }, text_post_app_info: { share_info: { quoted_post: {
        pk: "quoted-original", code: "quoted-original", taken_at: 1788080000, user: user("grace", "Grace Example", "7"),
        caption: { text: "The original quoted post" },
        image_versions2: { candidates: [{ url: "https://cdn.example/quote.jpg", width: 800, height: 600 }] }
      } } }
    },
    {
      pk: "repost-1", code: "repost-1", taken_at: 1788087240, user: user("henry", "Henry Reposter", "8"),
      text_post_app_info: { share_info: { reposted_post: {
        pk: "repost-original", code: "repost-original", taken_at: 1788087000, user: user("ivy", "Ivy Original", "9"),
        caption: { text: "Original repost content" }
      } } }
    },
    {
      pk: "reply-1", code: "reply-1", taken_at: 1788087180, user: user("jules", "Jules Example", "10"),
      caption: { text: "A reply" }, reply_to: {
        pk: "parent-1", code: "parent-1", taken_at: 1788080000, user: alice, caption: { text: "Parent" }
      }
    },
    {
      pk: "spoiler-1", code: "spoiler-1", taken_at: 1788087100, user: alice,
      caption: { text: "Secret" }, is_spoiler_media: true
    }
  ];
}

function graphqlFixture() {
  return {
    data: {
      xdt_api__v1__text_feed__timeline: {
        edges: postsFixture().map(post => ({ node: { thread_items: [{ post }] } })),
        page_info: { has_next_page: true, end_cursor: "cursor-2" }
      }
    }
  };
}

function restRouter(url) {
  if (url.indexOf("/api/v1/accounts/current_user/") >= 0) {
    return fullResponse({ user: user("alice", "Alice Example", "1") });
  }
  if (url.indexOf("/friendships/1/following/") >= 0) {
    return fullResponse({ users: [user("bob", "Bob Example", "2"), user("carol", "Carol Example", "3")] });
  }
  if (url.indexOf("/text_feed/") >= 0 && url.indexOf("/profile/") >= 0) {
    const id = (url.match(/text_feed\/([^/]+)\//) || [])[1];
    const owned = postsFixture().filter(post => String(post.user.pk) === id || (post.text_post_app_info && post.text_post_app_info.share_info));
    const posts = id === "1" ? postsFixture() : owned.length ? owned : postsFixture().filter(post => String(post.user.pk) === id);
    return fullResponse({
      threads: posts.map(post => ({ thread_items: [{ post }] })),
      next_max_id: null
    });
  }
  throw new Error(`Unexpected URL ${url}`);
}

function makeContext(overrides = {}) {
  const state = new Map();
  const context = {
    console, Date, Promise,
    site: "https://www.threads.com",
    cookie_header: undefined,
    sessionid: "1%3Aabc",
    csrftoken: "fixture-csrf",
    ds_user_id: "1",
    mid: "fixture-mid",
    ig_did: "fixture-device",
    feed_kind: "following",
    query_doc_id: "",
    include_reposts: "on",
    include_quotes: "on",
    include_replies: "off",
    refresh_interval: "30",
    sendRequest: async (url, method, params, headers, fullResponseRequested) => {
      context.requests.push({ url, method, params, headers, fullResponseRequested });
      if (url.indexOf("/api/graphql") >= 0) return fullResponse(graphqlFixture());
      return restRouter(url);
    },
    processVerification: value => { context.verification = value; },
    processResults: (value, complete) => { context.results = value; context.complete = complete; },
    processError: error => { context.error = error; },
    raiseCondition: (kind, title, description) => { context.condition = { kind, title, description }; },
    getItem: key => state.get(key) || null,
    setItem: (key, value) => state.set(key, value),
    Item: { createWithUriDate: (uri, date) => ({ uri, date }) },
    Identity: {
      create: (name, username, avatar, uri) => ({ name, username, avatar, uri }),
      createWithName: name => ({ name })
    },
    Annotation: { createWithText: text => ({ text }) },
    MediaAttachment: { createWithUrl: url => ({ url }) },
    LinkAttachment: { createWithUrl: url => ({ url }) },
    PollAttachment: { create: () => ({ options: [] }) },
    PollOption: { create: (title, votes) => ({ title, votes }) },
    requests: [],
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setImmediate(resolve));
}

async function run() {
  assert.strictEqual(pluginConfig.display_name, "Threads");
  assert.strictEqual(pluginConfig.provides_attachments, true);
  assert.ok(uiConfig.inputs.some(input => input.name === "sessionid"));
  assert.ok(uiConfig.inputs.some(input => input.name === "csrftoken"));
  assert.ok(uiConfig.inputs.some(input => input.name === "ds_user_id"));
  assert.ok(!uiConfig.inputs.some(input => input.name === "cookie_header"));
  assert.ok(uiConfig.inputs.some(input => input.name === "query_doc_id" && !input.value));
  assert.ok(!uiConfig.inputs.some(input => input.name === "query_variables"));

  const context = makeContext();
  vm.runInContext("verify()", context);
  await settle();
  assert.ifError(context.error);
  assert.strictEqual(context.verification.displayName, "Threads · @alice");
  assert.strictEqual(context.verification.icon, undefined);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(context.verification.accountIdentity)),
    { name: "Alice Example", username: "@alice", avatar: "https://cdn.example/alice.jpg", uri: "https://www.threads.com/@alice" }
  );
  assert.ok(context.requests.some(request => request.url.indexOf("/api/v1/accounts/current_user/") >= 0));
  assert.ok(!context.requests.some(request => request.url.indexOf("/api/graphql") >= 0));

  vm.runInContext("load()", context);
  await settle();
  assert.ifError(context.error);
  assert.strictEqual(context.complete, true);
  assert.ok(context.results.length >= 7, "following merge returns media variants");
  assert.ok(context.requests.every(request => request.url.indexOf("/api/graphql") < 0), "Following must not require GraphQL");
  assert.match(context.requests[0].headers.Cookie, /sessionid=1%3Aabc/);
  assert.match(context.requests[0].headers.Cookie, /csrftoken=fixture-csrf/);
  assert.match(context.requests[0].headers.Cookie, /mid=fixture-mid/);
  assert.strictEqual(context.requests[0].headers["User-Agent"], "Barcelona 289.0.0.14.109 Android");

  const byUri = suffix => context.results.find(item => item.uri && item.uri.endsWith(`/post/${suffix}`));
  const text = byUri("text-1");
  assert.strictEqual(text.author.name, "Alice Example");
  assert.strictEqual(text.author.username, "@alice");
  assert.match(text.body, /@bob/);
  assert.match(text.body, /#threads/);
  assert.match(text.body, /https:\/\/example.com\/read/);

  const image = byUri("image-1").attachments[0];
  assert.strictEqual(image.url, "https://cdn.example/image-large.jpg");
  assert.strictEqual(image.mimeType, "image");
  assert.strictEqual(image.text, "A misty mountain");

  const video = byUri("video-1").attachments[0];
  assert.strictEqual(video.mimeType, "video/mp4");
  assert.strictEqual(video.thumbnail, "https://cdn.example/video-cover.jpg");

  const carousel = byUri("carousel-1").attachments;
  assert.strictEqual(carousel[0].url, "https://cdn.example/c1.jpg");
  assert.strictEqual(carousel[1].url, "https://cdn.example/c2.mp4");

  const link = byUri("link-1").attachments[0];
  assert.strictEqual(link.title, "The rendered story");
  assert.strictEqual(link.image, "https://cdn.example/link-card.jpg");

  const quote = byUri("quote-1");
  assert.ok(quote.attachments.some(item => item.author && item.author.name === "Grace Example"));

  const repost = byUri("repost-1");
  assert.strictEqual(repost.author.name, "Ivy Original");
  assert.strictEqual(repost.annotations[0].text, "Reposted by Henry Reposter");

  const spoiler = byUri("spoiler-1");
  assert.strictEqual(spoiler.contentWarning, "Spoiler");

  const emptyDoc = makeContext({ query_doc_id: "" });
  vm.runInContext("load()", emptyDoc);
  await settle();
  assert.ifError(emptyDoc.error);

  const forYouMissing = makeContext({ feed_kind: "for_you", query_doc_id: "" });
  vm.runInContext("load()", forYouMissing);
  await settle();
  assert.match(forYouMissing.error.message, /doc_id/i);

  const forYou = makeContext({
    feed_kind: "for_you",
    query_doc_id: "99999999999999999",
    sendRequest: async (url, method, params, headers, fullResponseRequested) => {
      forYou.requests.push({ url, method, params, headers, fullResponseRequested });
      if (url.indexOf("/api/graphql") >= 0) return fullResponse(graphqlFixture());
      return restRouter(url);
    },
    requests: []
  });
  vm.runInContext("verify()", forYou);
  await settle();
  assert.ifError(forYou.error);
  vm.runInContext("load()", forYou);
  await settle();
  assert.ifError(forYou.error);
  assert.ok(forYou.requests.some(request => request.url.indexOf("/api/graphql") >= 0));
  assert.match(forYou.requests.find(request => request.url.indexOf("/api/graphql") >= 0).params, /doc_id=99999999999999999/);
  assert.match(decodeURIComponent(forYou.requests.find(request => request.url.indexOf("/api/graphql") >= 0).params), /"after":null/);

  const replies = makeContext({ include_replies: "on" });
  vm.runInContext("load()", replies);
  await settle();
  assert.ifError(replies.error);
  assert.ok(replies.results.some(item => item.uri && item.uri.endsWith("/post/reply-1")));

  const unauthorized = makeContext({
    sendRequest: async () => fullResponse({ message: "login required" }, 401)
  });
  vm.runInContext("verify()", unauthorized);
  await settle();
  assert.strictEqual(unauthorized.condition.kind, "authorize");

  const missingCookie = makeContext({ sessionid: "", csrftoken: "only" });
  vm.runInContext("verify()", missingCookie);
  await settle();
  assert.match(missingCookie.error.message, /sessionid and csrftoken/i);

  const derivedUser = makeContext({ sessionid: "42%3Atoken", csrftoken: "csrf", ds_user_id: "" });
  vm.runInContext("verify()", derivedUser);
  await settle();
  assert.ifError(derivedUser.error);
  assert.match(derivedUser.requests[0].headers.Cookie, /ds_user_id=42/);

  console.log("All Threads Web rendering tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
