# P2P Prior Art for Kosmos Collaboration (verified alive Aug 2026)

## (a) State-sync engines

**Yjs ecosystem** (MIT; core very active). `y-websocket` 3.1.0 published Jul 2026 (~440k weekly DLs) — healthy client/server lane with many backends (Hocuspocus, y-sweet). `y-webrtc` (MIT): last npm publish ~2024 → **unmaintained in practice** though functional. Pairing = shared room name; optional `password` encrypts *all* signaling incl. SDP so public signaling servers learn nothing. No bundled TURN → symmetric-NAT pairs just fail.
Steal: encryption-over-untrusted-discovery. Hurts us: stale simple-peer dep, decaying public signalers. https://github.com/yjs/y-webrtc · https://www.npmjs.com/package/y-websocket

**Automerge + automerge-repo** (MIT, active): cleanest transport architecture — swappable network adapters (BroadcastChannel, MessageChannel, WebSocket, node fs) plus a one-line reference sync server (`npx @automerge/automerge-repo-sync-server`). Steal: adapter-swappable stack so we can ship LAN BroadcastChannel today, WebRTC tomorrow. https://github.com/automerge/automerge-repo

**Loro** (MIT): hit 1.0 Jun 2026, patch releases through Aug 2026; Rust/WASM. "Shallow snapshot" = git-shallow-clone-style history truncation. Steal: compaction for years-long book projects. https://loro.dev/blog/v1.0

**cr-sqlite** (Apache-2.0): still 0.x (v0.16.2 Jan 2026), single-maintainer, its v2 causal-event-log design remains unimplemented. Watch, don't build on it. https://github.com/vlcn-io/cr-sqlite

## (b) File-transfer & pairing patterns

**Syncthing** (MPL-2.0, active v2.x). Pairing UX: copy/QR your device ID (cert fingerprint) to the other side, they accept a popup; folders then attach. The **introducer** flag makes a trusted peer auto-add *its* peers. Hard-NAT handling: global discovery servers + community relay pool; relays are E2E-encrypted dumb pipes used only when direct fails, with periodic direct retries and transparent upgrade. Syncs whole files, never merges content.
Steal: relay-fallback-with-upgrade; introducer. Hurts us: file-level sync can't merge flags/notes. https://docs.syncthing.net/users/relaying.html · https://docs.syncthing.net/users/introducer.html

**croc** (MIT, active v9.6.x). Best pairing UX studied: sender gets a short word-chain code phrase; recipient types it; PAKE derives the key (relay never learns secret or data); relay introduces, direct P2P attempted, relay carries traffic if NAT wins; transfers resume. Self-hostable relay.
Steal: code-phrase PAKE join — no accounts, works for non-technical users. Hurts us: send-and-done, not continuous sync. https://github.com/schollz/croc

**WebTorrent / Instant.io** (MIT, online). Zero-friction sharing where the magnet/infohash *is* the credential — meaning zero privacy; instant.io itself now points users to Wormhole for E2E. Streams before download completes (piece selection).
Steal: stream-play audio takes while bytes arrive. Hurts us: no confidentiality by default — disqualifying under NDA. https://instant.io

**Tailscale Taildrop + MagicDNS** (client BSD-ish/source-available; feature alpha). Right-click → Send to a device by human-readable name over encrypted P2P; resumes interrupted transfers. Hard limit: **your own devices only** — cannot reach another person's machine.
Steal: friendly persistent device names instead of hex IDs. Hurts us: identity is account-bound; author↔narrator spans two identities. https://tailscale.com/docs/features/taildrop

## (c) Full apps closest to what we're building

**Anytype** — any-sync protocol MIT, app source-available (ASAL). CRDT spaces, E2E, creator-controlled keys; mDNS LAN P2P plus backup/sync nodes; explicit local-only mode; an online device acts as **bridge** carrying a LAN-only peer's changes to the wider network; per-object sync status UI.
Hurts us: app license forbids forking the client wholesale. https://tech.anytype.io/any-sync/overview

**Keet (Holepunch/Pear)** — shipped Electron P2P chat/video, current 2026. Hyperswarm DHT hole-punching, blind-pairing invites admit new writers into Autobase multi-writer logs. Steal: invite-blob membership. Hurts us: bespoke Pear/Bare runtime, hard to adopt piecemeal. https://keet.io · https://docs.pears.com/getting-started/build-a-peer-to-peer-chat

**Colanode** (Apache-2.0, v0.4.7 Apr 2026) — Electron local-first Slack/Notion alt: Yjs + SQLite clients against a self-hosted Postgres/Redis server. Their own lesson: CRDTs fit pages/records, **not messages/files** — validates our two-lane design (CRDT doc for pickups/flags/glossary/notes; content-addressed blob transfer for WAV/MP3 takes). Hurts us: mandatory server ≠ free-first P2P. https://github.com/colanode/colanode

## Steal list

1. **Code-phrase PAKE pairing** (croc): one short phrase pairs two seats; PAKE means even our relay/discovery infra can't read or MITM. https://github.com/schollz/croc
2. **Relay fallback with direct upgrade** (Syncthing): default-on community relays behind hard NATs, E2E-encrypted, silent upgrade when hole-punch succeeds. https://docs.syncthing.net/users/relaying.html
3. **Introducer auto-add** (Syncthing): narrator invites producer #3 by trusting an existing seat — no second pairing ceremony. https://docs.syncthing.net/users/introducer.html
4. **Room-key-encrypted signaling** (y-webrtc): treat discovery servers as hostile; encrypt SDP/handshake under the session passphrase. https://github.com/yjs/y-webrtc
5. **Shallow-snapshot compaction** (Loro): periodically truncate update-log history so decade-old books don't drag megabytes of CRDT ops. https://loro.dev/blog/v1.0
