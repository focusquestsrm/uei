import { createRequire } from 'module';
import { getStore } from '@netlify/blobs';
import idempotency from './submission-idempotency.js';
import availabilityStore from './runtime-availability.js';
import handlerModule from './submit-lead-handler.js';

const require = createRequire(import.meta.url);
const campusConfig = require('../../../config/campus-programs.json');
const catalog = require('../../../src/js/catalog.js');

idempotency.configureNetlifyStore(getStore);
availabilityStore.configureNetlifyStore(getStore);

async function handleAvailabilityRequest() {
  const state = await availabilityStore.loadRuntimeAvailability({
    store: availabilityStore.getRuntimeAvailabilityStore()
  });
  const publicState = catalog.buildPublic(campusConfig, state);
  return new Response(JSON.stringify(publicState), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

// The client address comes only from the platform; request bodies and spoofable
// forwarding headers are never trusted. No address means no post.
export async function handleRequest(request, context, overrides) {
  const url = new URL(request.url);
  if ((overrides && overrides.mode === 'availability') || (request.method === 'GET' && (url.pathname === '/availability' || url.pathname.endsWith('/availability')))) {
    return handleAvailabilityRequest();
  }

  const body = request.method === 'POST' ? await request.text() : '';
  const clientIp = (request.headers.get('x-nf-client-connection-ip') || (context && context.ip) || '').trim();
  const result = await handlerModule.handleSubmission({
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    clientIp
  }, Object.assign({
    requestId: context && context.requestId,
    persistRuntimeAvailability: async function (state) {
      const store = availabilityStore.getRuntimeAvailabilityStore();
      try {
        const metadata = typeof store.getWithMetadata === 'function' ? await store.getWithMetadata('runtime-availability') : null;
        const payload = { consistency: 'strong' };
        if (metadata && metadata.etag) payload.onlyIfMatch = metadata.etag;
        await store.setJSON('runtime-availability', state, payload);
      } catch (error) {
        await store.setJSON('runtime-availability', state, { consistency: 'strong' });
      }
    }
  }, overrides));
  return new Response(result.body || '', { status: result.statusCode || 500, headers: result.headers || {} });
}
