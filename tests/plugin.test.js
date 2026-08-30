const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "local.threads.feed", "plugin.js"),
  "utf8"
);

function fullResponse(body, status = 200) {
  return JSON.stringify({ status, headers: {}, body: JSON.stringify(body) });
}

function makeContext(overrides = {}) {
  const state = new Map();
  const profiles = {
    mosseri: {
      username: "mosseri",
      name: "Adam Mosseri",
      profile_picture_url: "https://cdn.example/mosseri.jpg",
      follower_count: 1000,
      is_verified: true
    },
    zuck: {
      username: "zuck",
      name: "Mark Zuckerberg",
      profile_picture_url: "https://cdn.example/zuck.jpg",
      follower_count: 2000,
      is_verified: true
    }
  };
  const posts = {
    mosseri: [
      {
        id: "m2",
        media_type: "IMAGE",
        media_url: "https://cdn.example/image.jpg",
        permalink: "https://www.threads.com/@mosseri/post/m2",
        username: "mosseri",
        text: "New <feature> & details",
        timestamp: "2026-08-30T10:00:00Z",
        alt_text: "Product screenshot",
        topic_tag: "ThreadsAPI",
        profile_picture_url: "https://cdn.example/mosseri.jpg"
      },
      {
        id: "m1",
        media_type: "REPOST_FACADE",
        reposted_post: "original-1",
        permalink: "https://www.threads.com/@mosseri/post/m1",
        username: "mosseri",
        text: "Repost",
        timestamp: "2026-08-30T08:00:00Z"
      }
    ],
    zuck: [
      {
        id: "z1",
        media_type: "TEXT_POST",
        permalink: "https://www.threads.com/@zuck/post/z1",
        username: "zuck",
        text: "Quoted post",
        timestamp: "2026-08-30T09:00:00Z",
        is_quote_post: true,
        link_attachment_url: "https://example.com"
      }
    ]
  };

  const context = {
    console,
    Date,
    Promise,
    accounts: "@Mosseri, https://www.threads.com/@zuck, @mosseri",
    posts_per_account: "25",
    refresh_interval: "30",
    include_reposts: "off",
    include_quotes: "on",
    site: "https://graph.threads.net",
    sendRequest: async url => {
      context.requests.push(url);
      const username = decodeURIComponent((url.match(/[?&]username=([^&]+)/) || [])[1] || "");
      if (url.includes("profile_lookup")) return fullResponse(profiles[username] || {}, profiles[username] ? 200 : 404);
      return fullResponse({ data: posts[username] || [] });
    },
    processVerification: value => { context.verification = value; },
    processResults: value => { context.results = value; },
    processError: error => { context.error = error; },
    getItem: key => state.get(key) || null,
    setItem: (key, value) => state.set(key, value),
    Item: { createWithUriDate: (uri, date) => ({ uri, date }) },
    Identity: { createWithName: name => ({ name }) },
    Annotation: { createWithText: text => ({ text }) },
    MediaAttachment: { createWithUrl: url => ({ url }) },
    LinkAttachment: { createWithUrl: url => ({ url }) },
    requests: [],
    _state: state,
    ...overrides
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function run() {
  const context = makeContext();
  const parsed = vm.runInContext("parseAccounts(accounts)", context);
  assert.deepStrictEqual(Array.from(parsed), ["mosseri", "zuck"]);

  vm.runInContext("verify()", context);
  await settle();
  assert.ifError(context.error);
  assert.strictEqual(context.verification.displayName, "Threads · 2 accounts");
  assert.strictEqual(context.verification.icon, "https://cdn.example/mosseri.jpg");

  vm.runInContext("load()", context);
  await settle();
  assert.ifError(context.error);
  assert.strictEqual(context.results.length, 2, "reposts should be excluded by default");
  assert.strictEqual(context.results[0].uri, "https://www.threads.com/@mosseri/post/m2");
  assert.strictEqual(context.results[1].uri, "https://www.threads.com/@zuck/post/z1");
  assert.match(context.results[0].body, /&lt;feature&gt; &amp; details/);
  assert.strictEqual(context.results[0].author.name, "Adam Mosseri");
  assert.strictEqual(context.results[0].attachments[0].url, "https://cdn.example/image.jpg");
  assert.strictEqual(context.results[0].attachments[0].text, "Product screenshot");
  assert.strictEqual(context.results[1].attachments[0].url, "https://example.com");
  assert.strictEqual(context.results[1].annotations[0].text, "Quoted a Threads post");

  const requestCount = context.requests.length;
  vm.runInContext("load()", context);
  await settle();
  assert.strictEqual(context.results, null, "second load should be throttled");
  assert.strictEqual(context.requests.length, requestCount);

  const repostContext = makeContext({ include_reposts: "on" });
  vm.runInContext("load()", repostContext);
  await settle();
  assert.strictEqual(repostContext.results.length, 3);
  const repost = repostContext.results.find(item => item.uri.endsWith("/m1"));
  assert.strictEqual(repost.annotations[0].text, "Reposted on Threads");

  const partialContext = makeContext({
    sendRequest: async url => {
      const username = decodeURIComponent((url.match(/[?&]username=([^&]+)/) || [])[1] || "");
      if (username === "zuck") return fullResponse({ error: { message: "Unavailable" } }, 400);
      return fullResponse({ data: [{
        id: "ok",
        media_type: "TEXT_POST",
        permalink: "https://www.threads.com/@mosseri/post/ok",
        username: "mosseri",
        text: "Still works",
        timestamp: "2026-08-30T11:00:00Z"
      }] });
    }
  });
  vm.runInContext("load()", partialContext);
  await settle();
  assert.ifError(partialContext.error);
  assert.strictEqual(partialContext.results.length, 1, "one failing account must not break the feed");

  const missing = makeContext({ accounts: "" });
  vm.runInContext("verify()", missing);
  await settle();
  assert.match(missing.error.message, /at least one/);

  console.log("All Threads connector tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
