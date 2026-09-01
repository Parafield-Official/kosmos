# Kosmos real-time collab

## 1. Product definition

Kosmos stays offline-first; collab is a session layer between two paired machines.

**Syncs instantly** (small JSON over an encrypted WebRTC DataChannel): pickup/flag decisions with notes, chapter notes and status, glossary additions and respellings, room-check results, take-ready pings, presence.

**Transfers in background:** audio takes (multi-MB WAV/MP3), chunked and resumable — minutes, with progress bars, never blocking decisions.

**Never leaves a device unless the user clicks Share:** manuscript text, recordings, proof transcripts, `identities.json`. Default posture: no sync without an explicit pair.

**Pairing:** narrator clicks *Invite author* → Kosmos shows a 6-digit code plus a three-word passphrase (croc-style, [github.com/schollz/croc]), valid 10 minutes; the author types them into *Join*. Chosen over **QR scan** (users sit at Macs/PCs; cameras are friction) and **invite links** (an NDA book should never leave one-time tokens in email or chat, and links need a hosted page). Typed codes work over a phone call and double as key verification (§4).

## 2. Latency budget

Seconds, not milliseconds, per artifact:

| Artifact | Feel target |
|---|---|
| Flag decision (fixed/dismissed) | < 2 s |
| Note, status, glossary entry | < 5 s |
| Presence, take-ready ping | < 10 s |
| 50 MB take | minutes, progress + resumable |

Sub-second matters **nowhere**: no typing indicators, shared cursors, or prose co-editing. If a decision lands within 2 s nobody can tell P2P from relayed; races are just ordinary conflicts for §3 to settle.

## 3. Conflict rules a novelist understands

Reuse the pack-apply invariants in `merge.ts`, applied live:

- **Per-field last-writer-wins:** one flag's status, one note, one glossary respell, one chapter status — never the whole file. Timestamps plus a per-device counter survive clock skew.
- **Dismissed stays dismissed:** an incoming "open" never resurrects a dismissed flag (as packs enforce today).
- **An author cannot silently overwrite the narrator's Fine-as-read:** genuine disagreement surfaces as a conflict card showing both choices; a human picks.
- **Both edited the same glossary word:** a respell fills a blank, as packs do; two different respells become one conflict card showing both, keep either.
- **Offline-then-reconnect:** each side journals events locally (the journal also feeds packs). On reconnect the queue replays through `planProjectMerge`; whatever rules cannot settle lands in the existing disagreements review. Nothing is dropped or auto-overwritten.

## 4. Security bar

**Threat model:** the ISP and any relay operator see only ciphertext plus metadata (IPs, sizes, timing) — never content; the other machine sees exactly what collaboration shares (statuses, notes, takes you sent), never the project folder.

**Mandatory end-to-end encryption:** extend `electron/identity.cjs`'s local identity (today personName/role/seat) with a libsodium keypair created on first run: every event signed by its sender; session keys derived via X25519 with the pairing passphrase through a PAKE so it never crosses the wire.

**Key verification UX:** after pairing, both apps display two spoken words derived from the peer's key fingerprint — "does yours say harbor-ocean?" Narrators will actually do this.

**README sentence we can keep:** "Your book and voice stay on your computers; live collaboration travels end-to-end encrypted directly between your machines — Kosmos still has no accounts, analytics, or cloud-uploaded manuscripts."

## 5. Cost sheet

Free path totals **$0**:

| Component | Free mechanism |
|---|---|
| Transport | WebRTC DataChannel, direct P2P |
| STUN | Unlimited free STUN ([metered.ca/stun-turn]) |
| TURN fallback | Cloudflare Realtime: first 1,000 GB/mo free, then $0.05/GB ([developers.cloudflare.com/realtime/sfu/pricing]) — ≈100 MB per 50 MB take relayed, so ~10k takes/mo free |
| Pairing/signaling | Pusher Channels Sandbox: free, 200k msgs/day, 100 concurrent connections ([pusher.com/channels/pricing]); signaling is KBs/session ≈ 50 duets |
| Escape hatch | coturn on a VPS: Hetzner CX22 ≈ €3.79–4.15/mo ([whtop.com/plans/hetzner.com/128281], [cloudcostly.com/plan/hetzner-cx22]); DigitalOcean droplets from $4/mo ([digitalocean.com/products/droplets]) |

Compared: Metered TURN free 500 MB/mo, Growth $99/mo (150 GB, $0.40/GB overage) ([metered.ca/stun-turn]); Ably Free 6M msgs/mo but 200 connections, Standard $29/mo + $2.50/M msgs ([ably.com/pricing]); PubNub Free 200 MAU/1M transactions, Starter $98/mo for 1,000 MAU ([pubnub.com/pricing]); Firebase RTDB Spark 100 connections, 1 GB stored, 10 GB/mo free, Blaze then $5/GB-mo ([firebase.google.com/docs/database/usage/billing], [/usage/limits]); Tailscale Personal $0 for ≤6 users, non-commercial ([tailscale.com/pricing]).

**Charge only if free capacity breaks**, in order: (a) Studio tier bundling reserved TURN (Metered Growth $99/mo or Cloudflare overage); (b) dedicated signaling (Ably $29 / Pusher Startup $49 monthly). Never charge for core sync — the README promises free.

## 6. Failure modes and the honest fallback

When P2P fails (hard NAT, corporate firewall blocking TURN/443), Kosmos detects it and offers **one click**: "Live link unavailable — make a pack," pre-filling today's ZIP flow with the queued journal inside, so nothing decided offline is lost — same on relay outage. In-app wording: "This network blocks live links. Your work is safe — share a pack instead." Sync is local-first and additive; disconnection degrades, never deletes.
