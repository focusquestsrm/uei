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
  const result = await availabilityStore.loadRuntimeAvailability({
    store: availabilityStore.getRuntimeAvailabilityStore()
  });
  if (result.status !== 'ok') {
    return new Response(JSON.stringify({
      code: result.status === 'missing' ? 'E_AVAILABILITY_UNINITIALIZED' : 'E_AVAILABILITY_STORAGE',
      message: result.status === 'missing' ? 'Runtime availability has not been initialized. Run the developer publish workflow before serving visitors.' : 'Runtime availability is temporarily unavailable. Please try again later.'
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }
  const publicState = catalog.buildPublic(campusConfig, result.state);
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
      let latest = await availabilityStore.loadRuntimeAvailability({ store });
      let attempt = 0;
      while (attempt < 3) {
        const candidate = state;
        const update = await availabilityStore.writeRuntimeAvailability(candidate, {
          store,
          ifMatch: latest && latest.etag ? latest.etag : undefined
        });
        if (update.status === 'ok') return update;
        if (update.status !== 'conflict') throw new Error(update.error || 'Runtime availability update failed.');
        latest = await availabilityStore.loadRuntimeAvailability({ store });
        attempt += 1;
      }
      throw new Error('Runtime availability update conflict retry limit reached.');
    }
  }, overrides));
  return new Response(result.body || '', { status: result.statusCode || 500, headers: result.headers || {} });
}
