/*
	Test Processor Worklet
*/

class WorkletProcessor extends AudioWorkletProcessor {
	process(inputs: any, outputs: any, parameters: any) {
		// Do something with the data, e.g. convert it to WAV
		console.log('input', inputs);
		console.log('output', outputs);
		console.log('params', parameters);
		return true;
	}
}

// Register the AudioWorklet processor
registerProcessor('worklet-processor', WorkletProcessor);
