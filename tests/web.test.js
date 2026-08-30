const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "local.threads.web", "plugin.js"), "utf8");

function fullResponse(body, status = 200) {
  return JSON.stringify({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function user(username, fullName) {
  return {
    username,
    full_name: fullName,
    profile_pic_url: `https://cdn.example/${username}.jpg`
  };
}

function fixture() {
  const alice = user("alice", "Alice Example");
  const posts = [
    {
      pk: "text-1", code: "text-1", taken_at: 1788087600, user: alice,
      caption: { text: "A plain post with https://example.com/read." }
    },
    {
      pk: "image-1", code: "image-1", taken_at: 1788087540, user: user("bob", "Bob Example"),
      caption: { text: "An image" }, accessibility_caption: "A misty mountain",
      image_versions2: { candidates: [
        { url: "https://cdn.example/image-small.jpg", width: 320, height: 180 },
        { url: "https://cdn.example/image-large.jpg", width: 1600, height: 900 }
      ] }
    },
    {
      pk: "video-1", code: "video-1", taken_at: 1788087480, user: user("carol", "Carol Example"),
      caption: { text: "A video" }, media_type: 2, width: 1080, height: 1920,
      video_versions: [{ url: "https://cdn.example/video.mp4", width: 1080, height: 1920 }],
      image_versions2: { candidates: [{ url: "https://cdn.example/video-cover.jpg", width: 1080, height: 1920 }] }
    },
    {
      pk: "carousel-1", code: "carousel-1", taken_at: 1788087420, user: user("dana", "Dana Example"),
      caption: { text: "A carousel" }, carousel_media: [
        { image_versions2: { candidates: [{ url: "https://cdn.example/c1.jpg", width: 1000, height: 1000 }] } },
        { media_type: 2, video_versions: [{ url: "https://cdn.example/c2.mp4", width: 1920, height: 1080 }], image_versions2: { candidates: [{ url: "https://cdn.example/c2-cover.jpg", width: 1920, height: 1080 }] } }
      ]
    },
    {
      pk: "link-1", code: "link-1", taken_at: 1788087360, user: user("erin", "Erin Example"),
      caption: { text: "Worth reading" }, text_post_app_info: {
        link_preview_attachment: {
          url: "https://news.example/story", title: "The rendered story", description: "A useful description",
          display_url: "news.example", image: { url: "https://cdn.example/link-card.jpg" }, width: 1200, height: 630
        }
      }
    },
    {
      pk: "quote-1", code: "quote-1", taken_at: 1788087300, user: user("frank", "Frank Example"),
      caption: { text: "Adding context" }, text_post_app_info: { share_info: { quoted_post: {
        pk: "quoted-original", code: "quoted-original", taken_at: 1788080000, user: user("grace", "Grace Example"),
        caption: { text: "The original quoted post" },
        image_versions2: { candidates: [{ url: "https://cdn.example/quote.jpg", width: 800, height: 600 }] }
      } } }
    },
    {
      pk: "repost-1", code: "repost-1", taken_at: 1788087240, user: user("henry", "Henry Reposter"),
      text_post_app_info: { share_info: { reposted_post: {
        pk: "repost-original", code: "repost-original", taken_at: 1788087000, user: user("ivy", "Ivy Original"),
        caption: { text: "Original repost content" }
      } } }
    },
    {
      pk: "reply-1", code: "reply-1", taken_at: 1788087180, user: user("jules", "Jules Example"),
      caption: { text: "A reply" }, reply_to: {
        pk: "parent-1", code: "parent-1", taken_at: 1788080000, user: alice, caption: { text: "Parent" }
      }
    }
  ];
  return {
    data: {
      xdt_api__v1__text_feed__timeline: {
        edges: posts.map(post => ({ node: { thread_items: [{ post }] } })),
        page_info: { has_next_page: true, end_cursor: "cursor-2" }
      }
    }
  };
}

function makeContext(pluginSource, overrides = {}) {
  const state = new Map();
  const payload = fixture();
  const context = {
    console, Date, Promise,
    site: "https://www.threads.com",
    sessionid: "fixture-session",
    csrftoken: "fixture-csrf",
    ds_user_id: "123456789",
    mid: "fixture-mid",
    ig_did: "fixture-device",
    rur: "fixture-rur",
    query_doc_id: "99999999999999999",
    query_name: "BarcelonaHomeFeedQuery",
    query_variables: JSON.stringify({ first: 25, after: "__CURSOR__", scale: 2 }),
    include_reposts: "on",
    include_quotes: "on",
    include_replies: "off",
    refresh_interval: "30",
    sendRequest: async (url, method, params, headers, fullResponseRequested) => {
      context.requests.push({ url, method, params, headers, fullResponseRequested });
      return fullResponse(payload);
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
    requests: [], _state: state,
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(pluginSource, context);
  return context;
}

async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setImmediate(resolve));
}

async function runSource(pluginSource = source) {
  const context = makeContext(pluginSource);
  vm.runInContext("verify()", context);
  await settle();
  assert.ifError(context.error);
  assert.strictEqual(context.verification.displayName, "Threads Web · @alice");
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(context.verification.accountIdentity)),
    { name: "Alice Example", username: "@alice", avatar: "https://cdn.example/alice.jpg", uri: "https://www.threads.com/@alice" }
  );

  vm.runInContext("load()", context);
  await settle();
  assert.ifError(context.error);
  assert.strictEqual(context.complete, true);
  assert.strictEqual(context.results.length, 7, "reply is filtered by default and duplicate pagination is removed");

  const byUri = suffix => context.results.find(item => item.uri.endsWith(`/post/${suffix}`));
  const text = byUri("text-1");
  assert.strictEqual(text.author.name, "Alice Example");
  assert.strictEqual(text.author.username, "@alice");
  assert.match(text.body, /<a href="https:\/\/example.com\/read">https:\/\/example.com\/read<\/a>/);

  const image = byUri("image-1").attachments[0];
  assert.strictEqual(image.url, "https://cdn.example/image-large.jpg");
  assert.strictEqual(image.mimeType, "image");
  assert.strictEqual(image.text, "A misty mountain");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(image.aspectSize)), { width: 1600, height: 900 });

  const video = byUri("video-1").attachments[0];
  assert.strictEqual(video.url, "https://cdn.example/video.mp4");
  assert.strictEqual(video.mimeType, "video/mp4");
  assert.strictEqual(video.thumbnail, "https://cdn.example/video-cover.jpg");

  const carousel = byUri("carousel-1").attachments;
  assert.strictEqual(carousel.length, 2);
  assert.strictEqual(carousel[0].url, "https://cdn.example/c1.jpg");
  assert.strictEqual(carousel[1].url, "https://cdn.example/c2.mp4");

  const link = byUri("link-1").attachments[0];
  assert.strictEqual(link.url, "https://news.example/story");
  assert.strictEqual(link.title, "The rendered story");
  assert.strictEqual(link.subtitle, "A useful description");
  assert.strictEqual(link.siteName, "news.example");
  assert.strictEqual(link.image, "https://cdn.example/link-card.jpg");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(link.aspectSize)), { width: 1200, height: 630 });

  const quote = byUri("quote-1").attachments[0];
  assert.strictEqual(quote.author.name, "Grace Example");
  assert.match(quote.body, /original quoted post/i);
  assert.strictEqual(quote.attachments[0].url, "https://cdn.example/quote.jpg");

  const repost = byUri("repost-1");
  assert.strictEqual(repost.author.name, "Ivy Original");
  assert.match(repost.body, /Original repost content/);
  assert.strictEqual(repost.annotations[0].text, "Reposted by Henry Reposter");

  const request = context.requests[1];
  assert.strictEqual(request.url, "https://www.threads.com/api/graphql/");
  assert.strictEqual(request.method, "POST");
  assert.strictEqual(request.fullResponseRequested, true);
  assert.strictEqual(request.headers["X-CSRFToken"], "fixture-csrf");
  assert.strictEqual(request.headers["X-IG-App-ID"], "238260118697367");
  assert.strictEqual(request.headers["X-FB-Friendly-Name"], "BarcelonaHomeFeedQuery");
  assert.match(request.headers.Cookie, /sessionid=fixture-session/);
  assert.match(request.params, /doc_id=99999999999999999/);
  assert.match(decodeURIComponent(request.params), /"after":null/);
  assert.match(decodeURIComponent(context.requests[2].params), /"after":"cursor-2"/);

  const replies = makeContext(pluginSource, { include_replies: "on" });
  vm.runInContext("load()", replies);
  await settle();
  assert.ifError(replies.error);
  assert.strictEqual(replies.results.length, 8);
  const reply = replies.results.find(item => item.uri.endsWith("/post/reply-1"));
  assert.strictEqual(reply.annotations[0].text, "Replying to alice");

  const streamed = makeContext(pluginSource, {
    sendRequest: async () => JSON.stringify({
      status: 200, headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ data: { first: fixture().data } })}\n\ndata: ${JSON.stringify({ data: { incremental: [] } })}`
    })
  });
  vm.runInContext("load()", streamed);
  await settle();
  assert.ifError(streamed.error);
  assert.strictEqual(streamed.results.length, 7);

  const unauthorized = makeContext(pluginSource, { sendRequest: async () => fullResponse({ message: "login required" }, 401) });
  vm.runInContext("load()", unauthorized);
  await settle();
  assert.strictEqual(unauthorized.condition.kind, "authorize");

  const invalidVariables = makeContext(pluginSource, { query_variables: "not-json" });
  vm.runInContext("verify()", invalidVariables);
  await settle();
  assert.match(invalidVariables.error.message, /valid JSON/);
}

module.exports = { runSource };

if (require.main === module) {
  runSource().then(() => console.log("All Threads Web rendering tests passed.")).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
