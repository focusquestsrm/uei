import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function readEnvBoolean(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function readEnvString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

const publicConfig = {
  submissionEnabled: readEnvBoolean(process.env.LEAD_SUBMISSION_ENABLED, false),
  pixelId: readEnvString(process.env.META_PIXEL_ID, '1394019919533755'),
  siteUrl: readEnvString(process.env.PUBLIC_SITE_URL),
  consentUrl: readEnvString(process.env.UEI_PRIVACY_POLICY_URL, 'https://www.uei.edu/privacy-policy-terms/'),
  thankYouUrl: '/thank-you.html',
  testMode: readEnvBoolean(process.env.LEAD_TEST_MODE, true),
  publicProjection: true
};

const target = fileURLToPath(new URL('../src/js/runtime-config.js', import.meta.url));
await writeFile(target, `window.UEI_PUBLIC_CONFIG = Object.freeze(${JSON.stringify(publicConfig, null, 2)});\n`, 'utf8');
console.log(publicConfig.submissionEnabled ? 'Generated runtime config with live posting enabled.' : 'Generated public browser config without enabling live posting.');
