import { descriptors, loadModels } from "./face.js";

const form = document.querySelector("#publisher-form");
const status = document.querySelector("#status");
const progress = document.querySelector("#progress");
let manifest;

function say(message) { status.textContent = message; }

async function remote(worker, token, path, options = {}) {
  const response = await fetch(`${worker}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);
  return result;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  const worker = form.elements.worker.value.trim().replace(/\/$/, "");
  const token = form.elements.token.value.trim();
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(worker) || token.length < 32) return say("Enter the deployed HTTPS Worker URL and publishing token.");
  button.disabled = true;
  let uploaded = 0;
  let missed = 0;
  try {
    say("Loading face models…");
    await loadModels();
    let state = await remote(worker, token, `/api/publish/status?slug=${encodeURIComponent(manifest.slug)}`);
    if (state.exists && state.staging_version && state.expected_photos !== manifest.photos.length) {
      if (!window.confirm("The event photo count changed. Discard the unfinished upload and start again?")) {
        throw new Error("The unfinished upload was kept. Reopen the previous local photo set to resume it.");
      }
      let reset;
      do {
        reset = await remote(worker, token, "/api/publish/reset", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: manifest.slug }),
        });
      } while (!reset.done);
      state = await remote(worker, token, `/api/publish/status?slug=${encodeURIComponent(manifest.slug)}`);
    }
    let cleanup;
    do {
      cleanup = await remote(worker, token, "/api/publish/cleanup", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: manifest.slug }),
      });
    } while (!cleanup.done);
    let version = state.staging_version;
    if (!version) {
      const begin = await remote(worker, token, "/api/publish/begin", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          slug: manifest.slug, name: manifest.name, brand_name: manifest.brand_name,
          date: manifest.date, secret_code: manifest.secret_code, expected_photos: manifest.photos.length,
        }),
      });
      version = begin.version;
      state = { uploaded: [] };
    }
    const completed = new Set(state.uploaded);
    uploaded = completed.size;
    for (const photo of manifest.photos) {
      if (completed.has(photo.id)) continue;
      say(`Preparing photo ${uploaded + 1} of ${manifest.photos.length}…`);
      const [previewResponse, thumbResponse] = await Promise.all([
        fetch(`/local/photo/${photo.id}/preview`), fetch(`/local/photo/${photo.id}/thumb`),
      ]);
      if (!previewResponse.ok || !thumbResponse.ok) throw new Error(`Missing local image for ${photo.filename}`);
      const preview = await previewResponse.blob();
      const thumb = await thumbResponse.blob();
      const faces = await descriptors(preview);
      if (!faces.length) missed++;
      const formData = new FormData();
      formData.append("data", JSON.stringify({ slug: manifest.slug, version, id: photo.id, filename: photo.filename,
        embeddings: faces.slice(0, 40).map((face) => face.vector) }));
      formData.append("preview", preview, "preview.jpg");
      formData.append("thumb", thumb, "thumb.jpg");
      await remote(worker, token, "/api/publish/photo", { method: "POST", body: formData });
      uploaded++;
      progress.value = uploaded;
      say(`Uploaded ${uploaded} of ${manifest.photos.length} photos. ${missed} had no detected face.`);
    }
    await remote(worker, token, "/api/publish/finalize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: manifest.slug, version }),
    });
    const link = `${worker}/event/${manifest.slug}`;
    say("Published. Clearing the previous version…");
    do {
      cleanup = await remote(worker, token, "/api/publish/cleanup", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: manifest.slug }),
      });
    } while (!cleanup.done);
    say(`Published. Guest link: ${link}`);
    const anchor = document.querySelector("#published-link");
    anchor.href = link;
    anchor.textContent = link;
    anchor.hidden = false;
  } catch (error) {
    say(`${error.message || "Publishing failed"} Progress is saved; press Publish again to resume.`);
  } finally {
    button.disabled = false;
  }
});

fetch("/local/manifest").then((response) => response.json()).then((value) => {
  manifest = value;
  document.querySelector("#event-name").textContent = value.name;
  document.querySelector("#event-count").textContent = `${value.photos.length} photos · ${(value.total_bytes / 1_000_000).toFixed(0)} MB to publish`;
  progress.max = value.photos.length;
  if (value.total_bytes > 8_000_000_000) {
    form.querySelector("button").disabled = true;
    say("This event exceeds the 8 GB safety limit for the free R2 allowance.");
  } else say("Ready to publish. Keep this tab open until all photos upload.");
}).catch(() => say("Could not load the local event. Restart the publisher server."));
