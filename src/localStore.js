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
      savedAt: Date.now()
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
