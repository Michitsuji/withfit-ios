// ==========================================
// api/pinLogin.js — ユーザー名＋PINログインのサーバー側検証
// ・PIN はログイン情報そのものなので、クライアント側で照合するために
//   アカウント文書へ置き続けることはしない。秘密情報の分離後は
//   privateAccounts/{ユーザー名} の pin を正とし、移行期間中は
//   accounts 側の pin にもフォールバックする。
// ・成功したら Firebase のカスタムトークン（uid = ユーザー名）を返す。
// ・環境変数は friendLogin と同じ（FIREBASE_PROJECT_ID など）。
// ==========================================
const { getApps, initializeApp, cert } = require('firebase-admin/app');
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

const crypto = require('crypto');

function b64urlEncode(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createFirebaseCustomToken(uid) {
  const email = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
  if (!email || !privateKey) throw new Error('missing service account env');
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    sub: email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: nowSec,
    exp: nowSec + 3600,
    uid: String(uid),
  };
  const unsigned = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  return `${unsigned}.${b64urlEncode(signer.sign(privateKey))}`;
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

  const { username, pin } = req.body || {};
  const cleanUser = String(username || '').trim();
  const cleanPin = String(pin || '');
  if (!cleanUser || !cleanPin) {
    return res.status(400).json({ error: 'username and pin are required' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (throttled('pin:' + cleanUser) || (ip && throttled('ip:' + ip))) {
    return res.status(429).json({ error: 'Too many attempts' });
  }

  try {
    const db = getFirestore();
    let storedPin = null;
    const privSnap = await db.doc(`artifacts/withfit-app/public/data/privateAccounts/${cleanUser}`).get();
    if (privSnap.exists && (privSnap.data() || {}).pin) {
      storedPin = String(privSnap.data().pin);
    } else {
      const accSnap = await db.doc(`artifacts/withfit-app/public/data/accounts/${cleanUser}`).get();
      if (accSnap.exists && (accSnap.data() || {}).pin) {
        storedPin = String(accSnap.data().pin);
      }
    }
    if (!storedPin || storedPin !== cleanPin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = createFirebaseCustomToken(cleanUser);
    return res.status(200).json({ token, username: cleanUser });
  } catch (e) {
    console.error('pinLogin error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
};
