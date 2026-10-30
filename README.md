# UEI Back2Learn campaign rebuild

This UEI project was rebuilt from the actual authorized UMA Kayla reference app in `focusquestsrm/uma-landing-page`, branch `fallon-duplicate`, pinned at `2076e82b2ad13fb5874a83a396bcb0a4db250f49`.

The rebuild keeps the reference flow and field architecture, while adapting the UEI campaign data, disclosure language, local validation, and server-side guarding. The browser loads a sanitized public projection of the server-side production campus/program matrix instead of the earlier preview-only placeholder data, and the submit flow remains disabled unless the server configuration explicitly enables outbound posting.

The page uses the supplied UEI TCPA disclosure, privacy-policy link, Open Sans, and IEC marketing palette, with program length, financial-aid, career-services, campus-availability, and employment qualifications displayed alongside relevant claims. It describes UEI's hybrid learning as online coursework combined with in-person hands-on training in campus labs; it does not describe the programs as fully online.

## Reference and supplied assets

- Authorized reference: [focusquestsrm/uma-landing-page](https://github.com/focusquestsrm/uma-landing-page), branch `fallon-duplicate`, pinned at `2076e82b2ad13fb5874a83a396bcb0a4db250f49`.
- The reference README identifies `src/data/uma-kayla-programs.csv`; the branch's page, form flow, styles, Back2Learn footer attribution, and shared browser/server phone-normalization pattern were reviewed. Production at `https://uma.back2learn.com/` does not expose a verifiable commit, so whether it matches the pinned branch could not be confirmed.
- Phone normalization and 10-digit US validation are performed in the browser and repeated server-side using the UEI shared helper.
- UEI logo: `src/image/uei-college-horizontal.jpg`, the horizontal UEI College logo downloaded from the Canto asset collection linked by the supplied IEC Marketing Vendor Guidelines. The local file is JPEG despite the upstream asset's misleading `.png` filename.
- Back2Learn logo: downloaded from the official Back2Learn site at `https://www.back2learn.com/wp-content/uploads/2021/05/B2L-logo.png` and used as the horizontal wordmark beside the UEI logo in the header; the footer continues to use the text attribution model from the reference review.
- No approved UEI campus photography was found in the supplied materials or reviewed asset collection. The hero and campus artwork are abstract CSS illustration, not depictions of real campuses.

## Local preview

Requires Node.js 18 or later. No third-party npm packages are required.

```powershell
npm install
npm test
npm run build
npx netlify dev
```

Open the local URL printed by Netlify Dev. The form supports campus selection, campus-dependent program selection, guided contact details, phone normalization, validation, unchecked required consent, Back navigation with preserved fields, and a completion screen. Completion is only a preview; no HTTP request or conversion event is triggered.

## Production availability and campus/program configuration

`src/data/uei-preview-campus-programs.json` remains the browser-side preview matrix used for the UX and testing flow. The exported LeadHoop posting specs define the live campaign availability and routing values; the server-only file `netlify/data/uei-campus-programs.json` mirrors those values while keeping the known contract conflicts paused.

The live matrix is read server-side for validation on every request. Use stable production IDs and `leadHoopId` values from the approved posting specs; preview IDs remain forbidden in production. The shared availability validator rejects impossible combinations and requires a confirmed mapping for every active campus/program pair.

The current public spec history includes a direct contradiction for two cases: the campus table shows Oceanside as active, but the October 7 change note says to pause it, and Gardena lists the campus as active while the same note pauses Automotive Technician and Medical Assistant. Those contradictory options remain set to `active: false` in the server file until the campaign owner confirms the final matrix. The function respects those pauses and rejects any attempt to select them.

To pause a campus or one campus/program combination, change its `active` flag to `false` in the server-only file and deploy the change. The function reads current availability for each request, so an option paused after a form was opened is rejected. Reactivate only after the authorized availability owner confirms it. Do not expose credentials or create a browser-side administrative interface.

## Submission and launch dependencies

Outbound posting is disabled in `.env.example` (`LEAD_SUBMISSION_ENABLED=false`), the checked-in production availability is empty, and the browser preview contains no posting request. The Netlify function validates consent, contact fields, normalized phone, and the current active mapped campus/program pair, and rejects preview selections. No production leads or test leads have been sent.

Before implementation or launch, obtain and verify:

1. An authorized export of the complete LeadHoop posting specifications for campaign 12213. The supplied admin URL redirects to sign-in; do not infer endpoint, posting/campaign code, authorization, FPI, required fields, response rules, or fixed routing values from its URL.
2. The current UEI Sparkroom availability matrix and confirmed LeadHoop mappings for each campus/program pair, plus any eligibility, ZIP, distance, cap, or other acceptance rules.
3. Confirmed field mappings for Jordan traffic attribution and `fbclid`, `_fbc`, and `_fbp`; no attribution fields are currently mapped to LeadHoop subids.
4. Required address fields and validation, if any. There is no address autocomplete or Google Maps/Places integration.
5. Confirmed deduplication/idempotency storage, ambiguous-response handling, and separate accepted/rejected redirect destinations.
6. Any approved configuration for Meta Pixel, TrustedForm, Jornaya, and any conversion-event conditions. No UMA identifiers were copied and no preview, validation, rejected, or failed submission can fire a successful conversion event.
7. Any approved demographic answers and mappings if the posting specs require them. The page does not hardcode gender or other demographic answers.
8. Confirmation of the production domain. `uei.back2learn.com` is only a proposed domain.

After the specifications are supplied, implement and test the protected server-side posting flow, durable deduplication, ambiguous-response safeguards, and accepted/rejected redirects. Keep authorization, FPI, endpoint, routing values, and other protected settings in server environment variables with nonfunctional placeholders in `.env.example`. Keep `LEAD_SUBMISSION_ENABLED=false` until configuration and end-to-end review are approved. Do not send a lead while testing without separate authorization.

## Deployment

`netlify.toml` configures the static build and serverless function. This page is not launch-ready while the posting specifications and approved availability/mappings are missing. Do not enable posting, configure DNS, or treat the proposed custom domain as confirmed.
