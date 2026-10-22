import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { buildAudioFrame, buildEventFrame, ClientEvent, parseServerFrame, ServerEvent } from './doubao-protocol.js';

const DOUBAO_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
const RESOURCE_ID = 'volc.speech.dialog';

const MARIE_ROLE = `你叫 Marie，是温柔、可靠、清晰的实时美妆陪练。服务对象是18岁以上的初学者到中老年用户，尊重不同年龄、肤色和五官。会话开始后保持安静，等待用户先说话；用户一开口就立刻停止原回答，忽略未讲完的内容，优先理解并回答用户最新的具体问题或步骤。不主动介绍自己或连续讲教程。始终用简短自然的中文口语，每次最多两句，只给一个当前动作。结合用户选择的步骤和系统视觉观察，先说看得到的事实，再给立即可执行的建议；如果颜色、明暗、边界或左右均匀度有问题，要委婉但明确指出，禁止用空泛夸奖代替判断。看不清或变化不明确时如实说明，并请用户调整光线、镜头或再上少量产品。语气友善、不幼稚、不营销，不评价美丑，不使用“缺陷”等词，不进行皮肤或医疗诊断。不要提及模型、点位或后台分析。`;

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function safeText(value, max = 160) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function asksAboutAppearance(text = '') {
  return /(画好|画完|上好|涂好|效果|怎么样|好看|均匀|对称|颜色|显色|深浅|边界|晕染|妆面|妆感|这里|这边|左右|脸上|眼妆|眉毛|腮红|口红|粉底)/.test(text);
}

function sessionPayload(config = {}) {
  const model = process.env.VOLCENGINE_REALTIME_MODEL || '1.2.1.1';
  const speaker = process.env.VOLCENGINE_REALTIME_SPEAKER || 'zh_female_vv_uranus_bigtts';
  const speechRate = Number(process.env.VOLCENGINE_REALTIME_SPEECH_RATE ?? -8);
  const look = safeText(config.lookTitle);
  const part = safeText(config.stepPart);
  const step = safeText(config.stepTitle);
  const context = look ? `当前用户正在跟练“${look}”${part || step ? `，当前步骤是“${part}${part && step ? '：' : ''}${step}”` : ''}。` : '';
  return {
    tts: {
      speaker,
      audio_config: {
        channel: 1,
        format: 'pcm_s16le',
        sample_rate: 24000,
        speech_rate: Number.isFinite(speechRate) ? Math.max(-50, Math.min(100, Math.round(speechRate))) : -8,
        loudness_rate: 0,
      },
    },
    dialog: {
      bot_name: 'Marie',
      system_role: `${MARIE_ROLE}${context}`,
      speaking_style: '温和、清楚、专业，语速稍慢，像在镜子旁陪练；不用长段解释。',
      extra: {
        model,
        input_mod: 'keep_alive',
        enable_music: false,
        enable_volc_websearch: false,
        enable_conversation_truncate: true,
      },
    },
  };
}

function errorMessage(frame) {
  return frame.json?.error || frame.json?.message || `豆包实时语音错误${frame.errorCode ? `（${frame.errorCode}）` : ''}`;
}

function createSession(browser) {
  const apiKey = process.env.VOLCENGINE_API_KEY || process.env.VOLCENGINE_ACCESS_KEY;
  if (!apiKey) {
    sendJson(browser, { type: 'error', message: '服务端尚未配置豆包语音 API Key' });
    browser.close();
    return;
  }

  const connectId = randomUUID();
  const state = { sessionId: '', active: false, closing: false, userHasSpoken: false, lastUserSpeechAt: 0, assistantSpeaking: false, pendingVisionKey: '', pendingVisionCount: 0, lastVisionKey: '', lastVisionAt: 0, lastVisionSummary: '', lastVisionCapturedAt: 0, lastVisionContext: '', lastVisualQuestion: '' };
  const upstream = new WebSocket(DOUBAO_URL, {
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': RESOURCE_ID,
      'X-Api-Connect-Id': connectId,
    },
  });

  const finish = () => {
    if (state.closing) return;
    state.closing = true;
    try {
      if (upstream.readyState === WebSocket.OPEN && state.active && state.sessionId) upstream.send(buildEventFrame(ClientEvent.FINISH_SESSION, {}, state.sessionId));
      if (upstream.readyState === WebSocket.OPEN) upstream.send(buildEventFrame(ClientEvent.FINISH_CONNECTION));
    } catch { /* closing best effort */ }
    upstream.close();
  };

  upstream.on('open', () => upstream.send(buildEventFrame(ClientEvent.START_CONNECTION)));
  upstream.on('message', (raw) => {
    let frame;
    try { frame = parseServerFrame(raw); } catch (error) {
      sendJson(browser, { type: 'error', message: error.message }); return;
    }
    const data = frame.json || {};
    if (frame.eventId === ServerEvent.CONNECTION_STARTED) {
      sendJson(browser, { type: 'ready' });
    } else if (frame.eventId === ServerEvent.SESSION_STARTED) {
      state.active = true;
      sendJson(browser, { type: 'session_started', dialogId: data.dialog_id || '' });
    } else if (frame.eventId === ServerEvent.SESSION_FINISHED) {
      state.active = false; sendJson(browser, { type: 'session_finished' });
    } else if (frame.eventId === ServerEvent.SESSION_FAILED || frame.eventId === ServerEvent.DIALOG_COMMON_ERROR || frame.msgType === 15) {
      state.active = false; sendJson(browser, { type: 'error', message: errorMessage(frame), code: frame.errorCode });
    } else if (frame.eventId === ServerEvent.ASR_INFO) {
      state.userHasSpoken = true; state.lastUserSpeechAt = Date.now(); state.assistantSpeaking = false;
      state.pendingVisionKey = ''; state.pendingVisionCount = 0;
      sendJson(browser, { type: 'user_speaking' });
    } else if (frame.eventId === ServerEvent.ASR_RESPONSE) {
      for (const item of data.results || []) {
        if (item.text?.trim()) { state.userHasSpoken = true; state.lastUserSpeechAt = Date.now(); }
        sendJson(browser, { type: 'asr_text', text: item.text || '', isInterim: Boolean(item.is_interim) });
        const question = safeText(item.text, 240);
        const recentVision = state.lastVisionSummary && Date.now() - state.lastVisionCapturedAt < 9000;
        if (question && !item.is_interim && recentVision && asksAboutAppearance(question) && question !== state.lastVisualQuestion) {
          const content = `用户刚才问：“${question}”。${state.lastVisionContext ? `当前${state.lastVisionContext}。` : ''}相机刚刚看到：${state.lastVisionSummary}。请优先回答用户这个最新问题，只依据视觉证据判断；问题要委婉但明确指出，不确定就说变化不明显，并只给一个下一步动作。`;
          upstream.send(buildEventFrame(ClientEvent.CHAT_TEXT_QUERY, { content: safeText(content, 800) }, state.sessionId));
          state.lastVisualQuestion = question;
        }
      }
    } else if (frame.eventId === ServerEvent.ASR_ENDED) {
      sendJson(browser, { type: 'user_stopped' });
    } else if (frame.eventId === ServerEvent.TTS_SENTENCE_START) {
      state.assistantSpeaking = true; sendJson(browser, { type: 'tts_start', text: data.text || '' });
    } else if (frame.eventId === ServerEvent.TTS_RESPONSE && frame.payload.length) {
      if (browser.readyState === WebSocket.OPEN) browser.send(frame.payload, { binary: true });
    } else if (frame.eventId === ServerEvent.TTS_ENDED) {
      state.assistantSpeaking = false; sendJson(browser, { type: 'tts_ended' });
    } else if (frame.eventId === ServerEvent.CHAT_RESPONSE) {
      sendJson(browser, { type: 'chat_text', content: data.content || '' });
    } else if (frame.eventId === ServerEvent.CHAT_ENDED) {
      sendJson(browser, { type: 'chat_ended' });
    } else if (frame.eventId === ServerEvent.USAGE_RESPONSE) {
      sendJson(browser, { type: 'usage', usage: data.usage || data });
    }
  });
  upstream.on('unexpected-response', (_request, response) => {
    sendJson(browser, { type: 'error', message: `豆包实时语音授权失败（HTTP ${response.statusCode}），请检查是否已开通端到端实时语音` });
  });
  upstream.on('error', (error) => sendJson(browser, { type: 'error', message: `豆包连接失败：${error.message}` }));
  upstream.on('close', () => {
    if (!state.closing) sendJson(browser, { type: 'closed' });
    if (browser.readyState === WebSocket.OPEN) browser.close();
  });

  browser.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (state.active && state.sessionId && upstream.readyState === WebSocket.OPEN) upstream.send(buildAudioFrame(raw, state.sessionId));
      return;
    }
    let message;
    try { message = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (message.type === 'start_session' && upstream.readyState === WebSocket.OPEN) {
      state.sessionId = randomUUID();
      upstream.send(buildEventFrame(ClientEvent.START_SESSION, sessionPayload(message.config), state.sessionId));
    } else if (message.type === 'text_query' && state.active && message.content) {
      state.userHasSpoken = true; state.lastUserSpeechAt = Date.now();
      upstream.send(buildEventFrame(ClientEvent.CHAT_TEXT_QUERY, { content: safeText(message.content, 800) }, state.sessionId));
    } else if (message.type === 'coach_hint' && state.active && message.content) {
      const content = `系统视觉观察：${safeText(message.content, 300)}。请只用一句自然中文提醒用户立即调整。`;
      upstream.send(buildEventFrame(ClientEvent.CHAT_TEXT_QUERY, { content }, state.sessionId));
    } else if (message.type === 'client_interrupt' && state.active) {
      state.assistantSpeaking = false; state.lastUserSpeechAt = Date.now();
      state.pendingVisionKey = ''; state.pendingVisionCount = 0;
    } else if (message.type === 'step_context' && state.active) {
      const lookTitle = safeText(message.context?.lookTitle, 60); const stepPart = safeText(message.context?.stepPart, 40);
      const stepTitle = safeText(message.context?.stepTitle, 80); const stepDetail = safeText(message.context?.stepDetail, 220);
      const stepIndex = Math.max(1, Number(message.context?.stepIndex) || 1);
      const content = `系统状态更新：用户已切换到“${lookTitle || '当前妆容'}”第${stepIndex}步“${stepPart}${stepPart && stepTitle ? '：' : ''}${stepTitle}”。当前动作：${stepDetail || stepTitle}。立即停止上一阶段的说明，只用一句话指导这个新步骤，不要继续讲旧步骤。`;
      upstream.send(buildEventFrame(ClientEvent.CHAT_TEXT_QUERY, { content: safeText(content, 800) }, state.sessionId));
    } else if (message.type === 'vision_snapshot' && state.active) {
      const validImage = typeof message.image === 'string' && message.image.startsWith('data:image/jpeg;base64,') && message.image.length <= 420000;
      const summary = safeText(message.summary, 520);
      const lookTitle = safeText(message.context?.lookTitle, 60); const stepPart = safeText(message.context?.stepPart, 40); const stepTitle = safeText(message.context?.stepTitle, 80);
      if (summary) {
        state.lastVisionSummary = summary; state.lastVisionCapturedAt = Number(message.capturedAt) || Date.now();
        state.lastVisionContext = [lookTitle && `妆容“${lookTitle}”`, (stepPart || stepTitle) && `步骤“${stepPart}${stepPart && stepTitle ? '：' : ''}${stepTitle}”`].filter(Boolean).join('，');
      }
      sendJson(browser, { type: 'vision_received', accepted: validImage, capturedAt: message.capturedAt || Date.now() });
      const issueKey = safeText(message.issueKey, 48);
      if (message.attention && issueKey) {
        if (issueKey === state.pendingVisionKey) state.pendingVisionCount += 1;
        else { state.pendingVisionKey = issueKey; state.pendingVisionCount = 1; }
      } else { state.pendingVisionKey = ''; state.pendingVisionCount = 0; }
      const now = Date.now();
      const cooledDown = now - state.lastVisionAt > 20000 && (issueKey !== state.lastVisionKey || now - state.lastVisionAt > 45000);
      const canCoach = state.userHasSpoken && !state.assistantSpeaking && now - state.lastUserSpeechAt > 2500;
      if (message.attention && summary && state.pendingVisionCount >= 2 && cooledDown && canCoach) {
        const content = `系统实时相机观察：${summary}。只依据这条视觉证据回答：先客观说清看到的变化或问题，再用一句自然中文给出最优先的化妆或镜头纠正。不确定就说变化不明显，禁止空泛夸赞，不要复述技术数据。`;
        upstream.send(buildEventFrame(ClientEvent.CHAT_TEXT_QUERY, { content }, state.sessionId));
        state.lastVisionKey = issueKey; state.lastVisionAt = now; state.pendingVisionCount = 0;
      }
    } else if (message.type === 'stop_session') {
      finish();
    }
  });
  browser.on('close', finish);
  browser.on('error', finish);
}

export function attachDoubaoRealtimeServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  wss.on('connection', createSession);
  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname !== '/ws/realtime') return;
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  });
  return wss;
}
