# Quiet Feed

Read-only view of one LUKSO Universal Profile: LSP3 profile (name, photo, tags),
Burnt Pix owned by the profile, and the latest Forever Moments and Hup posts, sorted together by time. No wallet, no LYX.

Run locally:

    python3 serve.py 8080
    # open http://localhost:8080/  or  http://localhost:8080/?address=0x…

Default address: 0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1 (@mark on Hup).

Sources:
- LSP3: eth_call getData(LSP3Profile) on https://rpc.mainnet.lukso.network, JSON via api.universalprofile.cloud/ipfs
- Burnt Pix: contract 0x3983151e0442906000dab83c8b1cf3f2d2535f82 (LSP8). tokenIdsOf(address) and per piece
  getDataForTokenId(id, LSP4Metadata); the image is fully on-chain as SVG. All via the same RPC.
- Forever Moments: https://www.forevermoments.life/api/public/v1/moments?owner=… (CORS enabled)
- Hup: https://hup.social/api/v1/networks/posts?wallet_address=…&network_id=42&post_type=original
  Hup doesn't send CORS headers, so serve.py proxies this as /hup-api/* (GET only).
  On static hosting (e.g. GitHub Pages) the page shows a message with a link to the Hup profile instead of an error.
