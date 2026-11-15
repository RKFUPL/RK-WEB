# API rate limiting, proxy identity and public media caching

## Production request path audit

The checked-in Compose topology places `frontend` and `backend` on `rk-internal`; Next rewrites `/api/:path*` to `http://backend:5000/api/:path*`. Nginx is known to expose the app on the VPS, while Cloudflare is the public edge. The repository contains only an exact WhatsApp webhook Nginx snippet, not the active HTTPS server configuration, Cloudflare origin allowlist, real-IP directives, container subnets or deployed proxy addresses. Therefore the exact live Nginx-to-Next forwarding directives and production IP ranges cannot be confirmed from this checkout and were not inferred.

For traffic that reaches Flask through the Next rewrite, the Flask socket peer (`request.remote_addr`) is the Next container's address on the Compose bridge. Flask-Limiter's previous `get_remote_address` key therefore grouped storefront visitors behind that process into one bucket. The checked-in Next.js `proxy-request.js` passes the incoming request to `http-proxy`, which preserves custom request headers; `next.config.mjs` contains no verified overwrite for `X-RK-Verified-Client-IP`. A browser can therefore provide that header and have it reach Flask. Flask now ignores `X-RK-Verified-Client-IP`, `X-Forwarded-For`, and `CF-Connecting-IP` and keys by its direct peer until a server-side overwrite is verified.

## Implemented limiter behavior

There is no application-wide request quota now. Public read-only catalogue calls (including currency context, products, product details, collection listing/details and product media) do not consume a shared 200/hour bucket. Authentication, customer/staff order APIs and admin/staff APIs have bounded blueprint baselines; login/OTP/password reset and other sensitive operations retain or receive tighter endpoint limits. Razorpay create/verify/state and tokenized feedback/return submission have explicit limits.

Rate-limit keys are HMAC digests; logs do not contain a full IP or raw key. Client-IP forwarding headers are all ignored; invalid socket addresses map to an `unknown` bucket. No ProxyFix hop count or trusted proxy CIDR is configured.

Remaining deployment prerequisite: before per-visitor sensitive endpoint limits can use a client identity, inspect the active Nginx and Cloudflare settings. Cloudflare must be the only public path to the origin; Nginx must accept client-IP metadata only from the verified Cloudflare path and overwrite a server-only identity header; Next must forward that verified replacement; and Flask ingress must accept only expected proxy peers. Then add explicit trust only after an integration test proves a caller-supplied value is stripped/overwritten end to end. Do not infer proxy CIDRs or trust a header based only on Flask's Next-container peer. No production values were changed. Until then, sensitive endpoint limits key on the Next peer and can be shared by storefront visitors, but public catalogue reads have no global limit.

429 responses have a safe message, `Retry-After` and `X-RateLimit-Name`. Structured warnings record endpoint category, safe key type, IP-resolution source, HTTP status and limit string. They omit raw IP, authorization data and customer input.

## WorkDrive public product media

The route checks that the product is visible and the requested WorkDrive image is attached before consulting an in-process bounded cache. Cache entries are keyed by product ID, media ID and the source-derived version hash; every request repeats the database visibility/attachment check. Only successful image responses with a declared content length no larger than 8 MiB enter the process cache (15-minute TTL; 32 MiB total). Bounded striped per-process locks collapse simultaneous cache misses for the same URL while unrelated images can fetch concurrently. Larger or unknown-length responses preserve the existing streaming path. This cache is per worker process, not distributed across Gunicorn workers.

Versioned URLs receive a one-year browser cache policy with `immutable`, plus separate 24-hour CDN directives and stale handling. Non-versioned direct requests receive a short 5-minute shared-cache policy. A stale explicit `v` query is rejected with `no-store`; 404, 422, 503 and upstream WorkDrive rate-limit errors remain uncached. ETags continue to support conditional requests and derive from the source version, so changed media receives a new URL/ETag. WorkDrive authentication, product visibility and media permission checks remain on every origin request/cache hit.

Cloudflare's origin `Cloudflare-CDN-Cache-Control` header can set edge TTL separately from browser `Cache-Control`. This route has no filename extension, so confirm an applicable Cloudflare cache eligibility rule for the exact public versioned media path and verify the cache key includes the `v` query parameter before expecting edge HITs. Do not cache admin previews, OAuth material, or other private WorkDrive routes. No Cloudflare rule was changed or live edge behavior claimed here.

## Verification boundaries

Automated tests exercise distinct synthetic remote peers, spoofed forwarding headers against one shared peer, large collection reads, media error status, ETags and local concurrent cache misses. They do not prove the production Nginx overwrite, origin firewall, Cloudflare cache rule, deployed container IPs or public edge HIT rate. Those require read-only inspection of the active VPS and Cloudflare settings before safely adding trusted client-IP resolution.
