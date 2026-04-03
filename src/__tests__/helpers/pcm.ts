export function makePcmBuffer(durationMs: number, amplitude: number): Buffer {
  const sampleRate = 48000;
  const channels = 2;
  const bytesPerSample = 2;
  const totalFrames = Math.floor((sampleRate * durationMs) / 1000);
  const totalSamples = totalFrames * channels;
  const buffer = Buffer.alloc(totalSamples * bytesPerSample);

  let offset = 0;
  for (let frame = 0; frame < totalFrames; frame++) {
    const left = frame * channels;
    const right = frame * channels + 1;
    const leftSample = Math.round(amplitude * Math.sin(2 * Math.PI * 440 * left / sampleRate));
    const rightSample = Math.round(amplitude * Math.sin(2 * Math.PI * 440 * right / sampleRate));
    buffer.writeInt16LE(leftSample, offset);
    offset += bytesPerSample;
    buffer.writeInt16LE(rightSample, offset);
    offset += bytesPerSample;
  }

  return buffer;
}
