const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PHOTO_ID = /^[a-f0-9-]{36}$/i;
const VERSION = /^[a-f0-9-]{36}$/i;
const PAGE_SIZE = 200;
const MATCH_DISTANCE = 0.52;
const DAY = 24 * 60 * 60;
const CORS_ORIGIN = "http://127.0.0.1:4173";

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function bad(message, status = 400) {
  return json({ error: message }, status);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
}

async function key(env) {
  if (!env.PUBLISH_TOKEN || env.PUBLISH_TOKEN.length < 32) throw new Error("PUBLISH_TOKEN is not configured");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.PUBLISH_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function mac(env, value) {
  const signature = await crypto.subtle.sign("HMAC", await key(env), new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyMac(env, value, signature) {
  try {
    return await crypto.subtle.verify("HMAC", await key(env), base64UrlToBytes(signature), new TextEncoder().encode(value));
  } catch {
    return false;
  }
}

async function signedToken(env, fields) {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(fields)));
  return `${payload}.${await mac(env, payload)}`;
}

async function readToken(env, token, scope) {
  if (!token || token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !(await verifyMac(env, payload, signature))) return null;
  try {
    const fields = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    return fields.scope === scope && Number.isInteger(fields.exp) && fields.exp > Date.now() / 1000 ? fields : null;
  } catch {
    return null;
  }
}

async function codeHash(env, slug, code) {
  return mac(env, `event-code:${slug}:${code}`);
}

function validEmbedding(value) {
  return Array.isArray(value) && value.length === 128 && value.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 10);
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < 128; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function equalSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left[i] || 0) ^ (right[i] || 0);
  return difference === 0;
}

function cors(response, request) {
  if (request.headers.get("origin") !== CORS_ORIGIN) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", CORS_ORIGIN);
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "authorization, content-type");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

async function publish(request, env, path) {
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), request);
  if (request.headers.get("origin") && request.headers.get("origin") !== CORS_ORIGIN) return bad("Origin not allowed", 403);
  if (!env.PUBLISH_TOKEN || env.PUBLISH_TOKEN.length < 32) return bad("Publisher is not configured", 503);
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!equalSecret(supplied, env.PUBLISH_TOKEN)) return cors(bad("Unauthorized", 401), request);
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  if (path === "/api/publish/status" && request.method === "GET") {
    if (!SLUG.test(slug || "")) return bad("Invalid event slug");
    const event = await env.DB.prepare("SELECT active_version, staging_version, expected_photos FROM events WHERE slug = ?").bind(slug).first();
    if (!event) return cors(json({ exists: false }), request);
    const version = event.staging_version;
    const rows = version ? await env.DB.prepare("SELECT id FROM photos WHERE slug = ? AND version = ?").bind(slug, version).all() : { results: [] };
    return cors(json({ exists: true, active_version: event.active_version, staging_version: version, expected_photos: event.expected_photos, uploaded: rows.results.map((r) => r.id) }), request);
  }

  if (request.method !== "POST") return bad("Method not allowed", 405);
  const contentLength = Number(request.headers.get("content-length"));
  if (!contentLength || contentLength > 2_000_000) return bad("Upload too large or length missing", 413);

  if (path === "/api/publish/begin") {
    const data = await request.json();
    const eventSlug = data.slug;
    if (!SLUG.test(eventSlug || "") || typeof data.name !== "string" || !data.name.trim() || data.name.length > 160 ||
        typeof data.brand_name !== "string" || data.brand_name.length > 160 || typeof data.date !== "string" ||
        !Number.isInteger(data.expected_photos) || data.expected_photos < 1 || data.expected_photos > 10_000 ||
        (data.secret_code && (typeof data.secret_code !== "string" || data.secret_code.length > 128))) return bad("Invalid event data");
    const version = crypto.randomUUID();
    const hash = data.secret_code ? await codeHash(env, eventSlug, data.secret_code) : null;
    const existing = await env.DB.prepare("SELECT staging_version, cleanup_version FROM events WHERE slug = ?").bind(eventSlug).first();
    if (existing?.staging_version || existing?.cleanup_version) return bad("Finish or clear the previous publish first", 409);
    await env.DB.prepare(`INSERT INTO events (slug, name, brand_name, date, code_hash, staging_version,
        staging_name, staging_brand_name, staging_date, staging_code_hash, expected_photos)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET staging_version=excluded.staging_version,
      staging_name=excluded.staging_name, staging_brand_name=excluded.staging_brand_name,
      staging_date=excluded.staging_date, staging_code_hash=excluded.staging_code_hash,
      expected_photos=excluded.expected_photos`)
      .bind(eventSlug, data.name.trim(), data.brand_name, data.date, hash, version,
        data.name.trim(), data.brand_name, data.date, hash, data.expected_photos).run();
    return cors(json({ version }), request);
  }

  if (path === "/api/publish/photo") {
    const form = await request.formData();
    let data;
    try { data = JSON.parse(String(form.get("data"))); } catch { return bad("Invalid photo metadata"); }
    const preview = form.get("preview");
    const thumb = form.get("thumb");
    if (!SLUG.test(data.slug || "") || !VERSION.test(data.version || "") || !PHOTO_ID.test(data.id || "") ||
        typeof data.filename !== "string" || data.filename.length > 250 || !Array.isArray(data.embeddings) ||
        data.embeddings.length > 40 || !data.embeddings.every(validEmbedding) ||
        !(preview instanceof File) || !(thumb instanceof File) || preview.size > 1_700_000 || thumb.size > 300_000 ||
        preview.type !== "image/jpeg" || thumb.type !== "image/jpeg") return bad("Invalid photo upload");
    const event = await env.DB.prepare("SELECT staging_version FROM events WHERE slug = ?").bind(data.slug).first();
    if (!event || event.staging_version !== data.version) return bad("No active publish session", 409);
    const previous = await env.DB.prepare("SELECT bytes FROM photos WHERE slug = ? AND version = ? AND id = ?")
      .bind(data.slug, data.version, data.id).first();
    const usage = await env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM photos").first();
    const newBytes = preview.size + thumb.size;
    if (usage.n - (previous?.bytes || 0) + newBytes > 8_000_000_000) return bad("The 8 GB safety limit has been reached", 507);
    const base = `events/${data.slug}/${data.version}/${data.id}`;
    await env.PHOTOS.put(`${base}/preview.jpg`, preview.stream(), { httpMetadata: { contentType: "image/jpeg" } });
    await env.PHOTOS.put(`${base}/thumb.jpg`, thumb.stream(), { httpMetadata: { contentType: "image/jpeg" } });
    const statements = [
      env.DB.prepare("INSERT OR REPLACE INTO photos (slug, version, id, filename, bytes) VALUES (?, ?, ?, ?, ?)").bind(data.slug, data.version, data.id, data.filename, newBytes),
      env.DB.prepare("DELETE FROM faces WHERE slug = ? AND version = ? AND photo_id = ?").bind(data.slug, data.version, data.id),
    ];
    for (let i = 0; i < data.embeddings.length; i++) {
      statements.push(env.DB.prepare("INSERT INTO faces (slug, version, id, photo_id, embedding) VALUES (?, ?, ?, ?, ?)")
        .bind(data.slug, data.version, `${data.id}-${i}`, data.id, JSON.stringify(data.embeddings[i])));
    }
    await env.DB.batch(statements);
    return cors(json({ uploaded: data.id, faces: data.embeddings.length }), request);
  }

  if (path === "/api/publish/finalize") {
    const data = await request.json();
    if (!SLUG.test(data.slug || "") || !VERSION.test(data.version || "")) return bad("Invalid publish session");
    const event = await env.DB.prepare("SELECT active_version, staging_version, expected_photos FROM events WHERE slug = ?").bind(data.slug).first();
    if (!event || event.staging_version !== data.version) return bad("No active publish session", 409);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE slug = ? AND version = ?").bind(data.slug, data.version).first();
    if (count.n !== event.expected_photos) return bad(`Uploaded ${count.n} of ${event.expected_photos} photos`, 409);
    await env.DB.prepare(`UPDATE events SET active_version = ?, staging_version = NULL, cleanup_version = ?,
      name = staging_name, brand_name = staging_brand_name, date = staging_date, code_hash = staging_code_hash,
      staging_name = NULL, staging_brand_name = NULL, staging_date = NULL, staging_code_hash = NULL,
      published_at = ? WHERE slug = ?`)
      .bind(data.version, event.active_version, new Date().toISOString(), data.slug).run();
    return cors(json({ published: true, url: `/event/${data.slug}` }), request);
  }
  if (path === "/api/publish/cleanup") {
    const data = await request.json();
    if (!SLUG.test(data.slug || "")) return bad("Invalid event slug");
    const event = await env.DB.prepare("SELECT cleanup_version FROM events WHERE slug = ?").bind(data.slug).first();
    if (!event?.cleanup_version) return cors(json({ done: true }), request);
    const oldVersion = event.cleanup_version;
    const oldObjects = await env.PHOTOS.list({ prefix: `events/${data.slug}/${oldVersion}/`, limit: 20 });
    if (oldObjects.objects.length) {
      await Promise.all(oldObjects.objects.map((object) => env.PHOTOS.delete(object.key)));
      return cors(json({ done: false, removed: oldObjects.objects.length }), request);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM faces WHERE slug = ? AND version = ?").bind(data.slug, oldVersion),
      env.DB.prepare("DELETE FROM photos WHERE slug = ? AND version = ?").bind(data.slug, oldVersion),
      env.DB.prepare("UPDATE events SET cleanup_version = NULL WHERE slug = ?").bind(data.slug),
    ]);
    return cors(json({ done: true }), request);
  }
  if (path === "/api/publish/reset") {
    const data = await request.json();
    if (!SLUG.test(data.slug || "")) return bad("Invalid event slug");
    const event = await env.DB.prepare("SELECT staging_version FROM events WHERE slug = ?").bind(data.slug).first();
    if (!event?.staging_version) return cors(json({ done: true }), request);
    const version = event.staging_version;
    const objects = await env.PHOTOS.list({ prefix: `events/${data.slug}/${version}/`, limit: 20 });
    if (objects.objects.length) {
      await Promise.all(objects.objects.map((object) => env.PHOTOS.delete(object.key)));
      return cors(json({ done: false, removed: objects.objects.length }), request);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM faces WHERE slug = ? AND version = ?").bind(data.slug, version),
      env.DB.prepare("DELETE FROM photos WHERE slug = ? AND version = ?").bind(data.slug, version),
      env.DB.prepare(`UPDATE events SET staging_version = NULL, staging_name = NULL,
        staging_brand_name = NULL, staging_date = NULL, staging_code_hash = NULL,
        expected_photos = 0 WHERE slug = ?`).bind(data.slug),
    ]);
    return cors(json({ done: true }), request);
  }
  return bad("Not found", 404);
}

async function publicApi(request, env, path) {
  const parts = path.split("/").filter(Boolean);
  const slug = parts[2];
  if (!SLUG.test(slug || "")) return bad("Event not found", 404);
  const event = await env.DB.prepare("SELECT slug, name, brand_name, date, code_hash, active_version FROM events WHERE slug = ?").bind(slug).first();
  if (!event || !event.active_version) return bad("Event not found", 404);

  if (parts[1] === "event" && parts.length === 3 && request.method === "GET") {
    return json({ name: event.name, brand_name: event.brand_name, date: event.date, is_protected: !!event.code_hash });
  }
  if (parts[1] === "unlock" && parts.length === 3 && request.method === "POST") {
    const address = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await env.UNLOCK_LIMIT.limit({ key: `${slug}:${address}` })).success) return bad("Too many attempts. Please try later.", 429);
    const length = Number(request.headers.get("content-length"));
    if (!length || length > 1000) return bad("Request too large", 413);
    const data = await request.json();
    if (event.code_hash && (typeof data.code !== "string" || data.code.length > 128 || !equalSecret(await codeHash(env, slug, data.code), event.code_hash))) return bad("Invalid event code", 401);
    const token = await signedToken(env, { scope: "event", slug, version: event.active_version, exp: Math.floor(Date.now() / 1000) + DAY });
    return json({ token });
  }
  if (parts[1] === "search" && parts.length === 3 && request.method === "POST") {
    const address = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await env.SEARCH_LIMIT.limit({ key: `${slug}:${address}` })).success) return bad("Too many searches. Please try later.", 429);
    const length = Number(request.headers.get("content-length"));
    if (!length || length > 5000) return bad("Request too large", 413);
    const token = await readToken(env, (request.headers.get("authorization") || "").replace(/^Bearer /, ""), "event");
    if (!token || token.slug !== slug || token.version !== event.active_version) return bad("Event access expired", 401);
    const data = await request.json();
    if (!validEmbedding(data.embedding) || !Number.isInteger(data.offset) || data.offset < 0 || data.offset > 100_000) return bad("Invalid search");
    const rows = await env.DB.prepare("SELECT photo_id, embedding FROM faces WHERE slug = ? AND version = ? ORDER BY id LIMIT ? OFFSET ?")
      .bind(slug, event.active_version, PAGE_SIZE, data.offset).all();
    const matches = new Map();
    for (const row of rows.results) {
      const d = distance(data.embedding, JSON.parse(row.embedding));
      if (d <= MATCH_DISTANCE && (matches.get(row.photo_id) ?? Infinity) > d) matches.set(row.photo_id, d);
    }
    const expiry = Math.floor(Date.now() / 1000) + DAY;
    const photos = await Promise.all([...matches].map(async ([id, d]) => ({
      id, distance: d,
      access: await signedToken(env, { scope: "photo", slug, version: event.active_version, id, exp: expiry }),
    })));
    return json({ photos, next_offset: rows.results.length === PAGE_SIZE ? data.offset + PAGE_SIZE : null });
  }
  if (parts[1] === "image" && parts.length === 5 && request.method === "GET") {
    const id = parts[3];
    const size = parts[4];
    if (!PHOTO_ID.test(id || "") || !["thumb", "preview"].includes(size)) return bad("Image not found", 404);
    const access = await readToken(env, new URL(request.url).searchParams.get("access"), "photo");
    if (!access || access.slug !== slug || access.version !== event.active_version || access.id !== id) return bad("Image access expired", 403);
    const object = await env.PHOTOS.get(`events/${slug}/${event.active_version}/${id}/${size}.jpg`);
    if (!object) return bad("Image not found", 404);
    return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
  }
  return bad("Not found", 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/publish/")) return cors(await publish(request, env, url.pathname), request);
      if (url.pathname.startsWith("/api/")) return publicApi(request, env, url.pathname);
      if (url.pathname === "/" || /^\/event\/[a-z0-9][a-z0-9-]{0,62}$/.test(url.pathname)) {
        return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("offline-host request failed", { message: error?.message });
      return bad("Service error", 500);
    }
  },
};
