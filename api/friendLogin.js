// ==========================================
// api/friendLogin.js — フレンドコード＋生年月日ログインのサーバー側検証
// ・照合をクライアント側だけで行うと、アカウント情報が読み取れる時点で
//   ログイン情報（フレンドコード・生年月日）も一緒に漏れてしまう。
// ・ここでは Admin SDK でサーバー側だけが照合し、成功したら Firebase の
//   カスタムトークンを返す。クライアントは signInWithCustomToken で
//   正式なセッション（uid = ユーザー名）を得る。
// ・必要な環境変数（Vercel）: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
//   FIREBASE_PRIVATE_KEY（sendPush の FCM 用と同じサービスアカウント）
// ・未設定の場合は 501 を返し、クライアントは従来方式にフォールバックする。
// ==========================================
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

let adminReady = false;
try {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY
          ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
          : undefined,
      }),
    });
  }
  adminReady = Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
} catch (e) {
  adminReady = false;
}

// 簡易レート制限（同一コード / 同一IP から10分間に10回まで）
const attempts = new Map();
function throttled(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.firstAt > 10 * 60 * 1000) {
    attempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  rec.count += 1;
  return rec.count > 10;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!adminReady) {
    return res.status(501).json({ error: 'Server login is not configured' });
  }

  const { friendCode, birthDate } = req.body || {};
  const cleanCode = String(friendCode || '').trim();
  if (!cleanCode || !birthDate) {
    return res.status(400).json({ error: 'friendCode and birthDate are required' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (throttled(cleanCode) || (ip && throttled('ip:' + ip))) {
    return res.status(429).json({ error: 'Too many attempts' });
  }

  try {
    const snap = await getFirestore()
      .collection('artifacts/withfit-app/public/data/accounts')
      .where('friendCode', '==', cleanCode)
      .limit(1)
      .get();
    if (snap.empty) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const docSnap = snap.docs[0];
    const data = docSnap.data() || {};
    if (!data.birthDate || data.birthDate !== birthDate) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = await getAuth().createCustomToken(docSnap.id);
    return res.status(200).json({ token, username: docSnap.id });
  } catch (e) {
    console.error('friendLogin error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
};
