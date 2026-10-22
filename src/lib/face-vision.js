const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const FACE_REGIONS = {
  oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  leftEye: [33, 160, 158, 133, 153, 144],
  rightEye: [362, 385, 387, 263, 373, 380],
  leftBrow: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  rightBrow: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  lips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
  leftCheek: [50, 101, 118, 123, 147, 187, 205, 206, 203, 142, 126, 100],
  rightCheek: [280, 330, 347, 352, 376, 411, 425, 426, 423, 371, 355, 329],
  forehead: [109, 10, 338, 337, 299, 333, 298, 284, 251, 301, 71, 21, 54, 103, 67],
};

export function regionsForStep(part = '') {
  if (/眉/.test(part)) return ['leftBrow', 'rightBrow'];
  if (/眼|睫|卧蚕/.test(part)) return ['leftEye', 'rightEye', 'leftBrow', 'rightBrow'];
  if (/唇/.test(part)) return ['lips'];
  if (/腮红|气色/.test(part)) return ['leftCheek', 'rightCheek'];
  if (/高光|修容/.test(part)) return ['forehead', 'leftCheek', 'rightCheek'];
  return ['oval'];
}

function smoothNumber(previous, next, alpha) {
  return Number.isFinite(previous) ? previous + (next - previous) * alpha : next;
}

export function createFaceSmoother() {
  let landmarks = null;
  let blendshapes = {};
  let matrix = null;

  return {
    reset() { landmarks = null; blendshapes = {}; matrix = null; },
    update(result) {
      const nextPoints = result?.faceLandmarks?.[0];
      if (!nextPoints) return null;
      let movement = 0;
      if (landmarks?.length === nextPoints.length) {
        for (let i = 0; i < nextPoints.length; i += 12) {
          movement += Math.hypot(nextPoints[i].x - landmarks[i].x, nextPoints[i].y - landmarks[i].y);
        }
        movement /= Math.ceil(nextPoints.length / 12);
      }
      const pointAlpha = clamp(.2 + movement * 18, .2, .72);
      landmarks = nextPoints.map((point, index) => ({
        x: smoothNumber(landmarks?.[index]?.x, point.x, pointAlpha),
        y: smoothNumber(landmarks?.[index]?.y, point.y, pointAlpha),
        z: smoothNumber(landmarks?.[index]?.z, point.z || 0, pointAlpha),
      }));

      const categories = result.faceBlendshapes?.[0]?.categories || [];
      const nextBlendshapes = {};
      categories.forEach((item) => {
        const name = item.categoryName || item.displayName || `shape_${item.index}`;
        nextBlendshapes[name] = smoothNumber(blendshapes[name], item.score, .3);
      });
      blendshapes = nextBlendshapes;

      const nextMatrix = result.facialTransformationMatrixes?.[0];
      if (nextMatrix?.data?.length) {
        matrix = {
          rows: nextMatrix.rows,
          columns: nextMatrix.columns,
          data: nextMatrix.data.map((value, index) => smoothNumber(matrix?.data?.[index], value, .24)),
        };
      }
      return { landmarks, blendshapes, matrix };
    },
  };
}

function appearanceAverage(appearance, key) {
  return ((appearance?.left?.[key] || 0) + (appearance?.right?.[key] || 0)) / 2;
}

function sideChange(current, baseline, side) {
  const now = current?.[side]; const before = baseline?.[side];
  if (!now || !before) return 0;
  const lightShift = (current?.reference?.luma || 0) - (baseline?.reference?.luma || 0);
  const saturationShift = (current?.reference?.saturation || 0) - (baseline?.reference?.saturation || 0);
  const warmthShift = (current?.reference?.warmth || 0) - (baseline?.reference?.warmth || 0);
  return Math.abs(now.luma - before.luma - lightShift) * .32
    + Math.abs(now.saturation - before.saturation - saturationShift) * .38
    + Math.abs(now.warmth - before.warmth - warmthShift) * .2
    + Math.abs((now.lumaStd || 0) - (before.lumaStd || 0)) * .1;
}

function averagedAppearance(samples, template) {
  const averageSide = (side) => {
    const values = samples.map((sample) => sample[side]).filter(Boolean);
    if (!values.length) return null;
    return ['luma', 'saturation', 'warmth', 'lumaStd', 'saturationStd'].reduce((result, key) => {
      result[key] = values.reduce((sum, value) => sum + (value[key] || 0), 0) / values.length;
      return result;
    }, {});
  };
  const referenceValues = samples.map((sample) => sample.reference).filter(Boolean);
  const reference = referenceValues.length ? ['luma', 'saturation', 'warmth', 'lumaStd', 'saturationStd'].reduce((result, key) => {
    result[key] = referenceValues.reduce((sum, value) => sum + (value[key] || 0), 0) / referenceValues.length;
    return result;
  }, {}) : null;
  return { region: template.region, left: averageSide('left'), right: averageSide('right'), reference };
}

export function createMakeupProgressTracker() {
  let stepKey = '';
  let baselineSamples = [];
  let baseline = null;
  let postBaselineSamples = 0;
  let last = null;

  const reset = (nextKey = '') => {
    stepKey = nextKey; baselineSamples = []; baseline = null; postBaselineSamples = 0; last = null;
  };

  return {
    reset,
    update(appearance, nextKey, stable = true) {
      if (!appearance) return last;
      if (nextKey !== stepKey) reset(nextKey);
      if (!stable) return last ? { ...last, stable: false } : { stepKey, region: appearance.region, status: 'camera_unstable', stable: false, sampleCount: baselineSamples.length };
      if (!baseline) {
        baselineSamples.push(appearance);
        if (baselineSamples.length < 4) {
          last = { stepKey, region: appearance.region, status: 'calibrating', stable: true, sampleCount: baselineSamples.length };
          return last;
        }
        baseline = averagedAppearance(baselineSamples, appearance);
        last = { stepKey, region: appearance.region, status: 'tracking', stable: true, sampleCount: baselineSamples.length, changeScore: 0, symmetryDelta: appearance.symmetryDelta };
        return last;
      }

      postBaselineSamples += 1;
      const leftChange = sideChange(appearance, baseline, 'left');
      const rightChange = sideChange(appearance, baseline, 'right');
      const changeScore = (leftChange + rightChange) / 2;
      const textureDelta = appearanceAverage(appearance, 'lumaStd') - appearanceAverage(baseline, 'lumaStd');
      const symmetryDelta = appearance.symmetryDelta || 0;
      let status = 'tracking';
      if (changeScore >= 3.2 && symmetryDelta > 13) status = 'needs_balance';
      else if (changeScore >= 3.2 && textureDelta > 4.5) status = 'needs_blending';
      else if (changeScore >= 4.2) status = 'balanced';
      else if (postBaselineSamples >= 3 && changeScore < 2.7) status = 'no_change';
      const strongerSide = leftChange > rightChange + 1.6 ? 'left' : rightChange > leftChange + 1.6 ? 'right' : 'even';
      last = {
        stepKey, region: appearance.region, status, stable: true,
        sampleCount: baselineSamples.length + postBaselineSamples,
        changeScore: +changeScore.toFixed(1), symmetryDelta: +symmetryDelta.toFixed(1),
        textureDelta: +textureDelta.toFixed(1), strongerSide,
      };
      return last;
    },
  };
}

export function facePose(points) {
  if (!points) return null;
  const left = points[234]; const right = points[454]; const nose = points[1];
  const eyeL = points[33]; const eyeR = points[263]; const top = points[10]; const chin = points[152];
  const width = Math.max(Math.abs(right.x - left.x), .001);
  const centerX = (left.x + right.x) / 2;
  const roll = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x) * 180 / Math.PI;
  const yaw = clamp((nose.x - centerX) / width * 62, -35, 35);
  const vertical = Math.max(chin.y - top.y, .001);
  const pitch = clamp(((nose.y - top.y) / vertical - .53) * 70, -25, 25);
  return { roll, yaw, pitch, width, centerX, centerY: (top.y + chin.y) / 2 };
}

export function visionSignals(smoothed, segmentation, appearance, progress) {
  const pose = facePose(smoothed?.landmarks);
  if (!pose) return null;
  const pick = (name) => Number((smoothed.blendshapes?.[name] || 0).toFixed(3));
  return {
    faceDetected: true,
    landmarkCount: smoothed.landmarks.length,
    blendshapeCount: Object.keys(smoothed.blendshapes).length,
    pose: { yaw: +pose.yaw.toFixed(1), pitch: +pose.pitch.toFixed(1), roll: +pose.roll.toFixed(1) },
    expression: {
      eyeBlinkLeft: pick('eyeBlinkLeft'), eyeBlinkRight: pick('eyeBlinkRight'),
      jawOpen: pick('jawOpen'), mouthSmileLeft: pick('mouthSmileLeft'), mouthSmileRight: pick('mouthSmileRight'),
      browInnerUp: pick('browInnerUp'),
    },
    transform3d: smoothed.matrix ? { rows: smoothed.matrix.rows, columns: smoothed.matrix.columns, data: smoothed.matrix.data.map((value) => +value.toFixed(4)) } : null,
    segmentation: segmentation ? { faceCoverage: +segmentation.faceCoverage.toFixed(3), labels: segmentation.labels } : null,
    appearance: appearance || null,
    progress: progress || null,
  };
}

export function describeVision(signals, stepPart = '') {
  if (!signals) return '画面中暂未稳定检测到人脸';
  const notes = [];
  const { yaw, pitch, roll } = signals.pose;
  if (Math.abs(yaw) > 7) notes.push(`面部向${yaw > 0 ? '左' : '右'}偏转约${Math.abs(yaw).toFixed(0)}度`);
  if (Math.abs(pitch) > 7) notes.push(`面部${pitch > 0 ? '低头' : '抬头'}约${Math.abs(pitch).toFixed(0)}度`);
  if (Math.abs(roll) > 5) notes.push(`头部倾斜约${Math.abs(roll).toFixed(0)}度`);
  const expression = signals.expression;
  if (/眼|睫|眉/.test(stepPart) && (expression.eyeBlinkLeft > .45 || expression.eyeBlinkRight > .45)) notes.push('当前有一侧眼睛闭合，暂不适合判断左右对称');
  if (/唇/.test(stepPart) && expression.jawOpen > .35) notes.push('当前嘴部张开，唇形边界会被拉伸');
  const progress = signals.progress;
  if (progress?.status === 'calibrating') notes.push('正在记录这个步骤开始时的妆面作为对照');
  else if (progress?.status === 'no_change') notes.push('与这个步骤开始时相比，当前区域还没有出现明确的上妆变化');
  else if (progress?.status === 'needs_balance') notes.push(`${progress.strongerSide === 'left' ? '画面左侧' : progress.strongerSide === 'right' ? '画面右侧' : '一侧'}的颜色或明暗变化更明显，左右还不够均匀`);
  else if (progress?.status === 'needs_blending') notes.push('当前区域已经有上妆变化，但局部纹理和边界还不够均匀');
  else if (progress?.status === 'balanced') notes.push('检测到当前区域有明确上妆变化，左右差异较小');
  else if (signals.appearance?.symmetryDelta != null) notes.push(`当前区域左右颜色和明暗${signals.appearance.symmetryDelta < 9 ? '比较接近' : '有可见差异'}`);
  if (!notes.length) notes.push('当前画面稳定，正在比较这个步骤前后的妆面变化');
  return notes.slice(0, 2).join('；');
}

export function visionIssueKey(signals, stepPart = '') {
  if (!signals) return '';
  const { yaw, pitch, roll } = signals.pose;
  if (Math.abs(yaw) > 8) return `yaw-${yaw > 0 ? 'left' : 'right'}`;
  if (Math.abs(pitch) > 9) return `pitch-${pitch > 0 ? 'down' : 'up'}`;
  if (Math.abs(roll) > 6) return `roll-${roll > 0 ? 'left' : 'right'}`;
  if (/眼|睫|眉/.test(stepPart) && (signals.expression.eyeBlinkLeft > .5 || signals.expression.eyeBlinkRight > .5)) return 'eyes-closed';
  if (/唇/.test(stepPart) && signals.expression.jawOpen > .4) return 'mouth-open';
  if (signals.progress?.status === 'needs_balance') return `progress-balance-${signals.progress.region || 'face'}`;
  if (signals.progress?.status === 'needs_blending') return `progress-blend-${signals.progress.region || 'face'}`;
  if (signals.progress?.status === 'no_change') return `progress-none-${signals.progress.region || 'face'}`;
  if (signals.appearance?.symmetryDelta > 14) return `symmetry-${signals.appearance.region || 'face'}`;
  return '';
}

export function visionNeedsAttention(signals, stepPart = '') {
  return Boolean(visionIssueKey(signals, stepPart));
}
