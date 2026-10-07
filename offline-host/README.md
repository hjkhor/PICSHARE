# Offline event publishing

This is a separate guest site for future PICSHARE events. Prepare an event in
the existing local app while your PC is on, then publish its processed previews
and a new set of face descriptors. After publishing, guests can search the
hosted event while your PC is off. Nothing here publishes an event automatically.

The hosted site uses a Cloudflare Worker, D1, R2, and static Worker assets. It
does not use Oracle or an always-on PC. It uses Cloudflare's free allowances;
the code limits this feature to 8 GB of stored event photos, leaving room below
R2's 10 GB-month free storage allowance. Other R2 usage in the same account and
Cloudflare's other service limits still count. When a free quota is exhausted,
requests may fail until it resets. Check the current [R2](https://developers.cloudflare.com/r2/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/), and
[Workers](https://developers.cloudflare.com/workers/platform/limits/) allowances
before publishing a large event.

## How guest search works

The publisher processes each local preview with the browser face model and
uploads its descriptors plus compressed preview and thumbnail. Guest browsers
run the same model on their selfie. The selfie remains on the guest device; the
site sends one 128-number descriptor to the Worker for matching. The Worker
compares it to private D1 descriptors in batches and returns short-lived URLs
only for matched photos. Images live in a private R2 bucket. No guest name,
selfie image, or search history is stored by this hosted flow.

The publisher uses a different face model from the existing local InsightFace
app. Matching quality must be reviewed on a new event before sharing its link.
Published downloads are compressed previews; original HD Drive photos remain
available only through the local app while it is running.

## One-time Cloudflare setup

Run these commands from `offline-host/` after signing in to your Cloudflare
account. Use a **Workers Free** account and keep R2 storage within its free
allowance.

```sh
npm install
npx wrangler login
npx wrangler r2 bucket create picshare-offline-photos
npx wrangler d1 create picshare-offline-events
```

Copy the database UUID printed by `d1 create` into `wrangler.jsonc`, replacing
`REPLACE_WITH_D1_DATABASE_ID`. Then run:

```sh
npx wrangler d1 migrations apply picshare-offline-events --remote
npm run deploy
npx wrangler secret put PUBLISH_TOKEN
```

For `PUBLISH_TOKEN`, generate a long random value with
`python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`, save it in your
password manager, and paste it into Wrangler's secret prompt. Do not store it
in this repo or `backend/.env`. Wrangler prints the hosted `workers.dev` URL.
The secret must remain unchanged: it also signs guest access tokens and event
code hashes.

## Publish a new event

1. Create and sync the event in the existing PICSHARE admin UI while the PC is
   on. Wait for the photo processing status to finish.
2. In `offline-host/`, run `npm run build` and
   `python3 publisher_server.py --slug YOUR-NEW-EVENT-SLUG`.
3. Open `http://127.0.0.1:4173` on this PC. Enter the hosted Worker URL and
   the publishing token. Keep the page open until it reports a guest link.
4. Review search results using a few different selfies before sharing that
   guest link. The event link is `https://YOUR-WORKER.workers.dev/event/SLUG`.

The publisher binds to loopback only. It can resume uploaded photos after a
browser or network interruption while the local event photo count is unchanged.
Newly added photos require publishing the event again. The old version remains
available until the new version is complete; the publisher then removes it.
Keep the publishing token private, and protect private events with an event
code in the existing admin UI.
