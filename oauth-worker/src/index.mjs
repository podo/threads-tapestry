const META_GRAPH = "https://graph.threads.net";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function parameters(request) {
  const url = new URL(request.url);
  const result = new URLSearchParams(url.search);
  if (request.method !== "GET") {
    const type = request.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      const body = await request.json();
      for (const [key, value] of Object.entries(body || {})) result.set(key, String(value));
    } else {
      const body = await request.text();
      const form = new URLSearchParams(body);
      for (const [key, value] of form.entries()) result.set(key, value);
    }
  }
  return result;
}

async function metaJson(url, init) {
  const response = await fetch(url, init);
  let body;
  try {
    body = await response.json();
  } catch (_) {
    body = { error_message: "Meta returned an unreadable token response." };
  }
  if (!response.ok || body.error || body.error_message) {
    const message = body.error && body.error.message
      ? body.error.message
      : body.error_message || `Meta token request failed (${response.status}).`;
    throw new Error(message);
  }
  return body;
}

function verifyClient(params, env) {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new Error("OAuth bridge is missing Meta app configuration.");
  }
  if (params.get("client_id") !== env.META_APP_ID || params.get("client_secret") !== env.META_APP_SECRET) {
    throw new Error("Invalid OAuth client credentials.");
  }
}

async function exchangeCode(params, env) {
  const form = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: params.get("redirect_uri") || "",
    code: params.get("code") || ""
  });
  const shortToken = await metaJson(`${META_GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });

  const query = new URLSearchParams({
    grant_type: "th_exchange_token",
    client_secret: env.META_APP_SECRET,
    access_token: shortToken.access_token
  });
  return metaJson(`${META_GRAPH}/access_token?${query.toString()}`, { method: "GET" });
}

async function refreshToken(params) {
  const token = params.get("refresh_token") || params.get("access_token");
  if (!token) throw new Error("Missing refresh token.");
  const query = new URLSearchParams({
    grant_type: "th_refresh_token",
    access_token: token
  });
  return metaJson(`${META_GRAPH}/refresh_access_token?${query.toString()}`, { method: "GET" });
}

function tapestryToken(metaToken) {
  return {
    access_token: metaToken.access_token,
    token_type: metaToken.token_type || "bearer",
    expires_in: metaToken.expires_in || 5184000,
    refresh_token: metaToken.access_token
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname !== "/token") return json({ error: "Not found" }, 404);
    if (request.method !== "POST" && request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      const params = await parameters(request);
      verifyClient(params, env);
      const grantType = params.get("grant_type") || "authorization_code";
      const token = grantType === "refresh_token"
        ? await refreshToken(params)
        : await exchangeCode(params, env);
      return json(tapestryToken(token));
    } catch (error) {
      return json({ error: "invalid_grant", error_description: error.message }, 400);
    }
  }
};
