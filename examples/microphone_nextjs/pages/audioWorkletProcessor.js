class AudioProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      const output = outputs[0];
      const inputData = input[0];
  
      if (inputData) {
        const blob = new Blob([inputData], { type: 'audio/wav' });
        this.port.postMessage(blob);
      }
  
      return true;
    }
  }
  
  registerProcessor('audio-processor', AudioProcessor);