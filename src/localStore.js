// ==========================================
// localStore.js — ローカル保存＆差分チェック（Delta Sync）エンジン
// ==========================================
import { postNativeMessage } from './nativeBridge';

const LOCAL_DB_PREFIX = 'withfit_local_db_v2_';

// オブジェクトや配列の軽量ハッシュ（フィンガープリント）を計算して差分有無を高速判定する
export function computeRecordHash(record) {
  if (!record || typeof record !== 'object') return String(record);
  try {
    const str = JSON.stringify(record);
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(36) + '_' + str.length;
  } catch (e) {
    return String(Date.now());
  }
}

// ユーザー別ローカルデータベースの読み込み
export function loadLocalDB(userId = 'global') {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${LOCAL_DB_PREFIX}${userId}`);
    if (!raw) {
      if (window.__WITHFIT_NATIVE_DB__ && window.__WITHFIT_NATIVE_DB__[userId]) {
        return window.__WITHFIT_NATIVE_DB__[userId];
      }
      return null;
    }
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load local DB:', e);
    return null;
  }
}

// ユーザー別ローカルデータベースの保存（localStorage ＋ iOSネイティブファイル領域へ二重保存）
export function saveLocalDB(userId = 'global', dbData) {
  if (typeof window === 'undefined' || !dbData) return;
  try {
    const payload = {
      ...dbData,
      savedAt: Date.now(),
      // セッション情報も DB 本体に埋め込む。
      // localStorage 側のセッションが iOS に消去されても、
      // ネイティブ保存された DB から userId を復元できるようにするため。
      session: { userId, lastActive: Date.now() }
    };
    const serialized = JSON.stringify(payload);
    localStorage.setItem(`${LOCAL_DB_PREFIX}${userId}`, serialized);
    // iOSネイティブ側のDocumentsディレクトリにも永続化バックアップ
    postNativeMessage({
      type: 'SAVE_LOCAL_DB',
      userId,
      data: serialized
    });
  } catch (e) {
    console.warn('Failed to save local DB:', e);
  }
}

// localStorage のログインセッションが消えてしまった場合に、
// ネイティブ保存 DB（window.__WITHFIT_NATIVE_DB__）からセッションを復元する。
// DB は { [userId]: dbData } 形式で、各 dbData に session が埋め込まれている。
export function recoverSessionFromNativeDB() {
  if (typeof window === 'undefined') return null;
  try {
    // 明示的にログアウトした場合はセッションを復元しない
    try { if (localStorage.getItem('withfit_explicit_logout')) return null; } catch (e) {}
    const nativeDB = window.__WITHFIT_NATIVE_DB__;
    if (!nativeDB || typeof nativeDB !== 'object') return null;
    let best = null;
    Object.entries(nativeDB).forEach(([userId, dbData]) => {
      if (userId === 'global' || userId.includes('__images')) return;
      if (!dbData || typeof dbData !== 'object') return;
      const lastActive = dbData.session?.lastActive || dbData.savedAt || 0;
      if (!lastActive) return;
      if (Date.now() - lastActive > 30 * 24 * 60 * 60 * 1000) return;
      if (!best || lastActive > best.lastActive) {
        best = { userId, lastActive };
      }
    });
    return best;
  } catch (e) {
    return null;
  }
}

// 配列コレクション（workouts, exercises, gyms, notifications）の差分チェック
// localItems と incomingItems を比較し、追加・更新・削除の差分がある場合のみ新しい配列と差分統計を返す
export function diffArrayCollection(localItems = [], incomingItems = [], idKey = 'id') {
  const localMap = new Map();
  for (let i = 0; i < localItems.length; i++) {
    const item = localItems[i];
    if (item && item[idKey]) {
      localMap.set(item[idKey], computeRecordHash(item));
    }
  }

  let added = 0;
  let modified = 0;
  const incomingIds = new Set();

  for (let i = 0; i < incomingItems.length; i++) {
    const item = incomingItems[i];
    if (!item || !item[idKey]) continue;
    const id = item[idKey];
    incomingIds.add(id);
    const newHash = computeRecordHash(item);
    if (!localMap.has(id)) {
      added++;
    } else if (localMap.get(id) !== newHash) {
      modified++;
    }
  }

  let removed = 0;
  localMap.forEach((_, id) => {
    if (!incomingIds.has(id)) {
      removed++;
    }
  });

  const hasChanges = added > 0 || modified > 0 || removed > 0 || localItems.length !== incomingItems.length;
  return {
    hasChanges,
    added,
    modified,
    removed,
    items: incomingItems
  };
}

// マップ形式（accountsInfo）の差分チェック
export function diffObjectMap(localMapObj = {}, incomingUpdates = {}) {
  let added = 0;
  let modified = 0;
  const merged = { ...localMapObj };

  Object.entries(incomingUpdates).forEach(([key, val]) => {
    if (!val) return;
    if (!localMapObj[key]) {
      added++;
      merged[key] = val;
    } else {
      const oldHash = computeRecordHash(localMapObj[key]);
      const newHash = computeRecordHash(val);
      if (oldHash !== newHash) {
        modified++;
        merged[key] = val;
      }
    }
  });

  return {
    hasChanges: added > 0 || modified > 0,
    added,
    modified,
    removed: 0,
    map: merged
  };
}


// ログアウト時に、ローカルDBに埋め込まれたセッション情報を取り除く。
// これをしないと次回起動時に recoverSessionFromNativeDB がセッションを復元し、
// ログアウトしたのにログイン状態に戻ってしまう（DB本体のキャッシュは残す）。
export function clearLocalSession(userId) {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const nativeData = (window.__WITHFIT_NATIVE_DB__ && window.__WITHFIT_NATIVE_DB__[userId]) || null;
    if (nativeData && typeof nativeData === 'object' && nativeData.session) {
      const copy = { ...nativeData };
      delete copy.session;
      postNativeMessage({ type: 'SAVE_LOCAL_DB', userId, data: JSON.stringify({ ...copy, savedAt: Date.now() }) });
    }
  } catch (e) {}
  try {
    const key = `${LOCAL_DB_PREFIX}${userId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.session) {
        delete parsed.session;
        localStorage.setItem(key, JSON.stringify(parsed));
      }
    }
  } catch (e) {}
}

// ==========================================
// リモート画像のローカルキャッシュ
// プロフィール画像など http(s) の画像を一度取得したら端末内に保存し、
// 次回からはローカルから即表示する（データURIの画像は元々ローカル同然なので対象外）。
// 保存先は localStorage とネイティブファイル（セッション情報は埋め込まない）。
// ==========================================
const IMAGE_CACHE_PREFIX = 'withfit_image_cache_v1_';
const IMAGE_CACHE_LIMIT = 30;
let imageCacheMap = {};
let imageCacheOwner = null;
const imageFetchInFlight = new Set();

export function initImageCache(ownerUserId) {
  if (typeof window === 'undefined' || !ownerUserId) return;
  imageCacheOwner = ownerUserId;
  imageCacheMap = {};
  try {
    const raw = localStorage.getItem(`${IMAGE_CACHE_PREFIX}${ownerUserId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') imageCacheMap = parsed;
    }
  } catch (e) {}
  if (Object.keys(imageCacheMap).length === 0) {
    try {
      const nativeEntry = window.__WITHFIT_NATIVE_DB__ && window.__WITHFIT_NATIVE_DB__[`${ownerUserId}__images`];
      if (nativeEntry && nativeEntry.imageCache && typeof nativeEntry.imageCache === 'object') {
        imageCacheMap = nativeEntry.imageCache;
      }
    } catch (e) {}
  }
}

function persistImageCache() {
  if (!imageCacheOwner) return;
  try { localStorage.setItem(`${IMAGE_CACHE_PREFIX}${imageCacheOwner}`, JSON.stringify(imageCacheMap)); } catch (e) {}
  try {
    postNativeMessage({
      type: 'SAVE_LOCAL_DB',
      userId: `${imageCacheOwner}__images`,
      data: JSON.stringify({ imageCache: imageCacheMap, savedAt: Date.now() })
    });
  } catch (e) {}
}

export function resolveImageSrc(url) {
  if (!url || typeof url !== 'string') return url;
  if (!/^https?:\/\//i.test(url)) return url;
  const hit = imageCacheMap[url];
  if (hit) return hit;
  if (!imageFetchInFlight.has(url)) {
    imageFetchInFlight.add(url);
    fetch(url)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error('fetch failed'))))
      .then(blob => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      }))
      .then(dataUri => {
        if (typeof dataUri === 'string' && dataUri.length > 0 && dataUri.length < 700 * 1024) {
          imageCacheMap = { ...imageCacheMap, [url]: dataUri };
          const keys = Object.keys(imageCacheMap);
          if (keys.length > IMAGE_CACHE_LIMIT) {
            const trimmed = {};
            keys.slice(keys.length - IMAGE_CACHE_LIMIT).forEach(k => { trimmed[k] = imageCacheMap[k]; });
            imageCacheMap = trimmed;
          }
          persistImageCache();
        }
      })
      .catch(() => {})
      .finally(() => { imageFetchInFlight.delete(url); });
  }
  return url;
}
