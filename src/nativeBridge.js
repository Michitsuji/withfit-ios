// ==========================================
// nativeBridge.js — iOS ネイティブアプリ連携ブリッジ
// (WKWebView / Swift Native Bridge & Haptics / Local Notifications / Audio Keep-Alive)
// ==========================================

export function isNativeIosApp() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.WithFitNative ||
    (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.WithFitNative) ||
    window.ReactNativeWebView
  );
}

export function postNativeMessage(payload) {
  if (typeof window === 'undefined' || !payload) return false;
  let sent = false;
  try {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.WithFitNative) {
      window.webkit.messageHandlers.WithFitNative.postMessage(payload);
      sent = true;
    } else if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      sent = true;
    }
  } catch (e) {
    console.warn('Native bridge message warning:', e);
  }
  return sent;
}

// iOS Taptic Engine 触覚フィードバック
export function triggerHaptic(style = 'light') {
  if (postNativeMessage({ type: 'HAPTIC', style })) {
    return;
  }
  if (style === 'vibrate' && typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate([200, 100, 200, 100, 400]);
    } catch (e) {}
  }
}

// 休憩インターバルタイマーのiOSネイティブ通知スケジュール（ロック画面・他アプリ使用中でも確実に鳴動）
export function scheduleNativeRestTimer(seconds) {
  if (!seconds || seconds <= 0) {
    cancelNativeRestTimer();
    return;
  }
  postNativeMessage({
    type: 'START_REST_TIMER',
    seconds: Number(seconds)
  });
}

export function cancelNativeRestTimer() {
  postNativeMessage({
    type: 'CANCEL_REST_TIMER'
  });
}

// iOSネイティブAVAudioPlayerによるアラーム音＆連続バイブ鳴動（WebKitの自動再生制限を回避）
export function playNativeAlarm(volume = 1.0) {
  postNativeMessage({
    type: 'PLAY_ALARM',
    volume: Number(volume)
  });
}

export function stopNativeAlarm() {
  postNativeMessage({
    type: 'STOP_ALARM'
  });
}

// 30分操作なし時の記録忘れ防止リマインダーをiOSネイティブ側にスケジュール
export function scheduleNativeForgotTimer(seconds = 1800) {
  if (!seconds || seconds <= 0) return;
  postNativeMessage({
    type: 'START_FORGOT_TIMER',
    seconds: Number(seconds)
  });
}

export function cancelNativeForgotTimer() {
  postNativeMessage({
    type: 'CANCEL_FORGOT_TIMER'
  });
}

// トレーニング開始3分後のフレンド通知がロック画面中でも発火するようネイティブタイマーも補助予約
export function scheduleNativeStartTimer(seconds = 180, gymName = 'ジム') {
  if (!seconds || seconds <= 0) return;
  postNativeMessage({
    type: 'START_TRAINING_TIMER',
    seconds: Number(seconds),
    gymName: gymName || 'ジム'
  });
}

export function cancelNativeStartTimer() {
  postNativeMessage({
    type: 'CANCEL_TRAINING_TIMER'
  });
}

// トレーニング中状態の同期（iOSバックグラウンド維持・無音オーディオセッション制御＋Live Activity）
export function setNativeTrainingState(isTraining, trainingStartTime = null, gymName = '', exerciseName = '', exerciseIndex = -1, currentSet = 0, rest = null) {
  postNativeMessage({
    type: 'SET_TRAINING_STATE',
    isTraining: Boolean(isTraining),
    trainingStartTime: trainingStartTime || null,
    gymName: gymName || '',
    exerciseName: exerciseName || '',
    exerciseIndex: Number.isFinite(Number(exerciseIndex)) ? Number(exerciseIndex) : -1,
    currentSet: Number(currentSet) || 0,
    restStartTime: rest?.startTime || null,
    restDurationSec: Number(rest?.durationSec) || 0,
    restRinging: Boolean(rest?.ringing)
  });
}

// テーマ変更時のiOSステータスバー・セーフエリア背景色のリアルタイム同期
export function syncNativeTheme(theme = 'light') {
  postNativeMessage({
    type: 'SET_THEME',
    theme: theme || 'light'
  });
}

// アプリ内リアルタイム通知受信時のiOSネイティブバナー通知発火
export function showNativeLocalNotification({ id, title, body, data }) {
  return postNativeMessage({
    type: 'SHOW_LOCAL_NOTIFICATION',
    id: id || `local_${Date.now()}`,
    title: title || 'WithFit',
    body: body || '',
    data: data || {}
  });
}

// iOSネイティブ通知権限ステータスの取得リクエスト
export function checkNativePushPermission() {
  return postNativeMessage({
    type: 'CHECK_PUSH_PERMISSION'
  });
}

// ネイティブタブバーの強制表示/非表示（起動ロード中・全画面ゲーム表示中などに使用）
export function setNativeTabBarHidden(hidden) {
  return postNativeMessage({
    type: 'SET_TAB_BAR_HIDDEN',
    hidden: Boolean(hidden)
  });
}

// iOSネイティブクリップボード（UIPasteboard）への確実なコピー
export async function copyTextToClipboard(text) {
  const str = String(text || '');
  triggerHaptic('selection');
  postNativeMessage({
    type: 'COPY_TO_CLIPBOARD',
    text: str
  });
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch (e) {}
  }
  return true;
}

// APIエンドポイントURL解決
export function getApiUrl(path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') {
    const savedBase = localStorage.getItem('withfit_api_base_url') || window.__WITHFIT_API_BASE_URL__;
    if (savedBase && typeof savedBase === 'string' && savedBase.startsWith('http')) {
      return `${savedBase.replace(/\/+$/, '')}${cleanPath}`;
    }
  }
  if (process.env.REACT_APP_API_BASE_URL && process.env.REACT_APP_API_BASE_URL.startsWith('http')) {
    return `${process.env.REACT_APP_API_BASE_URL.replace(/\/+$/, '')}${cleanPath}`;
  }
  return cleanPath;
}
