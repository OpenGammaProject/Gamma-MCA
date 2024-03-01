"use strict";
class WorkletProcessor extends AudioWorkletProcessor {
    process(inputs, outputs) {
        const input = inputs[0][0];
        const output = outputs[0][0];
        this.port.postMessage({ rawData: input });
        output.set(input);
        return true;
    }
}
registerProcessor('worklet-processor', WorkletProcessor);
