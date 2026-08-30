import assert from "node:assert/strict";
import worker from "../oauth-worker/src/index.mjs";

const env = { META_APP_ID: "app-123", META_APP_SECRET: "secret-456" };
const calls = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/oauth/access_token")) {
    return new Response(JSON.stringify({ access_token: "short-token", user_id: "user-1" }), { status: 200 });
  }
  if (String(url).includes("/access_token?")) {
    return new Response(JSON.stringify({ access_token: "long-token", token_type: "bearer", expires_in: 5184000 }), { status: 200 });
  }
  if (String(url).includes("/refresh_access_token?")) {
    return new Response(JSON.stringify({ access_token: "refreshed-token", token_type: "bearer", expires_in: 5184000 }), { status: 200 });
  }
  throw new Error(`Unexpected URL: ${url}`);
};

try {
  const exchangeRequest = new Request("https://worker.example/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: "https://iconfactory.com/tapestry-oauth",
      code: "auth-code"
    })
  });
  const exchangeResponse = await worker.fetch(exchangeRequest, env);
  const exchanged = await exchangeResponse.json();
  assert.strictEqual(exchangeResponse.status, 200);
  assert.strictEqual(exchanged.access_token, "long-token");
  assert.strictEqual(exchanged.refresh_token, "long-token");
  assert.strictEqual(calls.length, 2);

  const refreshRequest = new Request("https://worker.example/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      grant_type: "refresh_token",
      refresh_token: "long-token"
    })
  });
  const refreshResponse = await worker.fetch(refreshRequest, env);
  const refreshed = await refreshResponse.json();
  assert.strictEqual(refreshed.access_token, "refreshed-token");
  assert.strictEqual(refreshed.refresh_token, "refreshed-token");

  const invalidRequest = new Request("https://worker.example/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "wrong", client_secret: "wrong", code: "x" })
  });
  const invalidResponse = await worker.fetch(invalidRequest, env);
  assert.strictEqual(invalidResponse.status, 400);

  const healthResponse = await worker.fetch(new Request("https://worker.example/health"), env);
  assert.deepStrictEqual(await healthResponse.json(), { ok: true });

  console.log("All OAuth worker tests passed.");
} finally {
  globalThis.fetch = originalFetch;
}
