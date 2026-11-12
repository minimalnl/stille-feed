# stille feed

_(formerly "Quiet Feed" — lowercase Dutch for "quiet feed".)_

Read-only view of one LUKSO Universal Profile: LSP3 profile (name, photo, tags),
Burnt Pix owned by the profile, and the latest Forever Moments and Hup posts, sorted together by time.
At the bottom a small "tip the creator" block to mint 1-5 Generative Grid pieces (testnet for now).

**Three themes:** Zwart (dark), Wit (light), Kunstobject (cream/sage, default). The theme switcher is
in the bottom-right corner. Your choice persists across visits (localStorage + URL fallback).

Which profile is shown (first match wins):
1. Inside the LUKSO Grid: the owner of that Grid (up-provider `contextAccounts`).
2. `?address=0x…` in the URL.
3. The address a visitor typed earlier (saved in `localStorage` as `qf:address`).
4. The default address below.

Typing an address and pressing View saves it (and puts it in the URL to share); View with an empty field
forgets it. Inside the Grid a typed address also wins until the page reloads.

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
- The Generative Grid block (RPC, p5.js) only loads when you scroll near it.

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
