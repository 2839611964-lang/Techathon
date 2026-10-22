import { gunzipSync } from 'node:zlib';

const VERSION_AND_HEADER = 0x11;
const EVENT_FLAG = 0x04;

export const ClientEvent = Object.freeze({
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  START_SESSION: 100,
  FINISH_SESSION: 102,
  TASK_REQUEST: 200,
  SAY_HELLO: 300,
  END_ASR: 400,
  CHAT_TTS_TEXT: 500,
  CHAT_TEXT_QUERY: 501,
});

export const ServerEvent = Object.freeze({
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED: 51,
  CONNECTION_FINISHED: 52,
  SESSION_STARTED: 150,
  SESSION_FINISHED: 152,
  SESSION_FAILED: 153,
  USAGE_RESPONSE: 154,
  TTS_SENTENCE_START: 350,
  TTS_SENTENCE_END: 351,
  TTS_RESPONSE: 352,
  TTS_ENDED: 359,
  ASR_INFO: 450,
  ASR_RESPONSE: 451,
  ASR_ENDED: 459,
  CHAT_RESPONSE: 550,
  CHAT_TEXT_QUERY_CONFIRMED: 553,
  CHAT_ENDED: 559,
  DIALOG_COMMON_ERROR: 599,
});

const MsgType = Object.freeze({ CLIENT_JSON: 0x01, CLIENT_AUDIO: 0x02, ERROR: 0x0f });
const Serialization = Object.freeze({ RAW: 0x00, JSON: 0x01 });

function uint32(value) {
  const field = Buffer.allocUnsafe(4);
  field.writeUInt32BE(value >>> 0);
  return field;
}

function stringField(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([uint32(bytes.length), bytes]);
}

function header(type, serialization) {
  return Buffer.from([VERSION_AND_HEADER, (type << 4) | EVENT_FLAG, serialization << 4, 0]);
}

export function buildEventFrame(eventId, payload = {}, sessionId = '') {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const fields = [header(MsgType.CLIENT_JSON, Serialization.JSON), uint32(eventId)];
  if (eventId >= 100) fields.push(stringField(sessionId));
  fields.push(uint32(body.length), body);
  return Buffer.concat(fields);
}

export function buildAudioFrame(audio, sessionId) {
  const body = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
  return Buffer.concat([
    header(MsgType.CLIENT_AUDIO, Serialization.RAW),
    uint32(ClientEvent.TASK_REQUEST),
    stringField(sessionId),
    uint32(body.length),
    body,
  ]);
}

export function parseServerFrame(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (data.length < 4) throw new Error('豆包返回了不完整的数据帧');
  const headerBytes = (data[0] & 0x0f) * 4;
  const msgType = (data[1] >> 4) & 0x0f;
  const flags = data[1] & 0x0f;
  const serialization = (data[2] >> 4) & 0x0f;
  const compression = data[2] & 0x0f;
  let offset = headerBytes;
  let errorCode = null;
  let sequence = null;
  let eventId = null;
  let sessionId = '';

  if (msgType === MsgType.ERROR && offset + 4 <= data.length) {
    errorCode = data.readUInt32BE(offset); offset += 4;
  }
  const sequenceMode = flags & 0x03;
  if ((sequenceMode === 1 || sequenceMode === 3) && offset + 4 <= data.length) {
    sequence = data.readInt32BE(offset); offset += 4;
  }
  if ((flags & EVENT_FLAG) && offset + 4 <= data.length) {
    eventId = data.readUInt32BE(offset); offset += 4;
    if (eventId >= 100 && offset + 4 <= data.length) {
      const length = data.readUInt32BE(offset); offset += 4;
      if (length && offset + length <= data.length) {
        sessionId = data.subarray(offset, offset + length).toString('utf8'); offset += length;
      }
    }
  }

  let payload = Buffer.alloc(0);
  if (offset + 4 <= data.length) {
    const length = data.readUInt32BE(offset); offset += 4;
    if (length && offset + length <= data.length) payload = data.subarray(offset, offset + length);
  }
  if (compression === 1 && payload.length) payload = gunzipSync(payload);
  let json = null;
  if (serialization === Serialization.JSON && payload.length) {
    try { json = JSON.parse(payload.toString('utf8')); } catch { json = null; }
  }
  return { msgType, flags, serialization, eventId, sessionId, sequence, errorCode, payload, json };
}
