export function makePcmBuffer(durationMs: number, amplitude: number): Buffer {
  const sampleRate = 48000;
  const channels = 2;
  const bytesPerSample = 2;
  const totalFrames = Math.floor((sampleRate * durationMs) / 1000);
  const totalSamples = totalFrames * channels;
  const buffer = Buffer.alloc(totalSamples * bytesPerSample);

  let offset = 0;
  for (let frame = 0; frame < totalFrames; frame++) {
    const freqHz = 440; // concert A — arbitrary test tone
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * freqHz * frame / sampleRate));
    buffer.writeInt16LE(sample, offset);
    offset += bytesPerSample;
    buffer.writeInt16LE(sample, offset);
    offset += bytesPerSample;
  }

  return buffer;
}
