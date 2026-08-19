#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "parakeet_capi.h"

/* Incremental 16 kHz mono f32le PCM from stdin. Prints one JSON line per hop.
   Use this instead of `parakeet-cli --stream` on Metal — that CLI path SIGSEGVs. */
enum { HOP = 2560 }; /* 160 ms at 16 kHz */

int main(int argc, char** argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: parakeet-live <model.gguf>\n");
    return 2;
  }

  parakeet_ctx* ctx = parakeet_capi_load(argv[1]);
  if (!ctx) {
    fprintf(stderr, "parakeet-live: failed to load model\n");
    return 1;
  }

  parakeet_stream* stream = parakeet_capi_stream_begin(ctx);
  if (!stream) {
    fprintf(stderr, "parakeet-live: stream_begin failed: %s\n", parakeet_capi_last_error(ctx));
    parakeet_capi_free(ctx);
    return 1;
  }

  float* pcm = malloc((size_t)HOP * sizeof(float));
  if (!pcm) {
    parakeet_capi_stream_free(stream);
    parakeet_capi_free(ctx);
    return 1;
  }

  for (;;) {
    size_t got = fread(pcm, sizeof(float), HOP, stdin);
    if (got == 0) {
      break;
    }
    char* json = parakeet_capi_stream_feed_json(stream, pcm, (int)got);
    if (!json) {
      fprintf(stderr, "parakeet-live: feed failed: %s\n", parakeet_capi_last_error(ctx));
      free(pcm);
      parakeet_capi_stream_free(stream);
      parakeet_capi_free(ctx);
      return 1;
    }
    fputs(json, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    parakeet_capi_free_string(json);
    if (got < (size_t)HOP) {
      break;
    }
  }

  char* tail = parakeet_capi_stream_finalize_json(stream);
  if (tail) {
    fputs(tail, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    parakeet_capi_free_string(tail);
  }

  free(pcm);
  parakeet_capi_stream_free(stream);
  parakeet_capi_free(ctx);
  return 0;
}
