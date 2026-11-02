// ==========================================
// api/findUserByCode.js — フレンドコードからユーザー名を引く（ログイン済み専用）
// ・フレンドコードはログイン情報そのものなので、秘密情報の分離後は
//   クライアントから他人のコードを検索できなくなる。代わりにここで
//   Admin SDK が検索し、ユーザー名と表示名だけを返す。
// ・呼び出しには有効な Firebase ID トークン（Authorization: Bearer）が必須。
// ・検索先は privateAccounts を正とし、移行期間中は accounts にもフォールバック。
// ==========================================
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const https = require('https');
const crypto = require('crypto');

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

// --- Firebase ID トークン検証（sendPush と同じ自前実装） ---
let cachedGoogleCerts = null;
let cachedGoogleCertsExpireAt = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (resp) => {
      let d = '';
      resp.on('data', c => { d += c; });
      resp.on('end', () => {
        try { resolve({ json: JSON.parse(d), headers: resp.headers }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getGoogleCerts() {
  const now = Date.now();
  if (cachedGoogleCerts && now < cachedGoogleCertsExpireAt) return cachedGoogleCerts;
  const { json, headers } = await fetchJson('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  let maxAge = 3600;
  const m = String(headers['cache-control'] || '').match(/max-age=(\d+)/);
  if (m) maxAge = parseInt(m[1], 10);
  cachedGoogleCerts = json;
  cachedGoogleCertsExpireAt = now + maxAge * 1000;
  return json;
}

function b64urlDecodeToBuffer(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function verifyFirebaseIdToken(idToken, projectId) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = JSON.parse(b64urlDecodeToBuffer(parts[0]).toString('utf8'));
  const payload = JSON.parse(b64urlDecodeToBuffer(parts[1]).toString('utf8'));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad header');
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec) throw new Error('expired');
  if (payload.aud !== projectId) throw new Error('bad aud');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('bad iss');
  if (!payload.sub) throw new Error('bad sub');
  const certs = await getGoogleCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error('unknown kid');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(pem, b64urlDecodeToBuffer(parts[2]))) throw new Error('bad signature');
  return payload;
}

const attempts = new Map();
function throttled(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.firstAt > 10 * 60 * 1000) {
    attempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  rec.count += 1;
  return rec.count > 30;
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
    return res.status(501).json({ error: 'Server is not configured' });
  }

  const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!idToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let caller;
  try {
    caller = await verifyFirebaseIdToken(idToken, process.env.FIREBASE_PROJECT_ID);
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (throttled('find:' + caller.sub)) {
    return res.status(429).json({ error: 'Too many attempts' });
  }

  const { code } = req.body || {};
  const cleanCode = String(code || '').trim();
  if (!cleanCode) {
    return res.status(400).json({ error: 'code is required' });
  }

  try {
    const db = getFirestore();
    let username = null;
    const privSnap = await db
      .collection('artifacts/withfit-app/public/data/privateAccounts')
      .where('friendCode', '==', cleanCode)
      .limit(1)
      .get();
    if (!privSnap.empty) {
      username = privSnap.docs[0].id;
    } else {
      const snap = await db
        .collection('artifacts/withfit-app/public/data/accounts')
        .where('friendCode', '==', cleanCode)
        .limit(1)
        .get();
      if (!snap.empty) username = snap.docs[0].id;
    }
    if (!username) {
      return res.status(404).json({ error: 'User not found' });
    }
    const accSnap = await db.doc(`artifacts/withfit-app/public/data/accounts/${username}`).get();
    const displayName = accSnap.exists ? ((accSnap.data() || {}).displayName || username) : username;
    return res.status(200).json({ username, displayName });
  } catch (e) {
    console.error('findUserByCode error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
};
