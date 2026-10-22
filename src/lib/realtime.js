function websocketUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/realtime`;
}

function pcm16Chunk(samples) {
  const outputLength = 320;
  const output = new Int16Array(outputLength);
  const scale = samples.length / outputLength;
  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * scale);
    const end = Math.max(start + 1, Math.floor((i + 1) * scale));
    let sum = 0;
    for (let j = start; j < Math.min(end, samples.length); j += 1) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return output.buffer;
}

export async function createRealtimeConversation({ look, step, onState, onTranscript, onLevel }) {
  let socket = null;
  let stream = null;
  let inputContext = null;
  let outputContext = null;
  let source = null;
  let processor = null;
  let silentGain = null;
  let muted = false;
  let inputQueue = new Float32Array(0);
  let nextPlayAt = 0;
  let assistantText = '';
  let settled = false;
  const activeOutputNodes = new Set();
  let assistantAudioActive = false;
  let suppressOutput = false;
  let confirmedUserSpeech = false;
  let waitingForReply = false;
  let vadFrames = 0;
  let noiseFloor = .008;
  let localInterruptTimer = null;

  const clearPlayback = () => {
    activeOutputNodes.forEach((node) => {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    });
    activeOutputNodes.clear();
    nextPlayAt = outputContext ? outputContext.currentTime + .02 : 0;
  };

  const clearInterruptTimer = () => {
    if (localInterruptTimer) window.clearTimeout(localInterruptTimer);
    localInterruptTimer = null;
  };

  const interruptPlayback = (confirmed = false) => {
    clearPlayback(); assistantAudioActive = false; suppressOutput = true; vadFrames = 0;
    if (confirmed) { confirmedUserSpeech = true; clearInterruptTimer(); return; }
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'client_interrupt' }));
    clearInterruptTimer();
    localInterruptTimer = window.setTimeout(() => {
      if (!confirmedUserSpeech && !waitingForReply) suppressOutput = false;
      localInterruptTimer = null;
    }, 1400);
  };

  const appendInput = (chunk) => {
    const merged = new Float32Array(inputQueue.length + chunk.length);
    merged.set(inputQueue); merged.set(chunk, inputQueue.length); inputQueue = merged;
    const sourceChunk = Math.round(inputContext.sampleRate * .02);
    while (inputQueue.length >= sourceChunk) {
      const part = inputQueue.slice(0, sourceChunk); inputQueue = inputQueue.slice(sourceChunk);
      let power = 0;
      for (let i = 0; i < part.length; i += 1) power += part[i] * part[i];
      const rms = Math.sqrt(power / part.length);
      onLevel?.(Math.min(1, rms * 4));
      if (!assistantAudioActive && !suppressOutput && rms < .03) noiseFloor = noiseFloor * .96 + rms * .04;
      if (!muted && assistantAudioActive && !suppressOutput) {
        const threshold = Math.max(.032, noiseFloor * 3.4);
        vadFrames = rms > threshold ? vadFrames + 1 : Math.max(0, vadFrames - 1);
        if (vadFrames >= 3) interruptPlayback(false);
      }
      if (!muted && socket?.readyState === WebSocket.OPEN) socket.send(pcm16Chunk(part));
    }
  };

  const playPcm = async (value) => {
    if (!outputContext || suppressOutput) return;
    const array = value instanceof Blob ? await value.arrayBuffer() : value;
    if (!outputContext || suppressOutput) return;
    const pcm = new Int16Array(array);
    if (!pcm.length) return;
    const buffer = outputContext.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 32768;
    const node = outputContext.createBufferSource(); node.buffer = buffer; node.connect(outputContext.destination);
    activeOutputNodes.add(node); node.onended = () => { activeOutputNodes.delete(node); try { node.disconnect(); } catch { /* already disconnected */ } };
    const start = Math.max(outputContext.currentTime + .025, nextPlayAt); node.start(start); nextPlayAt = start + buffer.duration;
  };

  const startAudio = async () => {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    inputContext = new AudioContext(); outputContext = new AudioContext({ sampleRate: 24000 });
    await Promise.all([inputContext.resume(), outputContext.resume(), inputContext.audioWorklet.addModule('/audio-processor.js')]);
    source = inputContext.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(inputContext, 'marie-mic-processor');
    silentGain = inputContext.createGain(); silentGain.gain.value = 0;
    processor.port.onmessage = (event) => appendInput(event.data);
    source.connect(processor); processor.connect(silentGain); silentGain.connect(inputContext.destination);
  };

  const stopAudio = () => {
    clearInterruptTimer(); clearPlayback();
    processor?.disconnect(); source?.disconnect(); silentGain?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    inputContext?.close().catch(() => {}); outputContext?.close().catch(() => {});
    processor = source = silentGain = stream = inputContext = outputContext = null;
    inputQueue = new Float32Array(0); nextPlayAt = 0; assistantAudioActive = false; suppressOutput = false; confirmedUserSpeech = false; waitingForReply = false; vadFrames = 0; onLevel?.(0);
  };

  const connect = async () => {
    onState?.('connecting');
    await startAudio();
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('豆包实时语音连接超时')), 12000);
      socket = new WebSocket(websocketUrl()); socket.binaryType = 'arraybuffer';
      socket.onmessage = async (event) => {
        if (typeof event.data !== 'string') { await playPcm(event.data); return; }
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'ready') {
          socket.send(JSON.stringify({ type: 'start_session', config: { lookTitle: look?.title, stepPart: step?.part, stepTitle: step?.title } }));
        } else if (data.type === 'session_started') {
          settled = true; window.clearTimeout(timeout); onState?.('connected'); resolve();
        } else if (data.type === 'user_speaking') {
          assistantText = ''; waitingForReply = false; interruptPlayback(true);
        } else if (data.type === 'user_stopped') {
          confirmedUserSpeech = false; waitingForReply = true; suppressOutput = true; clearInterruptTimer();
        } else if (data.type === 'tts_start') {
          if (waitingForReply) {
            waitingForReply = false; confirmedUserSpeech = false; suppressOutput = false; clearInterruptTimer(); nextPlayAt = outputContext?.currentTime || 0;
          }
          if (!suppressOutput) assistantAudioActive = true;
        } else if (data.type === 'tts_ended') {
          assistantAudioActive = false; vadFrames = 0;
        } else if (data.type === 'asr_text' && data.text && !data.isInterim) {
          confirmedUserSpeech = false; waitingForReply = true; suppressOutput = true; clearInterruptTimer();
          onTranscript?.({ role: 'user', text: data.text });
        } else if (data.type === 'chat_text') {
          assistantText += data.content || '';
        } else if (data.type === 'chat_ended') {
          if (assistantText.trim()) onTranscript?.({ role: 'assistant', text: assistantText.trim() });
          assistantText = '';
        } else if (data.type === 'error') {
          const error = new Error(data.message || '豆包实时语音发生错误');
          onState?.('error', error.message);
          if (!settled) { settled = true; window.clearTimeout(timeout); reject(error); }
        } else if (data.type === 'closed' && !settled) {
          settled = true; window.clearTimeout(timeout); reject(new Error('豆包实时语音连接已关闭'));
        }
      };
      socket.onerror = () => {
        const error = new Error('无法连接豆包实时语音服务');
        if (!settled) { settled = true; window.clearTimeout(timeout); reject(error); }
      };
    });
  };

  const setMuted = (value) => {
    muted = value;
    stream?.getAudioTracks().forEach((track) => { track.enabled = !value; });
  };

  const sendText = (text) => {
    if (socket?.readyState !== WebSocket.OPEN || !text) return false;
    socket.send(JSON.stringify({ type: 'text_query', content: text })); return true;
  };

  const sendObservation = (text) => {
    if (socket?.readyState !== WebSocket.OPEN || !text) return false;
    socket.send(JSON.stringify({ type: 'coach_hint', content: text })); return true;
  };

  const updateStep = ({ look: nextLook, step: nextStep, index }) => {
    if (socket?.readyState !== WebSocket.OPEN || !nextStep) return false;
    socket.send(JSON.stringify({ type: 'step_context', context: { lookTitle: nextLook?.title, stepPart: nextStep.part, stepTitle: nextStep.title, stepDetail: nextStep.detail, stepIndex: Number(index) + 1 } }));
    return true;
  };

  const sendVisionSnapshot = ({ image, signals, summary, attention, issueKey, capturedAt, context }) => {
    if (socket?.readyState !== WebSocket.OPEN || !signals || typeof image !== 'string') return false;
    socket.send(JSON.stringify({ type: 'vision_snapshot', image, signals, summary, attention: Boolean(attention), issueKey, capturedAt, context }));
    return true;
  };

  const disconnect = () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop_session' }));
    socket?.close(); socket = null; stopAudio(); onState?.('idle');
  };

  return { connect, disconnect, setMuted, sendText, sendObservation, updateStep, sendVisionSnapshot };
}
