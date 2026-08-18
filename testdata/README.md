# Test data

Short audio fixtures for proof and ACX tests stay deterministic and small.
Most ACX edge cases (true peak, digital silence, AudioBabble −42 dBFS noise,
and bathroom-noise refusal) are generated as PCM inside their unit tests. The
installable proof example is under `public/examples/proof/` and deliberately
contains the `on` → `in` substitution.
