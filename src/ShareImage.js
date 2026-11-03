// ==========================================
// ShareImage.js — トレーニング記録のシェア画像（Strava風コラージュ）
// デザイン確定: v10（枠なし・写真全面、上部=投稿カードUI準拠の記録、
// 下部=種目数/set/時間を大きく、総負荷量・消費は小さく、右下ワードマーク）
// 記録が多い場合は 左→右2列、それでも収まらなければ3列に自動で流す。
// 撮影はライブカメラ（映像に記録を重ねたまま撮影）とアルバム選択の両対応。
// ==========================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Camera, Image as ImageIcon, Share, RotateCcw, Download } from 'lucide-react';
import { calculateWorkoutTotals } from './utils';
import { isNativeIosApp, postNativeMessage, triggerHaptic, requestShareCamera, saveImageNative, shareToInstagramStoriesNative } from './nativeBridge';

const CW = 1080;
const CH = 1920;
const MX = 56;
const FONT = '"Hiragino Kaku Gothic ProN", -apple-system, BlinkMacSystemFont, sans-serif';
// 投稿カードの数値と同じ書体（等幅・最太）: カード側は font-mono + font-black
const MONO = '"SF Mono", ui-monospace, Menlo, monospace';

const COL = {
  white: '#ffffff',
  slate: '#b2bac6',
  gray: '#c6cad4',
  orange: '#f97316',
  purple: '#a78bfa',
  blue: '#60a5fa',
  rose: '#fb7185',
  brand: '#0070C0',
};

// ---- セット1行分のセグメント（投稿カードの表記に合わせる） ----
function fmtSetSegments(setObj, wType, type) {
  const val = (f) => {
    let field = f;
    if (type === 'super2') field = 'super' + f.charAt(0).toUpperCase() + f.slice(1);
    if (type === 'super3') field = 'super' + f.charAt(0).toUpperCase() + f.slice(1) + '3';
    return setObj ? setObj[field] : '';
  };
  const num = (t) => ({ t: String(t), kind: 'num' });
  const unit = (t, color) => ({ t: String(t), kind: 'unit', color });

  if (wType === 'cardio') {
    const distance = val('distance');
    const time = val('time');
    const calories = val('calories');
    if (!distance && !time && !calories) return null;
    const segs = [];
    if (distance) segs.push(num(distance), unit(' km'));
    if (time) segs.push(num(time), unit(' 分'));
    if (calories) segs.push(num(calories), unit(' kcal'));
    return segs;
  }

  const weight = val('weight');
  const reps = val('reps');
  const lReps = val('lReps');
  const rReps = val('rReps');
  const forced = val('forcedReps');
  if (!weight && !reps && !lReps && !rReps) return null;

  let displayWeight = weight || 0;
  let weightLabel = 'kg';
  if (wType === 'plate') weightLabel = '枚';
  else if (wType === 'oneSide') weightLabel = 'kg(片)';
  else if (wType === 'bodyWeight') {
    if (Number(weight) < 0) { displayWeight = weight; weightLabel = 'kg'; }
    else if (Number(weight) > 0) { displayWeight = `+${weight}`; weightLabel = 'kg'; }
    else { displayWeight = '自重'; weightLabel = ''; }
  }

  const isLR = wType === 'lr';
  const segs = [num(displayWeight)];
  if (weightLabel) segs.push(unit(' ' + weightLabel));
  segs.push({ t: ' × ', kind: 'cross' });
  segs.push(num(isLR ? `L${lReps || 0} R${rReps || 0}` : (reps || 0)));
  segs.push(unit(' 回'));
  if (forced) segs.push(unit(` (+${forced})`, COL.rose));
  return segs;
}

// ---- 投稿データ → 描画モデル ----
export function buildShareModel(post) {
  const items = post.items || [];
  const baseWeight = Number(post.bodyWeight) || 60;
  const { processedItems, totalVolume, totalCalories } = calculateWorkoutTotals(items, post.duration, baseWeight);
  const volume = (post.volume && post.volume > 0) ? post.volume : totalVolume;
  const calories = (post.calories && post.calories > 0) ? post.calories : totalCalories;
  const sets = post.totalSets || processedItems.reduce((acc, it) => acc + (it.sets?.length || 0), 0);

  const dt = new Date(post.timestamp || post.date || Date.now());
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dateText = `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')} ${days[dt.getDay()]}`;
  const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
  const titlePart = (cats.length === 1 && ['脚', '胸', '背中', '肩', '腕'].includes(cats[0])) ? `${cats[0]}トレ` : '';
  const header = [dateText, post.gymName || '', titlePart].filter(Boolean).join(' / ');

  const blocks = [];
  (processedItems.length ? processedItems : items).forEach((item) => {
    const rows = [];
    if (item.isSuperSet && item.superExerciseName) {
      rows.push({ kind: 'sub', text: `スーパー: ${item.superExerciseName}` });
      if (item.superExerciseName3) rows.push({ kind: 'sub', text: `ジャイアント: ${item.superExerciseName3}` });
    }
    (item.sets || []).forEach((set, sIdx) => {
      const main = fmtSetSegments(set, item.weightType, 'main');
      if (main) rows.push({ kind: 'row', label: `set ${sIdx + 1}`, labelColor: COL.slate, indent: 0, segs: main });
      if (item.isDropSet && set.dropSets) {
        set.dropSets.forEach((ds) => {
          const s = fmtSetSegments(ds, item.weightType, 'main');
          if (s) rows.push({ kind: 'row', label: 'drop', labelColor: COL.orange, arrow: true, indent: 1, segs: s });
        });
      }
      if (item.isSuperSet && item.superExerciseName) {
        const sup = fmtSetSegments(set, item.superWeightType || 'total', 'super2');
        if (sup) rows.push({ kind: 'row', label: 'Sup2', labelColor: COL.purple, indent: 1, segs: sup });
        if (item.isDropSet && set.superDropSets) {
          set.superDropSets.forEach((ds) => {
            const s = fmtSetSegments(ds, item.superWeightType || 'total', 'super2');
            if (s) rows.push({ kind: 'row', label: 'drop', labelColor: COL.orange, arrow: true, indent: 2, segs: s });
          });
        }
      }
      if (item.isSuperSet && item.superExerciseName3) {
        const sup = fmtSetSegments(set, item.superWeightType3 || 'total', 'super3');
        if (sup) rows.push({ kind: 'row', label: 'Sup3', labelColor: COL.purple, indent: 1, segs: sup });
        if (item.isDropSet && set.superDropSets3) {
          set.superDropSets3.forEach((ds) => {
            const s = fmtSetSegments(ds, item.superWeightType3 || 'total', 'super3');
            if (s) rows.push({ kind: 'row', label: 'drop', labelColor: COL.orange, arrow: true, indent: 2, segs: s });
          });
        }
      }
    });
    if (rows.length) blocks.push({ name: item.exerciseName || '', rows });
  });

  const durMin = post.duration ? Math.round(post.duration / 60000) : 0;
  return {
    header,
    blocks,
    stats: { exCount: items.length, sets, durMin, volume: Math.round(volume || 0), calories: Math.round(calories || 0) },
  };
}

// ---- 列レイアウト（左→右に流す。1列→2列→3列の順に試す） ----
function packColumns(blocks, maxCols, k, budget, overflowLast = false) {
  const headerH = 43 * k;
  const rowH = 35 * k;
  const gapH = 14 * k;
  const columns = [[]];
  let used = 0;
  const newColumn = () => {
    if (overflowLast && columns.length >= maxCols) return; // 最終列は予算を超えても続ける（内容を落とさない）
    columns.push([]); used = 0;
  };
  const cur = () => columns[columns.length - 1];

  blocks.forEach((block, bi) => {
    if (bi > 0) {
      if (used + gapH > budget && used > 0) newColumn();
      else if (used > 0) { cur().push({ kind: 'gap', y: used, h: gapH }); used += gapH; }
    }
    // 見出しは最低1行と一緒に置く
    const need = headerH + (block.rows.length ? rowH : 0);
    if (used > 0 && used + need > budget) newColumn();
    cur().push({ kind: 'header', y: used, h: headerH, text: block.name });
    used += headerH;
    block.rows.forEach((row) => {
      if (used > 0 && used + rowH > budget) newColumn();
      cur().push({ kind: row.kind, y: used, h: rowH, row });
      used += rowH;
    });
  });
  return columns.length <= maxCols ? columns : null;
}

function layoutBlocks(blocks) {
  const budget = 1090;
  let cols = packColumns(blocks, 1, 1, budget);
  if (cols) return { columns: cols, k: 1 };
  cols = packColumns(blocks, 2, 0.86, budget);
  if (cols) return { columns: cols, k: 0.86 };
  cols = packColumns(blocks, 3, 0.74, budget);
  if (cols) return { columns: cols, k: 0.74 };
  // 3列でも溢れる場合は最終列だけ予算超過を許して全内容を描く
  return { columns: packColumns(blocks, 3, 0.74, budget, true), k: 0.74 };
}

// ---- Canvas 描画 ----
// opts.transparent: 背景・写真を描かず文字とグラデだけ（ライブカメラの重ね表示用）
// opts.mirror: 写真を左右反転して描く（インカメラ撮影用）
function drawShareCard(ctx, img, view, model, opts = {}) {
  ctx.clearRect(0, 0, CW, CH);
  if (!opts.transparent) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CW, CH);
  }

  if (img) {
    const iw = img.videoWidth || img.naturalWidth || img.width;
    const ih = img.videoHeight || img.naturalHeight || img.height;
    const base = Math.max(CW / iw, CH / ih);
    const scale = base * (view.s || 1);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (CW - dw) / 2 + (view.x || 0);
    const dy = (CH - dh) / 2 + (view.y || 0);
    if (opts.mirror) {
      ctx.save();
      ctx.translate(CW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(img, dx, dy, dw, dh);
    }
  }

  // グラデーション（上・下）
  let g = ctx.createLinearGradient(0, 0, 0, 560);
  g.addColorStop(0, 'rgba(0,0,0,0.43)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CW, 560);
  g = ctx.createLinearGradient(0, CH - 640, 0, CH);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.86)');
  ctx.fillStyle = g;
  ctx.fillRect(0, CH - 640, CW, 640);

  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  // ヘッダー
  ctx.font = `700 31px ${FONT}`;
  ctx.fillStyle = COL.white;
  ctx.fillText(model.header, MX, 44);

  // 記録（列レイアウト）
  const { columns, k } = layoutBlocks(model.blocks);
  const nCols = columns.length;
  const gapX = 36;
  const colW = (CW - MX * 2 - gapX * (nCols - 1)) / nCols;
  const topY = 116;

  const drawArrow = (x, y) => {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = COL.orange;
    ctx.fillStyle = COL.orange;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 1);
    ctx.lineTo(x + 2, y + 12);
    ctx.lineTo(x + 12, y + 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 7);
    ctx.lineTo(x + 12, y + 17);
    ctx.lineTo(x + 19, y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  columns.forEach((lines, ci) => {
    const colX = MX + ci * (colW + gapX);
    // 2列以上のときは右端の列を右詰めにする
    const rightAlign = nCols >= 2 && ci === nCols - 1;
    lines.forEach((ln) => {
      const y = topY + ln.y;
      if (ln.kind === 'header') {
        ctx.font = `700 ${27 * k}px ${FONT}`;
        ctx.fillStyle = COL.white;
        let t = ln.text;
        while (t.length > 1 && ctx.measureText(t).width > colW) t = t.slice(0, -1);
        if (t !== ln.text) t = t.slice(0, -1) + '…';
        ctx.fillText(t, rightAlign ? colX + colW - ctx.measureText(t).width : colX, y);
      } else if (ln.kind === 'sub') {
        ctx.font = `700 ${20 * k}px ${FONT}`;
        ctx.fillStyle = COL.blue;
        ctx.fillText(ln.row.text, rightAlign ? colX + colW - ctx.measureText(ln.row.text).width : colX + 4, y + 4 * k);
      } else if (ln.kind === 'row') {
        const row = ln.row;
        // セグメント（列幅に収まらない場合は行だけ縮小）
        const numPx = 24 * k;
        const unitPx = 16 * k;
        const segFont = (seg) => `700 ${seg.kind === 'num' ? numPx : seg.kind === 'cross' ? 19 * k : unitPx}px ${FONT}`;
        let totalW = 0;
        row.segs.forEach((seg) => { ctx.font = segFont(seg); totalW += ctx.measureText(seg.t).width; });
        const avail = colW - 150 * k;
        const shrink = totalW > avail ? Math.max(0.78, avail / totalW) : 1;
        const segsW = totalW * shrink;
        const drawSegsFrom = (sx0) => {
          let sx = sx0;
          row.segs.forEach((seg) => {
            const base = seg.kind === 'num' ? numPx : seg.kind === 'cross' ? 19 * k : unitPx;
            ctx.font = `700 ${base * shrink}px ${FONT}`;
            ctx.fillStyle = seg.color || (seg.kind === 'num' ? COL.white : COL.gray);
            const yOff = seg.kind === 'num' ? 0 : (numPx - unitPx) * shrink * 0.9;
            ctx.fillText(seg.t, sx, y + yOff);
            sx += ctx.measureText(seg.t).width;
          });
        };
        ctx.font = `700 ${20 * k}px ${FONT}`;
        ctx.fillStyle = row.labelColor;
        if (rightAlign) {
          // 行全体を右端（インデント分は内側へ）に寄せ、ラベル→値の順で描く
          const endX = colX + colW - row.indent * 30 * k;
          const segsX = endX - segsW;
          const labelW = ctx.measureText(row.label).width;
          const labelBlockW = (row.arrow ? 26 * k : 0) + labelW;
          const labelX = Math.max(colX, segsX - 16 * k - labelBlockW);
          if (row.arrow) {
            drawArrow(labelX, y + 5 * k);
            ctx.fillText(row.label, labelX + 26 * k, y + 3 * k);
          } else {
            ctx.fillText(row.label, labelX, y + 3 * k);
          }
          drawSegsFrom(segsX);
        } else {
          const x = colX + row.indent * 30 * k;
          if (row.arrow) {
            drawArrow(x, y + 5 * k);
            ctx.fillText(row.label, x + 26 * k, y + 3 * k);
          } else {
            ctx.fillText(row.label, x, y + 3 * k);
          }
          drawSegsFrom(colX + 150 * k);
        }
      }
    });
  });

  // 下部サマリー（v10デザイン）※数値は投稿カードと同じ等幅・最太フォント
  const { exCount, sets, durMin, volume, calories } = model.stats;
  const fontFor = (px, mono) => (mono ? `900 ${px}px ${MONO}` : `700 ${px}px ${FONT}`);
  const segW = (segs) => segs.reduce((acc, [t, px, , mono]) => { ctx.font = fontFor(px, mono); return acc + ctx.measureText(t).width; }, 0);
  const drawSegs = (x, yTop, basePx, segs) => {
    let cx = x;
    segs.forEach(([t, px, color, mono]) => {
      ctx.font = fontFor(px, mono);
      ctx.fillStyle = color || COL.white;
      ctx.fillText(t, cx, yTop + (basePx - px));
      cx += ctx.measureText(t).width;
    });
    return cx - x;
  };

  const groups = [
    [[String(exCount), 132, null, true], ['種目', 64]],
    [[String(sets), 132, null, true], [' set', 64]],
  ];
  if (durMin > 0) {
    const h = Math.floor(durMin / 60);
    const m = durMin % 60;
    if (h > 0) groups.push([[String(h), 80, null, true], [' h ', 42], [String(m), 80, null, true], [' m', 42]]);
    else groups.push([[String(m), 132, null, true], [' m', 64]]);
  }
  const widths = groups.map(segW);
  const totalW = widths.reduce((a, b) => a + b, 0);
  const gap = groups.length > 1 ? (CW - MX * 2 - totalW) / (groups.length - 1) : 0;
  let gx = MX;
  const SY = CH - 326;
  groups.forEach((segs, i) => { drawSegs(gx, SY, 132, segs); gx += widths[i] + gap; });

  // 第2段: 総負荷量・消費（ラベル付き）＋ワードマーク
  const Y2 = CH - 148;
  let x2 = MX;
  const labeled = (label, numText, unitText) => {
    ctx.font = `700 30px ${FONT}`;
    ctx.fillStyle = COL.gray;
    ctx.fillText(label, x2, Y2 + 32);
    x2 += ctx.measureText(label).width + 14;
    ctx.font = `900 54px ${MONO}`;
    ctx.fillStyle = COL.white;
    ctx.fillText(numText, x2, Y2 + 8);
    x2 += ctx.measureText(numText).width + 6;
    ctx.font = `700 28px ${FONT}`;
    ctx.fillStyle = COL.gray;
    ctx.fillText(unitText, x2, Y2 + 34);
    x2 += ctx.measureText(unitText).width;
  };
  if (volume > 0) { labeled('総負荷量', volume.toLocaleString(), 'kg'); x2 += 52; }
  if (calories > 0) { labeled('消費', calories.toLocaleString(), 'kcal'); }

  ctx.font = `700 50px ${FONT}`;
  const wFit = ctx.measureText('Fit').width;
  const wWith = ctx.measureText('With').width;
  ctx.fillStyle = COL.brand;
  ctx.fillText('Fit', CW - MX - wFit, CH - 140);
  ctx.fillStyle = COL.white;
  ctx.fillText('With', CW - MX - wFit - wWith, CH - 140);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// ---- ネイティブ編集画面（全面Swift）への入口 ----
// 記録の描画だけを透明PNG（オーバーレイ）にしてSwiftへ渡し、写真の選択・
// 位置調整・合成・保存・共有はすべてSwift側の編集画面で行う。
export async function openShareEditorNative(post, autoOpen = 'none') {
  try {
    const model = buildShareModel(post);
    const oc = document.createElement('canvas');
    oc.width = CW;
    oc.height = CH;
    drawShareCard(oc.getContext('2d'), null, { s: 1, x: 0, y: 0 }, model, { transparent: true });
    const blob = await new Promise((res) => oc.toBlob(res, 'image/png'));
    if (!blob) return;
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
    if (!base64) return;
    postNativeMessage({ type: 'OPEN_SHARE_EDITOR', overlay: base64, autoOpen });
  } catch (e) {
    // 失敗時は無言で戻る（入口ボタンの連打で再試行できる）
  }
}

// ---- モーダル ----
// 撮影はネイティブカメラ（Swift側）に任せる。WebView内の getUserMedia は
// v47以降の共有フリーズの温床になったため撤去した。
export function ShareImageModal({ post, autoPick, onClose }) {
  const canvasRef = useRef(null);
  const albRef = useRef(null);
  const camFileRef = useRef(null);
  const [img, setImg] = useState(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [shared, setShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pointersRef = useRef(new Map());
  const lastPinchRef = useRef(null);
  const imgRef = useRef(null);
  const viewRef = useRef({ s: 1, x: 0, y: 0 });
  const edgeRef = useRef({ x: false, y: false, sMin: false, sMax: false, fit: false, lastAt: 0 });
  const model = useMemo(() => buildShareModel(post), [post]);

  // 写真が常に画面を覆う範囲にだけ動かせるよう制限する（黒い余白を作らない）
  const clampView = (v, image) => {
    if (!image) return { s: 1, x: 0, y: 0 };
    const iw = image.videoWidth || image.naturalWidth || image.width;
    const ih = image.videoHeight || image.naturalHeight || image.height;
    if (!iw || !ih) return v;
    const base = Math.max(CW / iw, CH / ih);
    const s = Math.min(4, Math.max(1, v.s || 1));
    const dw = iw * base * s;
    const dh = ih * base * s;
    const maxX = Math.max(0, (dw - CW) / 2);
    const maxY = Math.max(0, (dh - CH) / 2);
    return {
      s,
      x: Math.min(maxX, Math.max(-maxX, v.x || 0)),
      y: Math.min(maxY, Math.max(-maxY, v.y || 0)),
      _maxX: maxX,
      _maxY: maxY,
    };
  };

  // 枠にカチッとはまった瞬間だけ触覚で知らせる（端への到達・ぴったり収まる状態）
  const applyView = (raw) => {
    const c = clampView(raw, imgRef.current);
    const now = Date.now();
    const prev = edgeRef.current;
    const EPS = 0.5;
    const state = {
      x: c._maxX !== undefined && Math.abs(Math.abs(c.x) - c._maxX) < EPS && c._maxX > 0,
      y: c._maxY !== undefined && Math.abs(Math.abs(c.y) - c._maxY) < EPS && c._maxY > 0,
      sMin: c.s <= 1,
      sMax: c.s >= 4,
      fit: c.s === 1 && c.x === 0 && c.y === 0,
    };
    const hitEdge = (state.x && !prev.x) || (state.y && !prev.y) || (state.sMax && !prev.sMax);
    const hitFit = state.fit && !prev.fit;
    if ((hitEdge || hitFit) && now - prev.lastAt > 90) {
      triggerHaptic(hitFit ? 'light' : 'selection');
      edgeRef.current = { ...state, lastAt: now };
    } else {
      edgeRef.current = { ...state, lastAt: prev.lastAt };
    }
    const next = { s: c.s, x: c.x, y: c.y };
    viewRef.current = next;
    setView(next);
  };

  const setPhoto = (image) => {
    imgRef.current = image;
    setImg(image);
    applyView({ s: 1, x: 0, y: 0 });
  };

  const blobToBase64 = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });

  const canvasJpegBase64 = () => new Promise((resolve) => {
    const canvas = canvasRef.current;
    if (!canvas) { resolve(''); return; }
    canvas.toBlob(async (blob) => {
      if (!blob) { resolve(''); return; }
      resolve(await blobToBase64(blob));
    }, 'image/jpeg', 0.92);
  });

  // ネイティブカメラを開く（オーバーレイの透明PNGを渡す）
  const openNativeCamera = async () => {
    if (cameraBusy) return;
    if (!isNativeIosApp()) {
      if (camFileRef.current) camFileRef.current.click();
      return;
    }
    setNotice('');
    const oc = document.createElement('canvas');
    oc.width = CW;
    oc.height = CH;
    drawShareCard(oc.getContext('2d'), null, { s: 1, x: 0, y: 0 }, model, { transparent: true });
    const blob = await new Promise((res) => oc.toBlob(res, 'image/png'));
    if (!blob) return;
    const overlayBase64 = await blobToBase64(blob);
    setCameraBusy(true);
    const result = await requestShareCamera(overlayBase64);
    setCameraBusy(false);
    if (result && result.image) {
      const image = new Image();
      image.onload = () => setPhoto(image);
      image.src = 'data:image/jpeg;base64,' + result.image;
    } else if (result && result.error && result.error !== 'not_native' && result.error !== 'timeout') {
      setNotice(result.error);
    }
  };

  useEffect(() => {
    if (autoPick === 'camera') { const t = setTimeout(() => openNativeCamera(), 350); return () => clearTimeout(t); }
    if (autoPick === 'album') { const t = setTimeout(() => albRef.current && albRef.current.click(), 350); return () => clearTimeout(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPick]);

  // プレビュー描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    drawShareCard(ctx, img, view, model);
  }, [img, view, model]);

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setPhoto(image);
    image.src = url;
  };

  // パン＆ピンチ（プレビュー上で構図を調整）
  const onPointerDown = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.target.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!img || !pointersRef.current.has(e.pointerId)) return;
    const prev = pointersRef.current.get(e.pointerId);
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const toCanvas = CW / rect.width;
    if (pointersRef.current.size === 1) {
      applyView({ ...viewRef.current, x: viewRef.current.x + dx * toCanvas, y: viewRef.current.y + dy * toCanvas });
    } else if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinchRef.current) {
        const ratio = dist / lastPinchRef.current;
        applyView({ ...viewRef.current, s: viewRef.current.s * ratio });
      }
      lastPinchRef.current = dist;
    }
  };
  const onPointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) lastPinchRef.current = null;
  };

  const handleShare = async () => {
    if (sharing) return;
    triggerHaptic('light');
    setSharing(true);
    const base64 = await canvasJpegBase64();
    setSharing(false);
    if (!base64) return;
    if (isNativeIosApp()) {
      postNativeMessage({ type: 'SHARE_IMAGE', image: base64 });
      setShared(true);
      setTimeout(() => setShared(false), 2500);
    } else if (navigator.share && canvasRef.current) {
      canvasRef.current.toBlob((blob) => {
        if (!blob) return;
        const file = new File([blob], 'withfit-share.jpg', { type: 'image/jpeg' });
        navigator.share({ files: [file] }).catch(() => {});
      }, 'image/jpeg', 0.92);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    triggerHaptic('light');
    setSaving(true);
    setNotice('');
    const base64 = await canvasJpegBase64();
    if (!base64) { setSaving(false); return; }
    if (isNativeIosApp()) {
      const res = await saveImageNative(base64);
      setSaving(false);
      if (res && res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else {
        setNotice('保存できませんでした。設定アプリで写真への保存を許可してください。');
      }
    } else {
      const a = document.createElement('a');
      a.href = 'data:image/jpeg;base64,' + base64;
      a.download = 'withfit-share.jpg';
      a.click();
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const handleStories = async () => {
    triggerHaptic('light');
    const base64 = await canvasJpegBase64();
    if (!base64) return;
    if (isNativeIosApp()) {
      shareToInstagramStoriesNative(base64);
    }
  };

  const handleClose = () => { onClose(); };

  // ステージ（プレビュー領域）は実測で決める
  const stageBoxRef = useRef(null);
  const [stage, setStage] = useState({ w: 300, h: 533 });
  useEffect(() => {
    const el = stageBoxRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(200, Math.min(430, r.width - 32, (r.height - 8) * 9 / 16));
      setStage({ w, h: w * 16 / 9 });
    };
    update();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    window.addEventListener('resize', update);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950 flex flex-col" style={{ height: '100dvh' }} onClick={handleClose}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="text-white font-bold text-base">シェア画像を作成</div>
        <button onClick={handleClose} className="text-white/80 p-1.5 rounded-lg hover:bg-white/10"><X size={22} /></button>
      </div>

      <div ref={stageBoxRef} className="flex-1 min-h-0 w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <div className="relative shrink-0" style={{ width: stage.w, height: stage.h }}>
          <canvas
            ref={canvasRef}
            width={CW}
            height={CH}
            className="w-full h-full block rounded-2xl touch-none select-none bg-black"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <input ref={albRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <input ref={camFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        </div>
      </div>

      <div className="shrink-0 px-4 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)' }} onClick={(e) => e.stopPropagation()}>
        {!img ? (
          <div className="max-w-[430px] mx-auto">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={openNativeCamera} disabled={cameraBusy} className="flex items-center justify-center gap-2 bg-blue-600 text-white font-bold rounded-xl py-3.5 active:scale-[0.98] transition-transform disabled:opacity-60">
                <Camera size={20} /> {cameraBusy ? 'カメラ起動中…' : '写真を撮影'}
              </button>
              <label className="flex items-center justify-center gap-2 bg-slate-700 text-white font-bold rounded-xl py-3.5 cursor-pointer active:scale-[0.98] transition-transform">
                <ImageIcon size={20} /> アルバムから選ぶ
                <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
              </label>
            </div>
            {notice ? (
              <p className="text-center text-xs text-rose-300 mt-3">{notice}</p>
            ) : (
              <p className="text-center text-xs text-white/60 mt-3">撮影は、記録を重ねたまま撮れるライブカメラです</p>
            )}
          </div>
        ) : (
          <div className="max-w-[430px] mx-auto">
            <p className="text-center text-xs text-white/60 mb-3">写真はドラッグ移動・ピンチ拡大で位置を調整できます{notice ? '' : ''}</p>
            {notice && <p className="text-center text-xs text-rose-300 mb-3">{notice}</p>}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <button onClick={() => { imgRef.current = null; viewRef.current = { s: 1, x: 0, y: 0 }; setImg(null); setView({ s: 1, x: 0, y: 0 }); }} className="flex items-center justify-center gap-1.5 bg-slate-700 text-white font-bold rounded-xl py-3 active:scale-[0.98] transition-transform text-sm">
                <RotateCcw size={16} /> 写真を変更
              </button>
              <button onClick={openNativeCamera} disabled={cameraBusy} className="flex items-center justify-center gap-1.5 bg-slate-700 text-white font-bold rounded-xl py-3 active:scale-[0.98] transition-transform text-sm disabled:opacity-60">
                <Camera size={16} /> {cameraBusy ? '起動中…' : '撮り直す'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={handleSave} disabled={saving} className="flex items-center justify-center gap-1.5 bg-slate-700 text-white font-bold rounded-xl py-3 active:scale-[0.98] transition-transform text-sm disabled:opacity-60">
                <Download size={16} /> {saving ? '保存中…' : saved ? '保存した' : '保存'}
              </button>
              <button onClick={handleStories} className="flex items-center justify-center gap-1.5 text-white font-bold rounded-xl py-3 active:scale-[0.98] transition-transform text-sm" style={{ background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' }}>
                ストーリーズ
              </button>
              <button onClick={handleShare} disabled={sharing} className="flex items-center justify-center gap-1.5 bg-blue-600 text-white font-bold rounded-xl py-3 active:scale-[0.98] transition-transform text-sm disabled:opacity-60">
                <Share size={16} /> {sharing ? '準備中…' : shared ? '開きました' : '共有する'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
