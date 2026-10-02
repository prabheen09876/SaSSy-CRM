// @ts-check

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const ALLOWED_HEADERS = new Set(['authorization', 'content-type', 'x-workspace-id'])
const UPSTREAM_TIMEOUT_MS = 8000

class GatewayError extends Error {
  /** @param {number} status @param {string} code */
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

/** @param {string} input @param {boolean} allowLocalhost */
function originUrl(input, allowLocalhost) {
  const url = new URL(input)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new GatewayError(503, 'gateway_not_configured')
  }
  if (url.protocol !== 'https:' && !(allowLocalhost && url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new GatewayError(503, 'gateway_not_configured')
  }
  return url
}

/** @param {Env} env */
function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || '')
  if (configured.length > 4096) throw new GatewayError(503, 'gateway_not_configured')
  const origins = configured.split(',').map(value => value.trim()).filter(Boolean)
  if (origins.length > 20) throw new GatewayError(503, 'gateway_not_configured')
  for (const origin of origins) {
    if (originUrl(origin, env.ALLOW_LOCALHOST === 'true').origin !== origin) {
      throw new GatewayError(503, 'gateway_not_configured')
    }
  }
  return new Set(origins)
}

/** Only a public key is accepted. This is a guard against pasting an elevated key,
 * not JWT authentication: Supabase verifies the caller token on every request.
 * @param {string} key */
function isPublicKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true
  const parts = key.split('.')
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))
    return payload !== null && typeof payload === 'object' && payload.role === 'anon'
  } catch {
    return false
  }
}

/** @param {Env} env */
function databaseConfig(env) {
  const key = String(env.SUPABASE_PUBLIC_KEY || '').trim()
  const configuredUrl = String(env.SUPABASE_URL || '').trim()
  if (!configuredUrl || configuredUrl.length > 2048 || key.length > 8192 || !isPublicKey(key)) {
    throw new GatewayError(503, 'gateway_not_configured')
  }
  const url = originUrl(configuredUrl, env.ALLOW_LOCALHOST === 'true')
  return { origin: url.origin, key }
}

/** @param {unknown} payload @param {number} status @param {string | null} origin @param {HeadersInit} [extra] */
function json(payload, status, origin, extra = {}) {
  const headers = new Headers(extra)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Vary', 'Origin')
  if (origin) headers.set('Access-Control-Allow-Origin', origin)
  return new Response(JSON.stringify(payload), { status, headers })
}

/** Bounded, abortable reads also protect against a misleading Content-Length.
 * @param {Response} response @param {number} maximum @param {AbortSignal} signal
 * @returns {Promise<unknown>} */
async function boundedJson(response, maximum, signal) {
  if (!response.body) throw new GatewayError(502, 'upstream_unavailable')
  const reader = response.body.getReader()
  const abortRead = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abortRead, { once: true })
  let size = 0
  let text = ''
  const decoder = new TextDecoder()
  try {
    if (Number(response.headers.get('Content-Length')) > maximum) {
      throw new GatewayError(502, 'upstream_unavailable')
    }
    while (true) {
      if (signal.aborted) throw new GatewayError(504, 'upstream_timeout')
      const { done, value } = await reader.read()
      if (signal.aborted) throw new GatewayError(504, 'upstream_timeout')
      if (done) break
      size += value.byteLength
      if (size > maximum) throw new GatewayError(502, 'upstream_unavailable')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } finally {
    signal.removeEventListener('abort', abortRead)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** @param {Request} request @param {Env} env @param {typeof fetch} fetcher */
async function validateWorkspace(request, env, fetcher) {
  const authorization = request.headers.get('Authorization') || ''
  if (authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/i.test(authorization)) {
    throw new GatewayError(401, 'sign_in_required')
  }
  const workspaceId = request.headers.get('x-workspace-id') || ''
  if (!UUID.test(workspaceId)) throw new GatewayError(400, 'workspace_required')
  const { origin, key } = databaseConfig(env)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  const headers = { Authorization: authorization, apikey: key, Accept: 'application/json' }
  try {
    const userResponse = await fetcher(`${origin}/auth/v1/user`, {
      method: 'GET', headers, redirect: 'manual', signal: controller.signal,
    })
    if (userResponse.status === 401 || userResponse.status === 403) {
      await userResponse.body?.cancel()
      throw new GatewayError(401, 'sign_in_required')
    }
    if (!userResponse.ok) {
      await userResponse.body?.cancel()
      throw new GatewayError(502, 'upstream_unavailable')
    }
    const user = await boundedJson(userResponse, 64 * 1024, controller.signal)
    if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !UUID.test(user.id)) {
      throw new GatewayError(401, 'sign_in_required')
    }

    // This RPC reads x-workspace-id and auth.uid() in saas.sql. Never use a
    // service-role key or trust a browser-provided workspace without this check.
    const membershipResponse = await fetcher(`${origin}/rest/v1/rpc/is_staff`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
      body: '{}', redirect: 'manual', signal: controller.signal,
    })
    if (membershipResponse.status === 401 || membershipResponse.status === 403) {
      await membershipResponse.body?.cancel()
      throw new GatewayError(403, 'workspace_access_denied')
    }
    if (!membershipResponse.ok) {
      await membershipResponse.body?.cancel()
      throw new GatewayError(502, 'upstream_unavailable')
    }
    const isStaff = await boundedJson(membershipResponse, 1024, controller.signal)
    if (isStaff !== true) throw new GatewayError(403, 'workspace_access_denied')
  } catch (error) {
    if (controller.signal.aborted) throw new GatewayError(504, 'upstream_timeout')
    if (error instanceof GatewayError) throw error
    throw new GatewayError(502, 'upstream_unavailable')
  } finally {
    clearTimeout(timeout)
  }
}

/** Dependency injection is for offline tests; no destination is taken from the request.
 * @param {Request} request @param {Env} env @param {typeof fetch} [fetcher]
 * @returns {Promise<Response>} */
export async function handleGateway(request, env, fetcher = fetch) {
  /** @type {string | null} */
  let origin = null
  try {
    const origins = allowedOrigins(env)
    const requestedOrigin = request.headers.get('Origin')
    if (requestedOrigin && !origins.has(requestedOrigin)) {
      throw new GatewayError(403, 'origin_not_allowed')
    }
    origin = requestedOrigin
    const path = new URL(request.url).pathname
    if (path !== '/health' && path !== '/public/health') {
      return json({ ok: false, error: 'not_found' }, 404, origin)
    }
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('Access-Control-Request-Method')
      const headers = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
      if (!origin || method !== 'GET' || headers.some(header => !ALLOWED_HEADERS.has(header))) {
        throw new GatewayError(403, 'preflight_not_allowed')
      }
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, x-workspace-id',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
        'Cache-Control': 'no-store',
      } })
    }
    if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405, origin, { Allow: 'GET, OPTIONS' })
    if (path === '/public/health') return json({ ok: true, service: 'workspace-crm', version: 1 }, 200, origin)

    await validateWorkspace(request, env, fetcher)
    return json({
      ok: true, integrationsConnected: true, database: true,
      features: { email: false, whatsapp: false, ai: 'none', push: false },
    }, 200, origin)
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 503
    const code = error instanceof GatewayError ? error.code : 'gateway_not_configured'
    // Do not log request headers, URLs, identity, provider payloads, or exceptions.
    if (status >= 500) console.error(JSON.stringify({ event: 'gateway_check_failed', code }))
    return json({ ok: false, error: code }, status, origin, status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {})
  }
}

/** @satisfies {ExportedHandler<Env>} */
export default {
  fetch(request, env) {
    return handleGateway(request, env)
  },
}
