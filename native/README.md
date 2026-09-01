# Native live follow helper

`parakeet-live` feeds 16 kHz mono float PCM into parakeet.cpp's C stream API.

Do not use `parakeet-cli --stream` on Metal — that path SIGSEGVs on this Mac.
Build:

```
cc -O2 -o vendor/bin/parakeet-live native/parakeet-live.c \\
  -Inative -Lvendor/bin -lparakeet -Wl,-rpath,@executable_path
```
