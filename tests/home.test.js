const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "local.threads.home", "plugin.js"),
  "utf8"
);

function fullResponse(body, status = 200) {
  return JSON.stringify({ status, headers: {}, body: JSON.stringify(body) });
}

function makeContext(overrides = {}) {
  const state = new Map();
  const feed = {
    threads: [
      {
        threadItems: [
          {
            id: "p3",
            takenAt: "2026-08-30T10:00:00Z",
            permalink: "https://www.threads.com/@alice/post/p3",
            text: "Read https://example.com/story.",
            user: {
              username: "alice",
              fullName: "Alice Example",
              hdProfilePicURL: "https://cdn.example/alice-large.jpg"
            },
            imageVersions: [{ url: "https://cdn.example/small.jpg", width: 320, height: 180 }, { url: "https://cdn.example/large.jpg", width: 1280, height: 720 }],
            linkPreview: {
              url: "https://example.com/story",
              title: "A story",
              description: "Story description",
              displayUrl: "example.com",
              imageUrl: "https://cdn.example/card.jpg"
            }
          }
        ]
      },
      {
        threadItems: [
          {
            id: "p2",
            taken_at: 1788084000,
            permalink: "https://www.threads.com/@bob/post/p2",
            text: "Quote",
            user: { username: "bob", full_name: "Bob Example", profile_pic_url: "https://cdn.example/bob.jpg" },
            quoted_post: {
              id: "q1",
              takenAt: "2026-08-30T08:00:00Z",
              permalink: "https://www.threads.com/@carol/post/q1",
              text: "Quoted text",
              user: { username: "carol", fullName: "Carol Example" }
            }
          }
        ]
      }
    ],
    next_max_id: "next-1"
  };

  const context = {
    console,
    Date,
    Promise,
    site: "https://i.instagram.com",
    mobile_token: "IGT:2:test-token",
    device_id: "android-test-device",
    account_handle: "alice",
    feed_kind: "for_you",
    include_reposts: "on",
    include_quotes: "on",
    include_replies: "off",
    refresh_interval: "30",
    sendRequest: async (url, method, params, headers) => {
      context.requests.push({ url, method, params, headers });
      return fullResponse(feed);
    },
    processVerification: value => { context.verification = value; },
    processResults: (value, complete) => { context.results = value; context.complete = complete; },
    processError: error => { context.error = error; },
    raiseCondition: (kind, title, description) => { context.condition = { kind, title, description }; },
    getItem: key => state.get(key) || null,
    setItem: (key, value) => state.set(key, value),
    Item: {
      createWithUriDate: (uri, date) => ({ uri, date })
    },
    Identity: {
      create: (name, username, avatar, uri) => ({ name, username, avatar, uri }),
      createWithName: name => ({ name })
    },
    Annotation: {
      createWithText: text => ({ text })
    },
    MediaAttachment: {
      createWithUrl: url => ({ url })
    },
    LinkAttachment: {
      createWithUrl: url => ({ url })
    },
    requests: [],
    _state: state,
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setImmediate(resolve));
}

async function run() {
  const context = makeContext();
  vm.runInContext("verify()", context);
  await settle();
  assert.ifError(context.error);
  assert.strictEqual(context.verification.displayName, "Threads · @alice");
  assert.strictEqual(context.verification.accountIdentity.name, "Alice Example");

  vm.runInContext("load()", context);
  await settle();
  assert.ifError(context.error);
  assert.strictEqual(context.complete, true);
  assert.strictEqual(context.results.length, 2);
  assert.strictEqual(context.results[0].author.name, "Alice Example");
  assert.strictEqual(context.results[0].author.username, "@alice");
  assert.match(context.results[0].body, /<a href="https:\/\/example.com\/story">https:\/\/example.com\/story<\/a>/);
  assert.strictEqual(context.results[0].attachments[0].url, "https://cdn.example/large.jpg");
  assert.strictEqual(context.results[0].attachments[1].title, "A story");
  assert.strictEqual(context.results[0].attachments[1].subtitle, "Story description");
  assert.strictEqual(context.results[0].attachments[1].image, "https://cdn.example/card.jpg");
  assert.strictEqual(context.results[1].attachments[0].author.name, "Carol Example");
  assert.strictEqual(context.requests[0].headers.Authorization, "Bearer IGT:2:test-token");
  assert.match(context.requests[0].url, /feed_type=for_you/);
  assert.match(context.requests[0].url, /client_session_id=android-test-device/);

  const following = makeContext({ feed_kind: "following" });
  vm.runInContext("load()", following);
  await settle();
  assert.match(following.requests[0].url, /feed_type=following/);

  const unauthorized = makeContext({
    sendRequest: async () => fullResponse({ error: { message: "login required" } }, 401)
  });
  vm.runInContext("load()", unauthorized);
  await settle();
  assert.strictEqual(unauthorized.condition.kind, "authorize");

  const missing = makeContext({ mobile_token: "" });
  vm.runInContext("verify()", missing);
  await settle();
  assert.match(missing.error.message, /mobile token/);

  console.log("All Threads Home connector tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
