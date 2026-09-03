# Bundled speech models

The release installer includes both local speech models at build time.
`npm run prepare:model` downloads them, verifies their checksums, and stages
them in this directory before Electron Builder packages the app.

| File | Job | Checksum |
|---|---|---|
| `ggml-small.en.bin` | Proof + live back-check | SHA-256 `c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d` |
| `realtime_eou_120m-v1-f16.gguf` | Live follow (Parakeet EOU 120M) | SHA-256 `d1a2b12f12b8a096a57499c9111ed13b442a2b786e17a292c168be45088f0edc` |

The models are intentionally not committed to Git. The installer contains the
verified files, so a user can use Proof and voice-following without a separate
model download.
