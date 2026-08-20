#!/bin/zsh
# Every measured arm of the live QC back-check, in one pass, so quoted numbers
# always come from the same corpus. Decodes are cached per arm, so a re-run after
# a corpus edit only pays for the cases that changed.
#
# Findings this reproduces:
#   - conditioning filters are a wash on in-spec audio; loudnorm costs 4 points
#   - a clipped window head costs up to 24 points, in pure recall
#   - two words of retained pre-roll recover it: at a 250ms head cut, 68% with no
#     run-up against 90% with two words, and the false positives drop from 2 to 0
set -u
cd "$(dirname "$0")/.."
OUT=${QC_SWEEP_OUT:-/tmp/qc-rebase}
mkdir -p "$OUT"

run() {
  name=$1; shift
  npx jiti scripts/live-qc-eval.ts --set all "$@" > "$OUT/$name.log" 2>&1
  detected=$(grep -E "^overall:" "$OUT/$name.log" | sed 's/overall: detected //')
  fp=$(grep -E "^false positives:" "$OUT/$name.log" | sed 's/false positives: //')
  controls=$(grep -E "^controls:" "$OUT/$name.log" | sed 's/controls: //')
  printf "%-16s %-22s fp=%-3s controls=%s\n" "$name" "$detected" "$fp" "$controls"
}

echo "--- conditioning"
run clean-none    --degrade none  --condition none
run clean-hp      --degrade none  --condition hp
run clean-both    --degrade none  --condition both
run clean-sns     --degrade none  --condition none --suppress-nst
run booth-none    --degrade booth --condition none
run booth-hp      --degrade booth --condition hp
run quiet-none    --degrade quiet --condition none
run quiet-norm    --degrade quiet --condition norm
echo "--- boundary"
run cut-head-80   --trim-head 80
run cut-head-150  --trim-head 150
run cut-head-250  --trim-head 250
run cut-tail-150  --trim-tail 150
echo "--- pre-roll"
run lead1-cut150  --lead-words 1 --trim-head 150
run lead1-cut250  --lead-words 1 --trim-head 250
run lead2-cut250  --lead-words 2 --trim-head 250
run lead3-cut0    --lead-words 3
run lead3-cut150  --lead-words 3 --trim-head 150
run lead3-cut250  --lead-words 3 --trim-head 250
echo "### REBASELINE COMPLETE"
