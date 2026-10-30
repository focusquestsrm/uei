import { getStore } from '@netlify/blobs';
import idempotency from './submission-idempotency.js';
import handlerModule from './submit-lead-handler.js';

idempotency.configureNetlifyStore(getStore);

// The client address comes only from the platform; request bodies and spoofable
// forwarding headers are never trusted. No address means no post.
export async function handleRequest(request, context, overrides) {
  const body = request.method === 'POST' ? await request.text() : '';
  const clientIp = (request.headers.get('x-nf-client-connection-ip') || (context && context.ip) || '').trim();
  const result = await handlerModule.handleSubmission({
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    clientIp
  }, Object.assign({ requestId: context && context.requestId }, overrides));
  return new Response(result.body || '', { status: result.statusCode || 500, headers: result.headers || {} });
}
