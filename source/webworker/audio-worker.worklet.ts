/*
	Test Processor Worklet
*/

class WorkletProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]/*, parameters: unknown*/) {
    // Assuming mono input for simplicity
    const input = inputs[0][0];
    const output = outputs[0][0];

    // Send raw audio data to the main thread
    this.port.postMessage({ rawData: input });

    // Process audio data if needed
    // ...

    // Copy input to output (for simplicity)
    output.set(input);

    return true;
  }
}

// Register the AudioWorklet processor
registerProcessor('worklet-processor', WorkletProcessor);
