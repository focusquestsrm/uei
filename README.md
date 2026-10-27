# UEI Back2Learn campaign preview

This standalone UEI College landing page adapts the guided campaign experience of the authorized UMA Kayla reference. It is an interactive **review preview**, not a live lead form: the campus/program choices are provisional, completing the form sends no inquiry, and the server-side LeadHoop integration is disabled.

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

## Provisional campus/program options

`src/data/uei-preview-campus-programs.json` contains the 22 campuses and campus/program relationships transcribed from pages 9–10 of the supplied IEC Marketing Vendor Guidelines (April 6, 2026). Each ID is prefixed `preview-campus-` or `preview-program-`. This is reference material only: the PDF says to use the latest Sparkroom matrix, so these options are explicitly provisional and must not be treated as current availability or submitted to LeadHoop.

The browser loads only this preview file. `netlify/data/uei-campus-programs.json` is server-only, has no campus or program options, and is included only in the function bundle. Never copy preview IDs into the production file. Populate it only after the current Sparkroom matrix and confirmed LeadHoop campus/program mappings are supplied. Its schema is:

```json
{
  "previewOnly": false,
  "campuses": [
    {
      "id": "confirmed-production-campus-id",
      "name": "Confirmed campus name",
      "displayOrder": 1,
      "active": true,
      "leadHoopId": "confirmed-campus-routing-value",
      "programs": [
        {
          "id": "confirmed-production-program-id",
          "name": "Confirmed program name",
          "displayOrder": 1,
          "active": true,
          "leadHoopId": "confirmed-program-routing-value"
        }
      ]
    }
  ]
}
```

Use only confirmed stable production IDs, names, ordering, active states, and mappings. The shared availability validator rejects preview IDs in production and requires mappings for active production options. To pause a campus or one campus/program combination, change its `active` flag to `false` in the server-only file and deploy the change; the function reads current availability for each request, so an option paused after a form was opened is rejected. Reactivate only after the authorized availability owner confirms it; there is no monthly automatic reactivation or public availability-management endpoint. Do not expose credentials or create a browser-side administrative interface.

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
