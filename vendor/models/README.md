# Bundled speech models

The release installer includes both local speech models at build time.
`npm run prepare:model` downloads them, verifies checksums, and stages them
in this directory before Electron Builder packages the app.

| File | Job | Checksum |
|---|---|---|
| `ggml-small.en.bin` | Proof + live back-check | SHA-1 `db8a495a91d927739e50b3fc1cc4c6b8f6c2d022` |
| `realtime_eou_120m-v1-f16.gguf` | Live follow (Parakeet EOU 120M) | SHA-256 `d1a2b12f12b8a096a57499c9111ed13b442a2b786e17a292c168be45088f0edc` |

The models are intentionally not committed to Git. The installer still
contains the verified files, so an end user never needs a separate model
download for either job.
