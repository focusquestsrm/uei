# UEI Back2Learn landing page preview

This is a standalone, local-first UEI page scaffold. **It is not launch-ready and does not submit leads.** The supplied archive includes the UEI campaign brief and the April 6, 2026 IEC Marketing Vendor Guidelines. The page uses approved general UEI copy, Open Sans, the specified UEI palette, required qualifications for program-length, financial-aid, and career-placement claims, the supplied TCPA disclosure, and the specified privacy-policy URL. The archive has no separate UEI logo image; the guideline’s Canto download link could not be opened, so the page uses text-only Back2Learn/UEI labels rather than an invented or low-quality logo. The UMA branch image directory contains a UMA logo and other campaign assets but no identifiable Back2Learn logo.

## Reference verification and source-selection hold

The requested reference is [focusquestsrm/uma-landing-page](https://github.com/focusquestsrm/uma-landing-page), branch `fallon-duplicate`; its latest branch commit reported by GitHub was `2076e82b2ad13fb5874a83a396bcb0a4db250f49`. No UMA code or assets were copied. The README identifies `src/data/uma-kayla-programs.csv`, but describes the implementation as the “approved Fallon UMA experience,” a campaign-identity conflict. The live `https://uma.back2learn.com/` page does not expose a verifiable source commit, so whether production matches that branch cannot be confirmed.

The branch’s `src/js/phone.js` normalizes the phone before browser submission, and `netlify/functions/_shared/submit-lead-handler.js` uses that phone helper to validate and normalize on the server. The normalization commit is the branch tip. These checks establish the requested hotfix evidence, but do not resolve the campaign identity conflict; source selection was therefore paused and no UMA code or campaign settings were adopted.

## Local setup

Requires Node.js 18 or later. No third-party npm dependencies are required.

```powershell
npm install
npm test
npm run build
npx netlify dev
```

Open the local URL printed by Netlify Dev. The static page can also be inspected directly, but the campus/program data endpoint is served with no-cache headers and the serverless function requires Netlify Dev for full interaction testing.

## Campus/program data and availability

Edit `src/data/uei-campus-programs.json` only with the latest UEI-approved Sparkroom matrix and confirmed LeadHoop mappings. Use this shape:

```json
{
  "previewOnly": false,
  "campuses": [
    {
      "id": "confirmed-stable-campus-id",
      "name": "Confirmed campus name",
      "displayOrder": 1,
      "active": true,
      "programs": [
        {
          "id": "confirmed-stable-program-id",
          "name": "Confirmed program name",
          "displayOrder": 1,
          "active": true
        }
      ]
    }
  ]
}
```

The identifiers above are illustrative shape only and must not be used. The checked-in file deliberately has `previewOnly: true` and an empty campus list. Do not change it to live configuration until all identifiers, names, mappings, and eligibility rules have been confirmed.

To pause a campus, set its `active` value to `false`; to pause one campus/program combination, set that program’s `active` value to `false`. Reactivate only after approval by setting the same value back to `true`. Commit and deploy the updated data with the page. The browser filters program choices by the currently selected campus; changing campus clears the selected program. The submission function reads the current server-side data on every request and rejects a paused campus, paused program, invalid pairing, or preview-only selection, including selections made before availability changed. There is no monthly automatic reactivation and no browser-exposed management endpoint or secret.

## Lead integration status

`LEAD_SUBMISSION_ENABLED` is `false` in `.env.example`, no endpoint or credentials are present, and the function fails closed. No LeadHoop requests are made by the current implementation. Before implementation can be completed, obtain and validate:

- The supplied brief identifies Jordan as the traffic source and LeadHoop campaign 12213. The admin URL redirects to sign-in, so obtain an authorized export of the posting specifications: endpoint, campaign/posting code, required fields, authorization method, FPI, response/redirect rules, and field-level requirements. Do not infer these values from the URL.
- Confirmed UEI campus/program-to-LeadHoop mappings, current campus availability, and all eligibility rules. The April 2026 marketing PDF includes a campus/program list, but explicitly directs vendors to the latest Sparkroom matrix; treat that list as reference material only.
- An approved UEI logo file from the asset library linked in the guidelines.
- Any consent requirements for Meta Pixel, TrustedForm, or Jornaya.
- Confirmed deduplication/idempotency behavior and accepted and rejected redirect destinations.
- Any required address fields, address rules, attribution mappings for `fbclid`, `_fbc`, and `_fbp`, and approved demographic answers/mappings if required. No Google Maps or Places integration is present.
- Confirmation of the production domain. `uei.back2learn.com` is only a proposal.

After specs are available, implement the confirmed LeadHoop mapping and protected request flow server-side, add a durable deduplication store, implement and test ambiguous-response handling, and keep accepted/rejected redirects separately configured. Do not enable submissions or send test/production leads until review and explicit authorization. Add Meta Pixel, TrustedForm, and Jornaya only as individually confirmed; the environment placeholders contain no identifiers and do not activate them. A successful conversion event must be added only after a confirmed accepted response.

The form includes contact validation and an unchecked consent control with the approved UEI TCPA copy and privacy link. Attribution query values are retained under their original names without assigning any to LeadHoop fields. Submission remains blocked in preview and the live posting integration is intentionally not implemented.

## Deployment

This project includes `netlify.toml` for Netlify static publishing and functions. Use a review deploy only after the missing UEI materials are added. Keep secrets in protected Netlify environment variables; never place authorization, FPI, routing values, or lead data in browser code, repository files, logs, or responses. `uei.back2learn.com` is not confirmed. This task did not deploy, push, merge, or modify DNS.
