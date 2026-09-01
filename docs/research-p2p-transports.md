# P2P Transports for Kosmos Cross-Network Sync
($0-first, no accounts, minimal server trust, Electron-native)

## 1. Ranked comparison

| Transport | Cross-NAT success | Small-msg latency | 100 MB file | TURN? | Signaling? | Account? | Free-tier reality | License | Maintenance |
|---|---|---|---|---|---|---|---|---|---|
| **1. WebRTC DataChannel** (Electron's Chromium) | ~75–80% STUN-only; ~99% w/TURN [1][2] | ≈network RTT direct | ~18 MB/s direct [3]; uplink-bound online | Only symmetric-NAT pairs | Yes (QR/copy-paste or Trystero) | None | TURN: metered 20 GB/mo [4], Cloudflare 1 TB/mo [5] | MIT (Trystero) / BSD-2 (@roamhq/wrtc) [6][7] | simple-peer dormant since 2022 [8]; use raw API or Trystero [6] |
| 2. Tiny E2E-encrypted WebSocket relay (Cloudflare Worker/Durable Object) | ~100% (is a relay) | +1 relay hop | Relay-bound; fine | n/a | n/a — it *is* transport | Developer only | Workers free: 100k req/day incl. DO WebSockets [9] | Your code | Actively maintained |
| 3. Tailscale/Headscale tunnel | ~100%; DERP always connects [10] | Direct ≈RTT; DERP slower | Line-rate direct; DERP much slower [10] | n/a (DERP instead) | Built-in | **Yes** (both install + log in) | Personal: 6 users, unlimited devices [11] | Clients OSS; Headscale OSS | Excellent |
| 4. libp2p WebRTC + circuit relay | Good w/relay; browser↔browser needs self-run relay node [12] | WebRTC + extra RTTs | Fine | Relay replaces TURN | Built-in via relay | None | Self-run relay ≈$5 VPS | MIT/Apache-2.0 | Active; go-libp2p browser↔browser partial [12] |
| 5. Syncthing-style daemon | High (discovery + community relays) [13] | Periodic sync, not realtime | Strong: block-level, resumable | n/a | n/a | None | Community relays/discovery free [13] | MPL-2.0 | Active |
| 6. WebTorrent/IPFS content addressing | Moderate (DHT+tracker+STUN) | Poor fit for live state | Swarm-dependent, slow in practice | n/a | Tracker/DHT | None | Public trackers free | Mixed | js-ipfs deprecated → Helia [14]; churn risk |

## 2. NAT traversal facts

- Chrome UMA field data: ~75–80% of consumer sessions connect directly; ~20–25% need relay [1]. appear.in production: ~20% TURN globally, ~10% US-only [2].
- Symmetric NAT and carrier CGNAT defeat UDP hole-punching entirely; TURN (UDP → TCP → TLS:443) is the only reliable cure [1].
- Electron ships Chromium's WebRTC — TURN is just `iceServers` config; embed managed free TURN or self-host coturn (BSD) [15].
- Actually-free TURN, 2026: **Metered Open Relay** — 20 GB/mo, UDP/TCP ports 80+443, static public creds [4]. **Cloudflare Realtime TURN** — 1 TB/mo free, then $0.05/GB, anycast, TLS 443 [5]. **Self-hosted coturn** — free software, ~$5/mo flat VPS [15]. STUN free: stun.cloudflare.com [5].

## 3. Zero-account signaling

- **Manual copy-paste** SDP offer/answer blob — zero servers, clunkiest UX.
- **QR handshake** — nicer UX: render compressed offer as QR; peer scans it.
- **LAN-first** mDNS discovery (Chromium emits mDNS candidates); manual invite only when remote.
- **Serverless**: Trystero (MIT, active) exchanges SDP over public Nostr/MQTT/BitTorrent relays — nothing deployed; SDP AES-GCM-encrypted; payloads never touch those mediums [6].
- **Hosted free**: PeerJS Cloud — no account, no hard cap per maintainers, best-effort/no SLA [16][17]. Metered Realtime — 100 conns / 100k msgs-mo free, auto-injects TURN [18].

## 4. Bottom line for Kosmos

**Primary:** WebRTC DataChannel on Electron's built-in renderer WebRTC. STUN: stun.cloudflare.com. TURN: Metered default + Cloudflare second pool (100 MB take ≈ ≤0.5% of monthly allowance). Signaling: QR/copy-paste invite (zero third-party dependency) + optional Trystero-Nostr layer. DTLS encrypts end-to-end by construction; stream chunks straight to disk.

**Fallback:** tiny E2E-encrypted WebSocket relay on Cloudflare Workers/DO free tier — still $0, still E2EE, one added hop.

**Honest catch:** when *both* peers sit behind symmetric NAT/carrier CGNAT (hotspots, some ISPs), direct P2P is impossible — every byte must relay. Free TURN quota then binds (Metered's 20 GB ≈ 200× 100 MB takes), so ship two TURN providers and auto-degrade to the WS fallback. Tailscale stays a power-user escape hatch but violates no-accounts.

## Sources

[1] getstream.io/resources/projects/webrtc/advanced/stun-turn
[2] stackoverflow.com/questions/52485365
[3] tuhat.helsinki.fi/ws/portalfiles/portal/167373638/Eskola_webrtc.pdf
[4] metered.ca/tools/openrelay
[5] developers.cloudflare.com/realtime/turn
[6] github.com/dmotz/trystero
[7] npmjs.com/package/@roamhq/wrtc
[8] npmjs.com/package/simple-peer
[9] developers.cloudflare.com/workers/platform/limits
[10] tailscale.com/docs/concepts/tailscale-encryption
[11] tailscale.com/docs/account/manage-plans/free-plans-discounts
[12] docs.libp2p.io/docs/browser-connectivity
[13] docs.syncthing.net/users/strelaysrv.html
[14] blog.ipfs.tech/202305-js-ipfs-deprecation-for-helia
[15] github.com/coturn/coturn
[16] peerjs.com/client/faq
[17] github.com/peers/peerjs/issues/997
[18] metered.ca/tools/openrelay/webrtc-signaling-server
