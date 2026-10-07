import { descriptors, loadModels } from "./face.js";

const slug = decodeURIComponent(location.pathname.split("/")[2] || "");
const title = document.querySelector("#event-title");
const brand = document.querySelector("#event-brand");
const codePanel = document.querySelector("#code-panel");
const searchPanel = document.querySelector("#search-panel");
const codeForm = document.querySelector("#code-form");
const searchForm = document.querySelector("#search-form");
const status = document.querySelector("#status");
const gallery = document.querySelector("#gallery");
let eventToken = null;

function say(message) { status.textContent = message; }

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed");
  return value;
}

async function unlock(code = "") {
  const value = await api(`/api/unlock/${slug}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
  });
  eventToken = value.token;
  codePanel.hidden = true;
  searchPanel.hidden = false;
  say("Choose a clear selfie to find your photos.");
  loadModels().catch(() => say("The face model could not load. Please refresh and try again."));
}

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = codeForm.querySelector("button");
  button.disabled = true;
  try { await unlock(codeForm.elements.code.value); }
  catch (error) { say(error.message); }
  finally { button.disabled = false; }
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = searchForm.querySelector("button");
  const file = searchForm.elements.selfie.files[0];
  if (!file || !file.type.startsWith("image/")) return say("Choose an image file first.");
  if (file.size > 10_000_000) return say("Please choose a photo under 10 MB.");
  button.disabled = true;
  gallery.replaceChildren();
  try {
    say("Checking your selfie on this device…");
    const faces = await descriptors(file);
    if (!faces.length) throw new Error("No face found. Try a clearer selfie.");
    const vector = faces.sort((a, b) => b.area - a.area)[0].vector;
    const found = new Map();
    let offset = 0;
    do {
      say(`Searching event photos… ${offset} faces checked`);
      const page = await api(`/api/search/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${eventToken}` },
        body: JSON.stringify({ embedding: vector, offset }),
      });
      for (const photo of page.photos) {
        if (!found.has(photo.id) || found.get(photo.id).distance > photo.distance) found.set(photo.id, photo);
      }
      offset = page.next_offset;
    } while (offset !== null);

    const photos = [...found.values()].sort((a, b) => a.distance - b.distance);
    say(photos.length ? `${photos.length} matching photos. Tap a photo to open the preview.` : "No matches found. Try another selfie.");
    for (const photo of photos) {
      const base = `/api/image/${slug}/${photo.id}`;
      const access = encodeURIComponent(photo.access);
      const link = document.createElement("a");
      link.href = `${base}/preview?access=${access}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const image = document.createElement("img");
      image.src = `${base}/thumb?access=${access}`;
      image.alt = "Matching event photo";
      image.loading = "lazy";
      link.append(image);
      gallery.append(link);
    }
  } catch (error) {
    say(error.message || "Search failed. Please try again.");
  } finally {
    button.disabled = false;
  }
});

async function start() {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new Error("Event not found");
  const event = await api(`/api/event/${slug}`);
  title.textContent = event.name;
  brand.textContent = event.brand_name ? `Photos by ${event.brand_name}` : "";
  document.title = `${event.name} · PICSHARE`;
  if (event.is_protected) {
    codePanel.hidden = false;
    say("Enter the event code to continue.");
  } else await unlock();
}

start().catch((error) => say(error.message || "Event unavailable"));
