/**
 * Deterministic first-pass restoration for narration.
 *
 * De-clip runs before de-click because clipped flat tops are missing waveform
 * information; levelling, denoise, or impulse repair can smear the evidence
 * needed to reconstruct them. Overlap-save is deliberate: FFmpeg documents
 * that samples outside detected defects remain unchanged in this mode.
 */
export const AUTOMATIC_REPAIR_FILTER =
  "adeclip=w=10:o=50:a=3:t=5:m=save,adeclick=w=10:o=50:a=1:t=8:m=save";

/** No unattended repair may replace more than this share of a take. */
export const AUTOMATIC_REPAIR_MAX_CHANGED_RATIO = 0.02;
/** Repair is rejected when it changes programme level by more than this. */
export const AUTOMATIC_REPAIR_MAX_LEVEL_SHIFT_DB = 0.1;

export interface RepairCandidateAssessment {
  applied: boolean;
  safe: boolean;
  changedSamples: number;
  changedRatio: number;
  levelShiftDb: number;
  reason?: string;
}

/**
 * Compare FFmpeg's candidate with the original PCM before accepting it.
 *
 * The filters decide which samples look damaged. This independent gate decides
 * whether the proposed repair is still local and level-neutral enough to run
 * unattended. Widespread reconstruction becomes a pickup instead of a blind
 * whole-file rewrite.
 */
export function assessRepairCandidate(
  source: Float32Array | number[],
  candidate: Float32Array | number[],
): RepairCandidateAssessment {
  if (source.length === 0 || candidate.length !== source.length) {
    return rejected(0, 0, Number.POSITIVE_INFINITY, "Repair changed the take length.");
  }

  let sourceSquares = 0;
  let candidateSquares = 0;
  let changedSamples = 0;
  for (let index = 0; index < source.length; index += 1) {
    const before = source[index];
    const after = candidate[index];
    if (!Number.isFinite(before) || !Number.isFinite(after) || Math.abs(after) > 1.000_1) {
      return rejected(
        changedSamples,
        changedSamples / source.length,
        Number.POSITIVE_INFINITY,
        "Repair produced invalid PCM.",
      );
    }
    sourceSquares += before * before;
    candidateSquares += after * after;
    // Float PCM decoded from a 16/24-bit source can differ by a few ulps. Count
    // changes only above half of a 16-bit quantization step.
    if (Math.abs(before - after) > 1 / 65_536) {
      changedSamples += 1;
    }
  }

  const changedRatio = changedSamples / source.length;
  const sourceRms = Math.sqrt(sourceSquares / source.length);
  const candidateRms = Math.sqrt(candidateSquares / candidate.length);
  const levelShiftDb = Math.abs(dbfs(candidateRms) - dbfs(sourceRms));
  if (changedSamples === 0) {
    return { applied: false, safe: true, changedSamples, changedRatio, levelShiftDb };
  }
  if (changedRatio > AUTOMATIC_REPAIR_MAX_CHANGED_RATIO) {
    return rejected(
      changedSamples,
      changedRatio,
      levelShiftDb,
      "Detected damage is too widespread for unattended reconstruction.",
    );
  }
  if (levelShiftDb > AUTOMATIC_REPAIR_MAX_LEVEL_SHIFT_DB) {
    return rejected(
      changedSamples,
      changedRatio,
      levelShiftDb,
      "Repair changed narration level beyond the preservation limit.",
    );
  }
  return { applied: true, safe: true, changedSamples, changedRatio, levelShiftDb };
}

function rejected(
  changedSamples: number,
  changedRatio: number,
  levelShiftDb: number,
  reason: string,
): RepairCandidateAssessment {
  return {
    applied: changedSamples > 0,
    safe: false,
    changedSamples,
    changedRatio,
    levelShiftDb,
    reason,
  };
}

function dbfs(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-12));
}
