class WorkletProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input.length > 0) {
        const channelData = input[0];
        const pcmData = this.convertToPCM(channelData);
        this.port.postMessage(pcmData);
      }
      return true;
    }
  
    convertToPCM(input) {
      const buffer = new ArrayBuffer(input.length * 2);
      const view = new DataView(buffer);
      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      }
      return buffer;
    }
  }
  
  registerProcessor('worklet-processor', WorkletProcessor);