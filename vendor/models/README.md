# Local development speech models

`npm run prepare:model` downloads these files for local development and
verification. They are not committed to Git and are not placed in release
installers.

| File | Job | Checksum |
|---|---|---|
| `ggml-small.en.bin` | Proof + live back-check | SHA-256 `c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d` |
| `realtime_eou_120m-v1-f16.gguf` | Live follow (Parakeet EOU 120M) | SHA-256 `d1a2b12f12b8a096a57499c9111ed13b442a2b786e17a292c168be45088f0edc` |

On a user's first setup, Kosmos downloads each model over HTTPS from an
immutable upstream revision, verifies its SHA-256 digest, and stores it in the
user's private app-data folder. That folder survives app updates, so the model
is not downloaded again for ordinary releases.
