# Stille feed

Rustige, alleen-lezen weergave van één LUKSO Universal Profile: LSP3-profiel (naam, foto, tags),
de Burnt Pix die het profiel bezit, en de nieuwste Forever Moments en Hup-posts, samen op tijd gesorteerd. Geen wallet, geen LYX.

Starten:

    python3 serve.py 8080
    # open http://localhost:8080/  of  http://localhost:8080/?address=0x…

Standaardadres: 0xeccedbdad7dae297d1ef1134cca43cdfc2857bd1 (@mark op Hup).

Bronnen:
- LSP3: eth_call getData(LSP3Profile) op https://rpc.mainnet.lukso.network, JSON via api.universalprofile.cloud/ipfs
- Burnt Pix: contract 0x3983151e0442906000dab83c8b1cf3f2d2535f82 (LSP8). tokenIdsOf(adres) en per stuk
  getDataForTokenId(id, LSP4Metadata); het beeld staat volledig on-chain als SVG. Alles via dezelfde RPC.
- Forever Moments: https://www.forevermoments.life/api/public/v1/moments?owner=… (CORS open)
- Hup: https://hup.social/api/v1/networks/posts?wallet_address=…&network_id=42&post_type=original
  Hup stuurt geen CORS-headers, daarom proxyt serve.py dit als /hup-api/* (alleen GET).
  Op statische hosting (bijv. GitHub Pages) toont de pagina dan een rustige melding met een link naar
  het Hup-profiel in plaats van een foutmelding.
