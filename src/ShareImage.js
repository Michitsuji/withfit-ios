// ==========================================
// ShareImage.js — トレーニング記録のシェア画像（Strava風コラージュ）
// デザイン確定: v10（枠なし・写真全面、上部=投稿カードUI準拠の記録、
// 下部=種目数/set/時間を大きく、総負荷量・消費は小さく、右下ワードマーク）
// 記録が多い場合は 左→右2列、それでも収まらなければ3列に自動で流す。
// 撮影はライブカメラ（映像に記録を重ねたまま撮影）とアルバム選択の両対応。
// ==========================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Camera, Image as ImageIcon, Share, RotateCcw, SwitchCamera, ChevronLeft } from 'lucide-react';
import { calculateWorkoutTotals } from './utils';
import { isNativeIosApp, postNativeMessage, triggerHaptic } from './nativeBridge';

const CW = 1080;
const CH = 1920;
const MX = 56;
const FONT = '"Hiragino Kaku Gothic ProN", -apple-system, BlinkMacSystemFont, sans-serif';

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
    lines.forEach((ln) => {
      const y = topY + ln.y;
      if (ln.kind === 'header') {
        ctx.font = `700 ${27 * k}px ${FONT}`;
        ctx.fillStyle = COL.white;
        let t = ln.text;
        while (t.length > 1 && ctx.measureText(t).width > colW) t = t.slice(0, -1);
        if (t !== ln.text) t = t.slice(0, -1) + '…';
        ctx.fillText(t, colX, y);
      } else if (ln.kind === 'sub') {
        ctx.font = `700 ${20 * k}px ${FONT}`;
        ctx.fillStyle = COL.blue;
        ctx.fillText(ln.row.text, colX + 4, y + 4 * k);
      } else if (ln.kind === 'row') {
        const row = ln.row;
        let x = colX + row.indent * 30 * k;
        ctx.font = `700 ${20 * k}px ${FONT}`;
        if (row.arrow) {
          drawArrow(x, y + 5 * k);
          ctx.fillStyle = row.labelColor;
          ctx.fillText(row.label, x + 26 * k, y + 3 * k);
        } else {
          ctx.fillStyle = row.labelColor;
          ctx.fillText(row.label, x, y + 3 * k);
        }
        // セグメント（列幅に収まらない場合は行だけ縮小）
        const numPx = 24 * k;
        const unitPx = 16 * k;
        const segFont = (seg) => `700 ${seg.kind === 'num' ? numPx : seg.kind === 'cross' ? 19 * k : unitPx}px ${FONT}`;
        let totalW = 0;
        row.segs.forEach((seg) => { ctx.font = segFont(seg); totalW += ctx.measureText(seg.t).width; });
        const avail = colW - 150 * k;
        const shrink = totalW > avail ? Math.max(0.78, avail / totalW) : 1;
        let sx = colX + 150 * k;
        row.segs.forEach((seg) => {
          const base = seg.kind === 'num' ? numPx : seg.kind === 'cross' ? 19 * k : unitPx;
          ctx.font = `700 ${base * shrink}px ${FONT}`;
          ctx.fillStyle = seg.color || (seg.kind === 'num' ? COL.white : COL.gray);
          const yOff = seg.kind === 'num' ? 0 : (numPx - unitPx) * shrink * 0.9;
          ctx.fillText(seg.t, sx, y + yOff);
          sx += ctx.measureText(seg.t).width;
        });
      }
    });
  });

  // 下部サマリー（v10デザイン）
  const { exCount, sets, durMin, volume, calories } = model.stats;
  const segW = (segs) => segs.reduce((acc, [t, px]) => { ctx.font = `700 ${px}px ${FONT}`; return acc + ctx.measureText(t).width; }, 0);
  const drawSegs = (x, yTop, basePx, segs) => {
    let cx = x;
    segs.forEach(([t, px, color]) => {
      ctx.font = `700 ${px}px ${FONT}`;
      ctx.fillStyle = color || COL.white;
      ctx.fillText(t, cx, yTop + (basePx - px));
      cx += ctx.measureText(t).width;
    });
    return cx - x;
  };

  const groups = [
    [[String(exCount), 132], ['種目', 64]],
    [[String(sets), 132], [' set', 64]],
  ];
  if (durMin > 0) {
    const h = Math.floor(durMin / 60);
    const m = durMin % 60;
    if (h > 0) groups.push([[String(h), 80], [' h ', 42], [String(m), 80], [' m', 42]]);
    else groups.push([[String(m), 132], [' m', 64]]);
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
    ctx.font = `700 54px ${FONT}`;
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

// ---- モーダル ----
export function ShareImageModal({ post, autoPick, onClose }) {
  const canvasRef = useRef(null);
  const albRef = useRef(null);
  const camFileRef = useRef(null);
  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const [img, setImg] = useState(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [shared, setShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [live, setLive] = useState(false);
  const [facing, setFacing] = useState('environment');
  const [liveError, setLiveError] = useState('');
  const pointersRef = useRef(new Map());
  const lastPinchRef = useRef(null);
  const model = useMemo(() => buildShareModel(post), [post]);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
      streamRef.current = null;
    }
  };
  const stopLive = () => {
    stopStream();
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch (e) {}
      videoRef.current.srcObject = null;
    }
    setLive(false);
  };

  useEffect(() => () => stopStream(), []);

  const openCamera = async (fm) => {
    setLiveError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setLiveError('この環境ではライブカメラが使えません。通常のカメラで撮影してください。');
      return;
    }
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        // 出力は1080x1920なので、それ以上の解像度はメモリを圧迫するだけ。
        // 縦横比も指定して、最初から9:16に合った映像モードを選ばせる。
        video: { facingMode: fm, width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 0.5625 } },
      });
      streamRef.current = stream;
      setFacing(fm);
      setLive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (e) {
      setLiveError('カメラを起動できませんでした。通常のカメラで撮影するか、アルバムから選んでください。');
    }
  };

  // ライブ開始後に video へストリームを接続
  useEffect(() => {
    if (live && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [live]);

  // ライブ中はプレビュー用 canvas に映像＋オーバーレイを毎フレーム合成する。
  // CSSのobject-fitに任せず、撮影時と全く同じcover計算で描くので、
  // カメラ切替時もズームが跳ねず、最初から画面に合った構図で表示される。
  useEffect(() => {
    if (!live) return;
    if (!overlayCanvasRef.current) {
      const oc = document.createElement('canvas');
      oc.width = CW;
      oc.height = CH;
      drawShareCard(oc.getContext('2d'), null, { s: 1, x: 0, y: 0 }, model, { transparent: true });
      overlayCanvasRef.current = oc;
    }
    let raf = 0;
    const loop = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, CW, CH);
        if (video && video.videoWidth) {
          const iw = video.videoWidth;
          const ih = video.videoHeight;
          const scale = Math.max(CW / iw, CH / ih);
          const dw = iw * scale;
          const dh = ih * scale;
          const dx = (CW - dw) / 2;
          const dy = (CH - dh) / 2;
          if (facing === 'user') {
            ctx.save();
            ctx.translate(CW, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, dx, dy, dw, dh);
            ctx.restore();
          } else {
            ctx.drawImage(video, dx, dy, dw, dh);
          }
        }
        if (overlayCanvasRef.current) ctx.drawImage(overlayCanvasRef.current, 0, 0);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live, facing, model]);

  useEffect(() => {
    if (autoPick === 'camera') { const t = setTimeout(() => openCamera('environment'), 350); return () => clearTimeout(t); }
    if (autoPick === 'album') { const t = setTimeout(() => albRef.current && albRef.current.click(), 350); return () => clearTimeout(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPick]);

  // プレビュー描画（ライブ中はプレビュー用 canvas が無いので何もしない）
  useEffect(() => {
    if (live) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    drawShareCard(ctx, img, view, model);
  }, [img, view, model, live]);

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { setImg(image); setView({ s: 1, x: 0, y: 0 }); };
    image.src = url;
  };

  const captureLive = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    triggerHaptic('medium');
    // 写真だけを切り取る（オーバーレイはプレビュー/共有時に一度だけ重ねる）
    const c = document.createElement('canvas');
    c.width = CW;
    c.height = CH;
    const cctx = c.getContext('2d');
    cctx.fillStyle = '#000';
    cctx.fillRect(0, 0, CW, CH);
    const iw = video.videoWidth;
    const ih = video.videoHeight;
    const scale = Math.max(CW / iw, CH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (CW - dw) / 2;
    const dy = (CH - dh) / 2;
    if (facing === 'user') {
      cctx.save();
      cctx.translate(CW, 0);
      cctx.scale(-1, 1);
      cctx.drawImage(video, dx, dy, dw, dh);
      cctx.restore();
    } else {
      cctx.drawImage(video, dx, dy, dw, dh);
    }
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => { setImg(image); setView({ s: 1, x: 0, y: 0 }); stopLive(); };
      image.src = url;
    }, 'image/jpeg', 0.92);
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
      setView((v) => ({ ...v, x: v.x + dx * toCanvas, y: v.y + dy * toCanvas }));
    } else if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinchRef.current) {
        const ratio = dist / lastPinchRef.current;
        setView((v) => ({ ...v, s: Math.min(4, Math.max(1, v.s * ratio)) }));
      }
      lastPinchRef.current = dist;
    }
  };
  const onPointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) lastPinchRef.current = null;
  };

  const handleShare = () => {
    const canvas = canvasRef.current;
    if (!canvas || sharing) return;
    triggerHaptic('light');
    setSharing(true);
    // PNGだと写真で数MBになりブリッジ転送で固まるため、JPEGで軽く渡す
    canvas.toBlob((blob) => {
      if (!blob) { setSharing(false); return; }
      if (isNativeIosApp()) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          const base64 = dataUrl.split(',')[1] || '';
          setSharing(false);
          if (base64) {
            postNativeMessage({ type: 'SHARE_IMAGE', image: base64 });
            setShared(true);
            setTimeout(() => setShared(false), 2500);
          }
        };
        reader.onerror = () => setSharing(false);
        reader.readAsDataURL(blob);
      } else if (navigator.share) {
        const file = new File([blob], 'withfit-share.jpg', { type: 'image/jpeg' });
        navigator.share({ files: [file] }).catch(() => {}).finally(() => setSharing(false));
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'withfit-share.jpg';
        a.click();
        setSharing(false);
      }
    }, 'image/jpeg', 0.9);
  };

  const handleClose = () => { stopLive(); onClose(); };

  // ステージ（プレビュー領域）は実測で決める。CSSのdvh計算に頼ると
  // 環境によってはみ出すことがあるため、収まる最大サイズを測って使う。
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
          {/* ライブカメラ映像の受け口（表示は canvas 側で行うため不可視にしておく） */}
          <video ref={videoRef} playsInline muted autoPlay className="absolute w-px h-px opacity-0 pointer-events-none" />
          <input ref={albRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <input ref={camFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        </div>
      </div>

      <div className="shrink-0 px-4 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)' }} onClick={(e) => e.stopPropagation()}>
        {live ? (
          <div className="flex items-center justify-between max-w-[430px] mx-auto">
            <button onClick={stopLive} className="flex items-center gap-1 text-white/85 font-bold text-sm bg-white/10 rounded-full px-4 py-2.5">
              <ChevronLeft size={18} /> 戻る
            </button>
            <button
              onClick={captureLive}
              aria-label="撮影"
              className="w-[72px] h-[72px] rounded-full border-4 border-white bg-white/25 active:bg-white/50 transition-colors flex items-center justify-center"
            >
              <span className="w-[54px] h-[54px] rounded-full bg-white block" />
            </button>
            <button onClick={() => openCamera(facing === 'environment' ? 'user' : 'environment')} className="flex items-center gap-1 text-white/85 font-bold text-sm bg-white/10 rounded-full px-4 py-2.5">
              <SwitchCamera size={18} /> 切替
            </button>
          </div>
        ) : !img ? (
          <div className="max-w-[430px] mx-auto">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => openCamera('environment')} className="flex items-center justify-center gap-2 bg-blue-600 text-white font-bold rounded-xl py-3.5 active:scale-[0.98] transition-transform">
                <Camera size={20} /> 写真を撮影
              </button>
              <label className="flex items-center justify-center gap-2 bg-slate-700 text-white font-bold rounded-xl py-3.5 cursor-pointer active:scale-[0.98] transition-transform">
                <ImageIcon size={20} /> アルバムから選ぶ
                <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
              </label>
            </div>
            {liveError ? (
              <div className="mt-3">
                <p className="text-center text-xs text-rose-300 mb-2">{liveError}</p>
                <button onClick={() => camFileRef.current && camFileRef.current.click()} className="w-full bg-slate-700 text-white font-bold rounded-xl py-3">通常のカメラで撮影する</button>
              </div>
            ) : (
              <p className="text-center text-xs text-white/60 mt-3">撮影は、記録を重ねたまま撮れるライブカメラです</p>
            )}
          </div>
        ) : (
          <div className="max-w-[430px] mx-auto">
            <p className="text-center text-xs text-white/60 mb-3">写真はドラッグ移動・ピンチ拡大で位置を調整できます</p>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => { setImg(null); setView({ s: 1, x: 0, y: 0 }); }} className="flex items-center justify-center gap-1.5 bg-slate-700 text-white font-bold rounded-xl py-3 active:scale-[0.98] transition-transform text-sm">
                <RotateCcw size={16} /> 写真を変更
              </button>
              <button onClick={() => openCamera('environment')} className="flex items-center justify-center gap-1.5 bg-slate-700 text-white font-bold rounded-xl py-3 active:scale-[0.98] transition-transform text-sm">
                <Camera size={16} /> 撮り直す
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
