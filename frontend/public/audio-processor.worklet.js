/**
 * AudioWorklet: runs on dedicated audio thread, immune to React renders.
 * Accumulates samples into larger chunks before sending to avoid
 * overwhelming the FastAPI relay with too many tiny messages.
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Accumulate 4096 samples (256ms @ 16kHz) before sending
    // Big enough for FastAPI relay to handle, small enough for low latency
    this._bufferSize = 4096;
    this._buffer = new Float32Array(this._bufferSize);
    this._bufferIndex = 0;
    this._active = true;
    
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this._active = false;
    };
  }

  process(inputs) {
    if (!this._active) return false;
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // 128 samples per worklet frame
    
    for (let i = 0; i < samples.length; i++) {
      this._buffer[this._bufferIndex++] = samples[i];
      
      if (this._bufferIndex >= this._bufferSize) {
        // Convert accumulated Float32 → Int16
        const int16 = new Int16Array(this._bufferSize);
        for (let j = 0; j < this._bufferSize; j++) {
          const s = Math.max(-1, Math.min(1, this._buffer[j]));
          int16[j] = s * 32768;
        }
        // Zero-copy transfer to main thread
        this.port.postMessage(int16.buffer, [int16.buffer]);
        this._bufferIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
