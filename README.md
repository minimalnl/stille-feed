# stille feed

_(formerly "Quiet Feed" — lowercase Dutch for "quiet feed".)_

Read-only view of one LUKSO Universal Profile: LSP3 profile (name, photo, tags),
Burnt Pix owned by the profile, and Forever Moments and Hup posts, sorted together by time.
The posts section opens with the two latest. Show more reveals the next ones. A small red seal
beside the tabs hides it, and the same seal brings it back; the choice is remembered in
`localStorage` as `qf.hideSocial`.
At the bottom a small "tip the creator" block to mint 1-5 Generative Grid pieces (testnet for now).

**Three themes:** Black, White, and Art (cream/sage, the default). A small square in the bottom-right
opens the three choices upward. The saved values stay `zwart`, `wit`, and `kunstobject`
(`localStorage` key `qf.theme`, and `?theme=`). `black`, `white`, and `art` are accepted and stored as those keys.

Which profile is shown (first match wins):
1. Inside the LUKSO Grid: the owner of that Grid (up-provider `contextAccounts`).
2. `?address=0x…` in the URL.
3. The address a visitor typed earlier (saved in `localStorage` as `qf:address`).
4. The default address below.

Typing an address and pressing View saves it (and puts it in the URL to share); View with an empty field
forgets it. Inside the Grid a typed address also wins until the page reloads.

One Burnt Pix from Mark's collection (`0x7070b7Cb8fAe99B6C7DDd0eaBe831DCb6c3047FD`) can be opened on its own.
Each token id is 32 bytes: 12 zero bytes, then the 20-byte address of that piece's fractal contract.

- `?pix=` — the first 8 hex characters of that address.
  <https://minimalnl.github.io/stille-feed/?pix=9bf4ee85> opens token
  `0x0000000000000000000000009bf4ee85e0205431abcd06091ce98e65a48cd8e5`.
- `?id=` — all 40 hex characters of that address (the last 40 of the token id). A full 64-hex token id is
  accepted too. <https://minimalnl.github.io/stille-feed/?id=9bf4ee85e0205431abcd06091ce98e65a48cd8e5>

Both work next to `?address=` and `?theme=`. A link is resolved in the profile on screen first, then in Mark's
collection, so `?pix=9bf4ee85` still opens when the feed is another profile. The page shows the image large,
the iteration count, a link to the piece on Universal Everything, and a link to that piece's owner. The owner
link opens their profile with their biggest Burnt Pix leading, and drops `?pix=` / `?id=`. An unknown or
malformed value leaves the normal feed in place, with a short note, and does not substitute another piece.
The 8-hex prefixes are unique across the collection today; if two pieces ever share one, every match is
shown, ordered by token id.

With no `?pix=` or `?id=`, the profile's biggest piece (most iterations, then the lowest token id) leads in
the large view. That choice is not written into the URL, so the profile link keeps meaning "their current
biggest". A thumbnail click opens that piece large and sets `?pix=` plus `?address=` via history, so Back
works and the link can be shared. The View form clears `?pix=` and `?id=` when the address changes. The
arrow on the right (and a horizontal swipe) moves to the next-smaller piece in that same order, wrapping
from the smallest back to the biggest. It stays hidden when the open piece is not in the profile on screen,
and when that profile has fewer than two pieces. A bare `?pix=` or `?id=` link (no `?address=`) that resolves
in Mark's collection shows that collection underneath, and the arrow with it. The arrow continues from
the opened piece: the next click is the next-smaller one, then on down, wrapping at the end.
The document title names the iteration count only when a piece link is in the URL.
The large picture is fetched before the profile, the posts, and the thumbnail grid. Those wait until it has loaded.

Link-preview tags (`og:image`, `og:title`) are not generated per piece. GitHub Pages serves one `index.html`,
and a crawler does not get different meta tags for a query string. Per-piece previews would need a static page
per pix (for example `/p/9bf4ee85/`) plus a raster image: each picture is an on-chain SVG of about 250 KB, and
the collection is more than two thousand pieces. The thumbnail job only covers the one Burnt Pix on the default
profile, so that workflow was not extended.

Run locally:

    python3 serve.py 8080
    # open http://localhost:8080/  or  http://localhost:8080/?address=0x…

Default address: 0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1 (@mark on Hup).

Sources:
- LSP3: eth_call getData(LSP3Profile) on https://rpc.mainnet.lukso.network, JSON via api.universalprofile.cloud/ipfs
- Burnt Pix: contract 0x3983151e0442906000dab83c8b1cf3f2d2535f82 (LSP8). tokenIdsOf(address) and per piece
  getDataForTokenId(id, LSP4Metadata); the image is fully on-chain as SVG. All via the same RPC.
- Forever Moments: https://www.forevermoments.life/api/public/v1/moments?owner=… (CORS enabled)
- Hup: the post events of the Hup contract 0xf6eeC4e32a532b23ACC56b72865e79c79877CEc8 (one eth_getLogs),
  content from IPFS. Fallback: https://hup.social/api/v1/networks/posts (no CORS: via serve.py's /hup-api/*
  locally, or the optional Cloudflare Worker in `worker/` once `HUP_PROXY` in app.js is set). If both fail,
  the page shows a link to the Hup profile instead of an error.

Speed:
- Feed sources render as soon as each one arrives (skeletons meanwhile); scripts are `defer`red.
- RPC calls are batched (JSON-RPC arrays); profile, Burnt Pix lists and IPFS JSON are cached in `localStorage`
  (10 minutes for things that change, a week for IPFS content and block times).
- Images go through api.universalprofile.cloud/image/<cid>?width=… (720 px for one image, 360 px in a grid,
  2x on retina; same format, so GIFs keep moving). If the resizer fails, the original loads.
- The Generative Square block stays a small hint until it is opened. p5.js, the preview, and the mint
  connection load only then.
- Burnt Pix images below the first screen wait until their card is near the viewport. A piece already
  shown large is not fetched a second time.

Generative Grid (tip-the-creator block, `grid-ad.js`):
- Pick 1-5 and mint. The contract has a single exact-price `mint()` per piece (no batch), so 3 pieces are
  3 transactions with 3 wallet confirmations, one after the other. Before each one the block reads the price of
  that exact number from the contract and simulates the mint; it never pays more than the total on the button,
  checks the balance first, and stops cleanly on sold out, a price change, a rejection or a failed transaction
  (a reverted mint only costs gas). Buttons are locked while minting (no double mints from double clicks).
- p5.js is loaded with Subresource Integrity; the on-chain script is cached per contract address.
- Inside the LUKSO Grid it mints via up-provider; in a normal browser via the Universal Profile extension
  (EIP-6963, `window.lukso`, fallback `window.ethereum`), switching/adding LUKSO Testnet (4201) when needed.
- `?gg=<number>` shows that minted piece in the preview.
- Token images: the contract's computed `tokenMetadataJSON` is immutable. It still points at `gg/<chainId>/<n>.png`
  (2400 px) and `<n>-600.png`. `scripts/build-gg.mjs` renders both with the on-chain script + seed in headless Chrome
  (same HTML as the preview); the Pages workflow runs it every 15 minutes and only deploys when there are new mints.
  The 600 px files stay on the site for that computed metadata.
- Universal Everything follows the per-token LSP4 override (`getDataForTokenId`), not the computed JSON, when an
  override is set. The owner-only "Fix images for UE" button writes that override so both `icon` and `images` are the
  2400 px file. It skips tokens that already store that override. A new mint still gets the contract's computed
  metadata until the owner runs the button again. The button never changes price, supply, or ownership.
