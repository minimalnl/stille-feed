# Hup proxy (Cloudflare Worker)

Hup's API (`hup.social/api/v1/...`) sends no CORS headers, so the feed on GitHub Pages can't read it directly.

The feed doesn't depend on it: Hup posts are read straight from the Hup contract's events on LUKSO mainnet
(one `eth_getLogs` for all posts, content from IPFS, cached in the browser), and "Show more" pages through
that list. This Worker is a **fallback**: when the RPC can't return those events, the feed asks the Hup API
through the Worker instead of showing "View the posts on Hup". Nice to have, not required.

Note: the chain lists every post event of the profile; the API (`post_type=original`) lists only original
posts, so the two can differ slightly (the API hides replies).

What it does, nothing more:
- only `GET /api/v1/networks/posts` (everything else: 404, other methods: 405)
- only the query parameters `wallet_address`, `network_id`, `post_type`, `limit`, `page`, validated
- CORS for the origins in `ALLOWED_ORIGINS` (`wrangler.toml`)
- 60 seconds cache at Cloudflare; no logging, no secrets, no storage

Cost: free (Cloudflare Workers free plan: 100,000 requests per day).

## Deploy (one time, about 10 minutes)

1. Create a free account at https://dash.cloudflare.com/sign-up (no domain or card needed).
2. Easiest, in the browser: Workers & Pages → Create → Create Worker → name it `quiet-feed-hup` → Deploy.
   Then "Edit code", replace everything with the contents of `hup-proxy.js`, and Deploy.
   Under Settings → Variables and Secrets add a text variable `ALLOWED_ORIGINS` with
   `https://minimalnl.github.io,http://localhost:8080`.
   Or, from a terminal in this folder: `npx wrangler login` and `npx wrangler deploy`.
3. Copy the Worker URL, e.g. `https://quiet-feed-hup.<your-subdomain>.workers.dev`.
4. Put it in `app.js`, in the line `const HUP_PROXY = '';` (no trailing slash), commit and push.
   GitHub Pages redeploys by itself.

Check it works:

    curl -i "https://quiet-feed-hup.<your-subdomain>.workers.dev/api/v1/networks/posts?wallet_address=0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1&network_id=42&post_type=original&limit=2&page=1"

You should get `200` with JSON and an `access-control-allow-origin` header (when sent with an allowed `Origin`).

If you later add a custom domain for the feed, add it to `ALLOWED_ORIGINS` too.
