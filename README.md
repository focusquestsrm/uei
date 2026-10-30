# UEI College – Back2Learn landing page

Static landing page plus one Netlify Function that posts leads to LeadHoop (offer "B2L - UEI College (new) (289)").
The page and function are adapted from the UMA Kayla app (`focusquestsrm/uma-landing-page`, branch `fallon-duplicate`,
commit `2076e82b2ad13fb5874a83a396bcb0a4db250f49`), changed to UEI's campus-dependent posting contract.

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run build` | Generate `src/js/runtime-config.js` and `src/js/campus-choices.js` (both git-ignored) from `config/campus-programs.json` |
| `npm test` | Build, then unit and handler tests (`node --test`, vendor `fetch` is always mocked) |
| `npm run check:browser` | Desktop and mobile browser flow against a local server; all external hosts are blocked or stubbed; screenshots go to `checks/output/` |

## Netlify environment variables

Set under Site configuration → Environment variables. Scope: **Functions** (runtime) for all four; none are needed at build time.

| Name | Secret | Purpose | Source |
| --- | --- | --- | --- |
| `LEAD_SUBMISSION_ENABLED` | no | `true` allows posting; anything else blocks posting (503). Start `false`. | You |
| `LEAD_TEST_MODE` | no | `true` sends `lead[test]=true` (accepted, not delivered). Must be exactly `true` or `false`; blank blocks posting and is treated as test. Set `false` only at live launch. | You |
| `SITE_URL` | no | Production origin, e.g. `https://example.com`. Used for the `Origin` check, `lead[signup_url]`, and `lead[consent_url]` validation. HTTPS required (loopback allowed for local tests). | Production domain |
| `LEADHOOP_CAMPAIGN_CODE` | **yes** | Server-only `campaign_code` from the LeadHoop posting specs. Never committed. | LeadHoop posting specs, "Campaign Code" |

No authorization token or FPI is required by the UEI spec. Nothing secret is sent to the browser.

## Where things live

- `config/campus-programs.json` – single maintained source: campuses, programs, offerings, LeadHoop IDs, campus ZIP lists. Set `active: false` on a campus or offering to pause it; paused options disappear from the form and are rejected by the server. Re-run `npm run build`.
- `netlify/functions/submit-lead.mjs` → `_shared/modern-wrapper.mjs` → `_shared/submit-lead-handler.js` (validation, posting, outcomes), `submission-idempotency.js` (Netlify Blobs store `uei-lead-idempotency`, 24 h), `leadhoop-response.js`, `config.js`.
- `src/js/` shared browser/server rules: `phone.js`, `address.js`, `rules.js`, `catalog.js`; browser-only `form.js`, `meta-pixel.js`.

## Source → destination from UMA

| UMA | UEI |
| --- | --- |
| `netlify/functions/_shared/submit-lead-handler.js` | `_shared/submit-lead-handler.js` (POST form-encoded, no auth header, campus/program/ZIP resolution, trusted client IP, test mode) |
| `_shared/submission-idempotency.js` | `_shared/submission-idempotency.js` (store renamed, replay returns original outcome, etag required) |
| `_shared/leadhoop-response.js` | `_shared/leadhoop-response.js` (HTTP status and body evaluated together) |
| `_shared/modern-wrapper.mjs`, `submit-lead.mjs` | same names; client IP taken only from the platform |
| `src/js/function2.js` | `src/js/form.js` (3 steps, campus-dependent programs, real thank-you page) |
| `src/js/phone.js`, `meta-pixel.js` | same names (UEI Pixel ID, `(AAA) BBB-CCCC` formatting) |
| `src/index.html`, `styles.css` | rewritten for UEI; no UMA images or Bootstrap CDN |
| South University `submit-lead.js` / `function2.js` @ `2701d70` | `src/js/address.js` (format checks only, no existence claims) |

Intentionally not carried over: Google Places, program availability/cap admin functions, scheduled reset, TrustedForm, `campaign_id`/`meta_event_id` forwarding.

## Posting behavior

- Endpoint `https://back2learn-post.leadhoop.com/incoming/leads`. The spec lists `http://`; the same host answers on HTTPS, so HTTPS is used.
- Outcomes: `accepted` (2xx + `success`), `rejected` (caps, advertiser, verification), `invalid_request`, `duplicate`, `unavailable` (non-2xx, including a success-looking body), `ambiguous` (timeout/network/unreadable). `unavailable`/`ambiguous` are never reposted; the same submission id replays the stored outcome.
- Meta `Lead` fires only for an HTTP-OK `accepted` response with `testMode:false` and no `replay`. Inherited Back2Learn tracking is kept: `_fbc`→`subid2`, `_fbp`→`subid3`, `fbclid`→`subid4`, plus `utm_*`. `subid` itself is never sent.
- Gender and military status are collected from the user; no defaults.
- Grad year options are 1998–2024 (campaign rule overrides the broader spec list). No "no diploma" option exists in the spec.

## Delivery window

Enforced server-side in `netlify/functions/_shared/delivery-window.js` using `America/New_York` (daylight saving handled by the time zone database). Per the posting spec (verified: "Sunday: Paused", "Monday–Saturday: 09:00 - 21:00 Eastern Time (ET)"), submissions are accepted Monday–Saturday and refused on Sunday. The check runs before idempotency reservation and vendor posting, returns HTTP 503 `{outcome:'closed', message}`, and stores/queues nothing; the visitor sees a message and can submit again during open hours.

Boundary ambiguity: the spec does not say whether 21:00 is inclusive. The window is treated as **09:00:00 inclusive to 21:00:00 exclusive** (20:59:59 accepted, 21:00:00 refused), and Sunday is judged by Eastern local date, not UTC. Confirm with LeadHoop if the end is meant to be inclusive.

## Copy and disclosures review

The page was reviewed against the UEI campaign brief and IEC Marketing Vendor Guidelines (4.6.2026). Unsupported copy ("job-ready skills") was replaced with approved wording; the consent is the exact IEC-approved TCPA text, with the privacy URL linked; the footer carries the length/employment disclaimers, Statement of Non-Discrimination link, auxiliary-aids line, "All programs not available at all campus locations", financial-aid line, and the ACCET/ACCSC accreditation statements. No photos, incentive language, or LaunchYourDegree mentions are used.

## Open decisions / not verified

1. **Oceanside** – marked Active in the campus table but a 2026-10-07 note says to pause it. Currently **paused** (all offerings inactive).
2. **Gardena Automotive Technician and Medical Assistant** – a note pauses them but they are absent from the program table, while the IEC guideline matrix lists them for Gardena. Kept **paused** (IDs 226132 / 226136 unverified); confirm against the current SparkRoom matrix.
3. 21:00 boundary inclusivity (see Delivery window).
4. Campus ID 30464 ("Online") appears only in the state-restrictions table and is excluded.
