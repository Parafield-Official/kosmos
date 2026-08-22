/**
 * Microphone tap for voice follow.
 *
 * Capture runs on the browser's audio rendering thread rather than in a
 * `ScriptProcessorNode` on the main thread. Two things follow from that, and
 * both matter for how far the teleprompter trails the narrator:
 *
 *  - The tap wakes every 128 frames (under 3ms) instead of every 4096 (85ms),
 *    so a hop is handed off the instant its last sample lands rather than up to
 *    85ms later.
 *  - Rendering the manuscript, matching words, and encoding back-check audio all
 *    occupy the main thread. A tap living there is delayed by that work; a tap
 *    on the audio thread is not.
 *
 * The tap also emits blocks of exactly one hop, so the caller never has to hold
 * a partial block back, and reports loudness per block so the caller can tell
 * speech from silence without walking the samples again.
 */

/** One captured hop, measured on the audio thread. */
export interface LiveTapBlock {
  /** Exactly `hopSamples` of mono audio at the context's sample rate. */
  samples: Float32Array;
  /** Root-mean-square amplitude of this block. */
  rms: number;
}

export interface LiveTap {
  /** Stop delivering blocks and release the graph nodes this tap owns. */
  close(): void;
}

const PROCESSOR_NAME = "live-tap";

/**
 * Runs inside the `AudioWorkletGlobalScope`, so it is written as source text
 * rather than imported: it cannot share this module's scope or bundle.
 */
const PROCESSOR_SOURCE = `
class LiveTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.hop = Math.max(128, (options && options.processorOptions && options.processorOptions.hopSamples) || 2560);
    this.block = new Float32Array(this.hop);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) {
      return true;
    }
    let read = 0;
    while (read < input.length) {
      const take = Math.min(this.hop - this.filled, input.length - read);
      this.block.set(input.subarray(read, read + take), this.filled);
      this.filled += take;
      read += take;
      if (this.filled < this.hop) {
        continue;
      }
      let sumSquares = 0;
      for (let index = 0; index < this.hop; index += 1) {
        sumSquares += this.block[index] * this.block[index];
      }
      const samples = this.block.slice(0);
      this.port.postMessage(
        { samples, rms: Math.sqrt(sumSquares / this.hop) },
        [samples.buffer],
      );
      this.filled = 0;
    }
    return true;
  }
}

registerProcessor(${JSON.stringify(PROCESSOR_NAME)}, LiveTapProcessor);
`;

const registered = new WeakSet<BaseAudioContext>();

async function registerProcessor(context: BaseAudioContext): Promise<void> {
  if (registered.has(context)) {
    return;
  }
  const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
    registered.add(context);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface LiveTapOptions {
  context: AudioContext;
  source: AudioNode;
  /** Samples per delivered block, at the context's sample rate. */
  hopSamples: number;
  onBlock: (block: LiveTapBlock) => void;
}

/**
 * Tap `source` for one-hop blocks. Throws when the runtime has no audio
 * worklet, which lets the caller fall back to a main-thread tap.
 */
export async function createLiveTap({
  context,
  source,
  hopSamples,
  onBlock,
}: LiveTapOptions): Promise<LiveTap> {
  if (!context.audioWorklet) {
    throw new Error("This runtime has no audio worklet.");
  }
  await registerProcessor(context);
  const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
    processorOptions: { hopSamples },
  });
  node.port.onmessage = (event: MessageEvent<LiveTapBlock>) => {
    onBlock(event.data);
  };
  // The graph only renders nodes that reach the destination, so the tap is
  // routed there through a silent gain. It emits nothing of its own.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(context.destination);
  return {
    close() {
      node.port.onmessage = null;
      try {
        source.disconnect(node);
      } catch {
        // The graph may already be torn down; disconnecting twice is harmless.
      }
      node.disconnect();
      mute.disconnect();
    },
  };
}
