import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Camera, CameraOff, ScanFace, Sparkles } from 'lucide-react';
import { readJson } from '../lib/api';
import { createFaceSmoother, createMakeupProgressTracker, describeVision, FACE_REGIONS, facePose, regionsForStep, visionIssueKey, visionSignals } from '../lib/face-vision';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const SEGMENT_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const SEGMENT_LABELS = ['背景', '头发', '身体', '面部', '服装', '其他'];

function frameCanvas(video, width = 480) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, width / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.translate(canvas.width, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function regionStats(ctx, pixels, width, height, points, indexes, side = '') {
  const coords = indexes.map((index) => ({ x: (1 - points[index].x) * width, y: points[index].y * height }));
  const path = new Path2D(); coords.forEach((point, index) => index ? path.lineTo(point.x, point.y) : path.moveTo(point.x, point.y)); path.closePath();
  const minX = Math.max(0, Math.floor(Math.min(...coords.map((point) => point.x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...coords.map((point) => point.x))));
  const minY = Math.max(0, Math.floor(Math.min(...coords.map((point) => point.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...coords.map((point) => point.y))));
  const center = coords.reduce((sum, point) => sum + point.x, 0) / coords.length;
  let count = 0; let luma = 0; let saturation = 0; let warmth = 0; let lumaSq = 0; let saturationSq = 0;
  for (let y = minY; y <= maxY; y += 2) for (let x = minX; x <= maxX; x += 2) {
    if (!ctx.isPointInPath(path, x, y) || (side === 'left' && x > center) || (side === 'right' && x <= center)) continue;
    const offset = (y * width + x) * 4; const r = pixels[offset]; const g = pixels[offset + 1]; const b = pixels[offset + 2];
    const high = Math.max(r, g, b); const low = Math.min(r, g, b);
    const sampleLuma = r * .2126 + g * .7152 + b * .0722; const sampleSaturation = high ? (high - low) / high * 100 : 0;
    luma += sampleLuma; saturation += sampleSaturation; warmth += r - b; lumaSq += sampleLuma * sampleLuma; saturationSq += sampleSaturation * sampleSaturation; count += 1;
  }
  if (!count) return null;
  const meanLuma = luma / count; const meanSaturation = saturation / count;
  return { luma: meanLuma, saturation: meanSaturation, warmth: warmth / count, lumaStd: Math.sqrt(Math.max(0, lumaSq / count - meanLuma ** 2)), saturationStd: Math.sqrt(Math.max(0, saturationSq / count - meanSaturation ** 2)) };
}

function measureAppearance(video, points, part = '') {
  const canvas = frameCanvas(video, 192); const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let left; let right; let region = 'face';
  if (/眉/.test(part)) { region = 'brows'; left = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.leftBrow); right = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.rightBrow); }
  else if (/眼|睫|卧蚕/.test(part)) { region = 'eyes'; left = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.leftEye); right = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.rightEye); }
  else if (/腮红|气色|修容|高光/.test(part)) { region = 'cheeks'; left = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.leftCheek); right = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.rightCheek); }
  else if (/唇/.test(part)) { region = 'lips'; left = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.lips, 'left'); right = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.lips, 'right'); }
  else { left = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.leftCheek); right = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.rightCheek); }
  if (!left || !right) return null;
  const reference = regionStats(ctx, pixels, canvas.width, canvas.height, points, FACE_REGIONS.forehead);
  const symmetryDelta = Math.abs(left.luma - right.luma) * .55 + Math.abs(left.saturation - right.saturation) * .25 + Math.abs(left.warmth - right.warmth) * .2;
  return { region, symmetryDelta: +symmetryDelta.toFixed(1), left, right, reference };
}

function localCheck(packet) {
  if (!packet) return '请把脸移入画面';
  const pose = facePose(packet.points); const ratio = pose?.width || 0;
  if (ratio < .34) return '再靠近一点，细节会更清楚';
  if (ratio > .72) return '稍微后退，保留完整脸部';
  if (Math.abs((pose?.centerX || .5) - .5) > .12) return pose.centerX > .5 ? '向右一点，回到取景框中央' : '向左一点，回到取景框中央';
  if (Math.abs(packet.data.pose.roll) > 6) return '把头摆正，再看两侧是否均匀';
  if (Math.abs(packet.data.pose.yaw) > 8) return packet.data.pose.yaw > 0 ? '脸稍向右转，保持正对镜头' : '脸稍向左转，保持正对镜头';
  if (packet.data.progress?.status === 'needs_balance') return `${packet.data.progress.strongerSide === 'left' ? '画面左侧' : '画面右侧'}颜色更明显，少量补另一侧再晕开`;
  if (packet.data.progress?.status === 'needs_blending') return '边界还有些明显，用干净刷具轻轻晕开';
  if (packet.data.progress?.status === 'no_change') return '暂时没看到明显变化，可以少量上妆后再看';
  if (packet.data.appearance?.symmetryDelta > 15) return '左右颜色有些差异，先少量补较浅的一侧';
  return '';
}

const LiveMirror = forwardRef(function LiveMirror({ look, step, voiceActive, onFeedback, onLocalFeedback, onVisionSnapshot }, ref) {
  const videoRef = useRef(null); const canvasRef = useRef(null); const streamRef = useRef(null); const landmarkerRef = useRef(null); const segmenterRef = useRef(null);
  const segmentCanvasRef = useRef(document.createElement('canvas')); const animationRef = useRef(null); const checkingRef = useRef(false); const cloudEnabledRef = useRef(true);
  const smootherRef = useRef(createFaceSmoother()); const progressRef = useRef(createMakeupProgressTracker()); const lastPoseRef = useRef({ text: '', at: 0, checked: 0 }); const visionRef = useRef(null);
  const segmentRef = useRef(null); const lastSegmentAtRef = useRef(0); const lastAppearanceAtRef = useRef(0); const appearanceRef = useRef(null);
  const [status, setStatus] = useState('idle'); const [faceVisible, setFaceVisible] = useState(false);
  const [analysis, setAnalysis] = useState(null); const [liveHint, setLiveHint] = useState(''); const [error, setError] = useState('');

  const stopCamera = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    smootherRef.current.reset(); progressRef.current.reset(); visionRef.current = null; segmentRef.current = null; appearanceRef.current = null;
    setFaceVisible(false); setLiveHint(''); setAnalysis(null); setError(''); setStatus('idle');
  }, []);

  useEffect(() => () => { stopCamera(); landmarkerRef.current?.close(); segmenterRef.current?.close(); }, [stopCamera]);

  const runSegmentation = useCallback((video, now) => {
    if (!segmenterRef.current || now - lastSegmentAtRef.current < 220) return;
    lastSegmentAtRef.current = now;
    const result = segmenterRef.current.segmentForVideo(video, now); const mask = result.categoryMask;
    if (!mask) { result.close(); return; }
    const values = mask.getAsUint8Array(); const surface = segmentCanvasRef.current;
    surface.width = mask.width; surface.height = mask.height; const image = new ImageData(mask.width, mask.height); let facePixels = 0;
    for (let i = 0; i < values.length; i += 1) {
      const category = values[i]; if (category === 3) facePixels += 1;
      const offset = i * 4; image.data[offset] = 238; image.data[offset + 1] = 164; image.data[offset + 2] = 177; image.data[offset + 3] = category === 3 ? 42 : 0;
    }
    surface.getContext('2d').putImageData(image, 0, 0);
    segmentRef.current = { faceCoverage: facePixels / values.length, labels: SEGMENT_LABELS };
    result.close();
  }, []);

  const drawGuide = useCallback((result) => {
    const video = videoRef.current; const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const rect = video.getBoundingClientRect(); const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
    const smoothed = smootherRef.current.update(result); const points = smoothed?.landmarks; setFaceVisible(Boolean(points));
    if (!points) { setLiveHint('请把脸移入画面'); visionRef.current = null; return; }
    const now = performance.now(); runSegmentation(video, now);
    let progress = visionRef.current?.data?.progress || null;
    if (now - lastAppearanceAtRef.current > 900) {
      lastAppearanceAtRef.current = now; appearanceRef.current = measureAppearance(video, points, step?.part);
      const pose = facePose(points); const stable = Boolean(pose && Math.abs(pose.yaw) < 8 && Math.abs(pose.pitch) < 9 && Math.abs(pose.roll) < 6);
      progress = progressRef.current.update(appearanceRef.current, `${step?.part || ''}:${step?.title || ''}`, stable);
    }
    const data = visionSignals(smoothed, segmentRef.current, appearanceRef.current, progress); visionRef.current = { data, points };

    if (segmentRef.current) { ctx.save(); ctx.translate(rect.width, 0); ctx.scale(-1, 1); ctx.drawImage(segmentCanvasRef.current, 0, 0, rect.width, rect.height); ctx.restore(); }
    const map = (index) => [(1 - points[index].x) * rect.width, points[index].y * rect.height]; const active = regionsForStep(step?.part);
    Object.entries(FACE_REGIONS).forEach(([name, indexes]) => {
      const focused = active.includes(name); if (!focused && !['oval', 'leftEye', 'rightEye', 'lips'].includes(name)) return;
      ctx.beginPath(); indexes.forEach((index, i) => { const [x, y] = map(index); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath();
      if (focused && name !== 'oval') { ctx.fillStyle = 'rgba(241,174,184,.12)'; ctx.fill(); }
      ctx.lineWidth = focused ? 2.2 : .72; ctx.strokeStyle = focused ? 'rgba(255,230,220,.96)' : 'rgba(255,255,255,.22)';
      if (focused) { ctx.shadowColor = 'rgba(235,143,151,.78)'; ctx.shadowBlur = 11; } ctx.stroke(); ctx.shadowBlur = 0;
    });

    if (now - lastPoseRef.current.checked > 900) {
      lastPoseRef.current.checked = now; const hint = localCheck(visionRef.current); setLiveHint(hint);
      if (hint && (hint !== lastPoseRef.current.text || now - lastPoseRef.current.at > 9000)) {
        lastPoseRef.current = { ...lastPoseRef.current, text: hint, at: now }; onLocalFeedback?.({ summary: hint, suggestions: [hint], source: 'local' });
      }
    }
  }, [onLocalFeedback, runSegmentation, step?.part, step?.title]);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return true;
    setError(''); setStatus('loading'); cloudEnabledRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30 } }, audio: false });
      streamRef.current = stream; videoRef.current.srcObject = stream; await videoRef.current.play(); setStatus('ready');
      if (!landmarkerRef.current || !segmenterRef.current) {
        const { FaceLandmarker, FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision'); const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        if (!landmarkerRef.current) landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1,
          minFaceDetectionConfidence: .62, minFacePresenceConfidence: .62, minTrackingConfidence: .72,
          outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        });
        if (!segmenterRef.current) segmenterRef.current = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: SEGMENT_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false,
        });
      }
      const detect = () => {
        if (!videoRef.current || !streamRef.current) return;
        const now = performance.now(); drawGuide(landmarkerRef.current.detectForVideo(videoRef.current, now)); animationRef.current = requestAnimationFrame(detect);
      };
      detect(); return true;
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? '请允许相机权限' : `相机没有启动${err.message ? `：${err.message}` : ''}`); setStatus('idle'); return false;
    }
  }, [drawGuide]);

  const analyzeFrame = useCallback(async () => {
    if (!videoRef.current?.videoWidth || checkingRef.current || !cloudEnabledRef.current) return;
    checkingRef.current = true; setStatus('checking'); setError('');
    try {
      const capture = frameCanvas(videoRef.current, 960);
      const response = await fetch('/api/analyze-face', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: capture.toDataURL('image/jpeg', .72), lookTitle: look?.title, stepTitle: step?.title, stepPart: step?.part, stepDetail: step?.detail, stepRisk: step?.risk }) });
      const data = await readJson(response, '云端妆面检查暂不可用'); setAnalysis(data); onFeedback?.({ ...data, source: 'vision' });
    } catch (err) {
      if (/OPENAI_API_KEY|未配置|服务器响应/.test(err.message)) { cloudEnabledRef.current = false; setError('精细检查待配置'); } else setError(err.message);
    } finally { checkingRef.current = false; setStatus(streamRef.current ? 'ready' : 'idle'); }
  }, [look, onFeedback, step]);

  const sendRealtimeSnapshot = useCallback(() => {
    const video = videoRef.current; const packet = visionRef.current; if (!video?.videoWidth || !packet?.data) return;
    const image = frameCanvas(video, 480).toDataURL('image/jpeg', .56);
    const issueKey = visionIssueKey(packet.data, step?.part);
    onVisionSnapshot?.({ image, signals: packet.data, summary: describeVision(packet.data, step?.part), attention: Boolean(issueKey), issueKey, capturedAt: Date.now(), context: { lookTitle: look?.title, stepPart: step?.part, stepTitle: step?.title } });
  }, [look?.title, onVisionSnapshot, step?.part, step?.title]);

  useEffect(() => {
    if (!voiceActive || !streamRef.current || status === 'idle' || status === 'loading') return undefined;
    const first = window.setTimeout(sendRealtimeSnapshot, 4300); const interval = window.setInterval(sendRealtimeSnapshot, 5000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [sendRealtimeSnapshot, status, voiceActive]);

  useImperativeHandle(ref, () => ({ startCamera, stopCamera, analyzeFrame, captureVision: sendRealtimeSnapshot }), [analyzeFrame, sendRealtimeSnapshot, startCamera, stopCamera]);

  return <div className={`live-mirror ${status}`}>
    <video ref={videoRef} muted playsInline className={status === 'idle' ? 'hidden-video' : ''} /><canvas ref={canvasRef} />
    {status === 'idle' && <button className="mirror-start" onClick={startCamera}><ScanFace size={30} strokeWidth={1.4} /><span>打开镜头</span></button>}
    {status === 'loading' && <div className="mirror-loading">正在打开…</div>}
    {status !== 'idle' && <><div className="mirror-topline"><span className={faceVisible ? 'found' : ''}>{faceVisible ? `实时定位 · ${step?.part || '全脸'}` : '请正对镜头'}</span><button onClick={stopCamera} aria-label="关闭镜头"><CameraOff size={16} /></button></div><button className="mirror-check" onClick={analyzeFrame} disabled={status === 'checking' || !cloudEnabledRef.current}><Sparkles size={14} />{status === 'checking' ? '检查中' : '精细检查'}</button></>}
    {(analysis || liveHint || error) && <div className={`mirror-feedback ${error ? 'warn' : ''}`}>{error || liveHint || analysis.summary}</div>}
    <div className="camera-corner"><Camera size={14} /> {voiceActive ? 'Marie 持续观察中' : '镜头待命'}</div>
  </div>;
});

export default LiveMirror;
