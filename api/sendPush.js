// ==========================================
// api/sendPush.js — プッシュ通知送信サーバーレスAPI
// ・iOSネイティブアプリの端末には APNs デバイストークン（64文字hex）が保存されるため、
//   FCMではなく APNs へ直接配信する（アプリ未起動・終了状態でも届くようにするため）
// ・Android / Web の FCM 登録トークンは従来どおり FCM 経由で送信する
// ・無効トークンは自動検出して呼び出し元に返す（アプリ側でFirestoreから掃除される）
//
// APNs 用の環境変数（Vercel等に設定）:
//   APNS_KEY_ID      : APNs Auth Key の Key ID
//   APNS_TEAM_ID     : Apple Developer Team ID
//   APNS_PRIVATE_KEY : APNs Auth Key (.p8) の中身（\n エスケープ可）
//   APNS_BUNDLE_ID   : アプリの Bundle ID（未設定時は com.michitsuji.withfit）
//   APNS_PRODUCTION  : 'true' で本番APNsのみ、'false' でSandboxのみ。
//                      未設定時は本番→Sandboxの順に自動で試行する
// ==========================================
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const http2 = require('http2');
const crypto = require('crypto');

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

// ------------------------------------------
// トークン種別の判定
// ------------------------------------------
const APNS_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/;
// ネイティブ側で実トークンが取れなかった場合のプレースホルダ（配信不可）
const PLACEHOLDER_TOKENS = new Set(['ios_native_local_notification_enabled']);

function classifyToken(token) {
  if (PLACEHOLDER_TOKENS.has(token)) return 'invalid';
  if (APNS_TOKEN_PATTERN.test(token)) return 'apns';
  return 'fcm';
}

// ------------------------------------------
// APNs（Token-Based Auth / ES256 JWT）
// ------------------------------------------
let cachedApnsJwt = null;
let cachedApnsJwtIssuedAt = 0;

function getApnsConfig() {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const privateKey = process.env.APNS_PRIVATE_KEY
    ? process.env.APNS_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
  if (!keyId || !teamId || !privateKey) return null;
  return {
    keyId,
    teamId,
    privateKey,
    bundleId: process.env.APNS_BUNDLE_ID || 'com.michitsuji.withfit',
    production: process.env.APNS_PRODUCTION,
  };
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getApnsJwt(config) {
  const now = Math.floor(Date.now() / 1000);
  // APNs の JWT は発行から1時間有効。50分間はキャッシュを使い回す
  if (cachedApnsJwt && now - cachedApnsJwtIssuedAt < 50 * 60) {
    return cachedApnsJwt;
  }
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const payload = base64Url(JSON.stringify({ iss: config.teamId, iat: now }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: config.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  cachedApnsJwt = `${signingInput}.${base64Url(signature)}`;
  cachedApnsJwtIssuedAt = now;
  return cachedApnsJwt;
}

function sendApnsOnce(host, config, jwt, deviceToken, payloadObj) {
  return new Promise((resolve) => {
    const session = http2.connect(`https://${host}`);
    session.on('error', () => resolve({ ok: false, reason: 'ConnectionError' }));
    const req = session.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${jwt}`,
      'apns-topic': config.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': '0',
      'content-type': 'application/json',
    });
    let status = 0;
    let body = '';
    req.on('response', (headers) => {
      status = headers[':status'] || 0;
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      session.close();
      if (status === 200) {
        resolve({ ok: true });
        return;
      }
      let reason = `HTTP${status}`;
      try {
        const parsed = JSON.parse(body);
        if (parsed && parsed.reason) reason = parsed.reason;
      } catch (e) {}
      resolve({ ok: false, reason });
    });
    req.on('error', () => {
      try { session.close(); } catch (e) {}
      resolve({ ok: false, reason: 'RequestError' });
    });
    req.end(JSON.stringify(payloadObj));
  });
}

async function sendViaApns(deviceToken, title, body, data) {
  const config = getApnsConfig();
  if (!config) {
    // APNs未設定はトークンの問題ではないので invalid にはしない
    console.error('APNs env vars (APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY) are not set.');
    return { ok: false, invalid: false, reason: 'ApnsNotConfigured' };
  }
  const jwt = getApnsJwt(config);
  const payloadObj = {
    aps: {
      alert: { title, body },
      sound: 'default',
      badge: 1,
      'mutable-content': 1,
    },
    ...(data || {}),
  };

  const hosts = config.production === 'true'
    ? ['api.push.apple.com']
    : config.production === 'false'
      ? ['api.sandbox.push.apple.com']
      : ['api.push.apple.com', 'api.sandbox.push.apple.com'];

  const invalidReasons = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);
  for (const host of hosts) {
    const result = await sendApnsOnce(host, config, jwt, deviceToken, payloadObj);
    if (result.ok) return { ok: true };
    if (invalidReasons.has(result.reason)) {
      // 本番で BadDeviceToken の場合は Sandbox 端末の可能性があるため次を試す。
      // 最後のホストでも無効ならトークン自体が無効とみなす
      if (host === hosts[hosts.length - 1]) {
        return { ok: false, invalid: true, reason: result.reason };
      }
      continue;
    }
    return { ok: false, invalid: false, reason: result.reason };
  }
  return { ok: false, invalid: true, reason: 'BadDeviceToken' };
}

// ------------------------------------------
// FCM（Android / Web 向け）
// ------------------------------------------
async function sendViaFcm(token, safeTitle, safeBody, safeData) {
  const messaging = getMessaging();
  const message = {
    token,
    notification: {
      title: safeTitle,
      body: safeBody,
    },
    data: safeData,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
      },
      payload: {
        aps: {
          alert: {
            title: safeTitle,
            body: safeBody,
          },
          sound: 'default',
          badge: 1,
        },
      },
    },
    webpush: {
      headers: {
        Urgency: 'high',
      },
      notification: {
        title: safeTitle,
        body: safeBody,
        icon: '/logo192.png',
        badge: '/logo192.png',
      },
      fcmOptions: {
        link: safeData.url || '/',
      },
    },
  };
  try {
    await messaging.send(message);
    return { ok: true };
  } catch (err) {
    const code = err && err.code ? err.code : '';
    const invalid = (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument'
    );
    return { ok: false, invalid, reason: code || String(err) };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // 認証必須: アプリユーザーの Firebase ID トークンを検証する（オープンな中継にしない）
  const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    if (!idToken) throw new Error('missing token');
    const { getAuth } = require('firebase-admin/auth');
    await getAuth().verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { targetUserId, title, body, data } = req.body || {};
  if (!targetUserId || typeof targetUserId !== 'string') {
    return res.status(400).json({ success: false, message: 'targetUserId is required' });
  }

  // 送信先トークンはサーバー側でアカウント情報から解決する。
  // クライアントからトークンを受け取る方式は、誰でも任意の端末に送れてしまうため廃止。
  let tokens = [];
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    const accSnap = await getFirestore().doc(`artifacts/withfit-app/public/data/accounts/${targetUserId}`).get();
    if (accSnap.exists) {
      const acc = accSnap.data() || {};
      tokens = [...new Set([
        ...(Array.isArray(acc.fcmTokens) ? acc.fcmTokens : []),
        acc.fcmToken
      ].filter(t => typeof t === 'string' && t.trim().length > 0))];
    }
  } catch (e) {
    console.error('Token lookup failed:', e);
  }

  if (tokens.length === 0) {
    return res.status(200).json({ success: false, successCount: 0, failureCount: 0, invalidTokens: [], message: 'No device tokens for target user' });
  }

  const safeTitle = title || 'WithFit';
  const safeBody = body || '';
  const safeData = {};
  if (data && typeof data === 'object') {
    Object.entries(data).forEach(([k, v]) => {
      if (v !== undefined && v !== null) safeData[k] = String(v);
    });
  }
  safeData.title = safeTitle;
  safeData.body = safeBody;

  try {
    const invalidTokens = [];
    const results = await Promise.allSettled(
      tokens.map(async (token) => {
        const kind = classifyToken(token);
        if (kind === 'invalid') {
          invalidTokens.push(token);
          throw new Error('Placeholder token is not deliverable');
        }
        const result = kind === 'apns'
          ? await sendViaApns(token, safeTitle, safeBody, safeData)
          : await sendViaFcm(token, safeTitle, safeBody, safeData);
        if (!result.ok) {
          if (result.invalid) invalidTokens.push(token);
          throw new Error(result.reason || 'Send failed');
        }
        return result;
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.length - successCount;

    // 無効トークンの掃除もサーバー側で行う（クライアントは他人のトークンを持たない）
    if (invalidTokens.length > 0) {
      try {
        const { getFirestore, FieldValue } = require('firebase-admin/firestore');
        const ref = getFirestore().doc(`artifacts/withfit-app/public/data/accounts/${targetUserId}`);
        const snap2 = await ref.get();
        if (snap2.exists) {
          const acc2 = snap2.data() || {};
          const current = [...new Set([
            ...(Array.isArray(acc2.fcmTokens) ? acc2.fcmTokens : []),
            acc2.fcmToken
          ].filter(t => typeof t === 'string' && t.trim().length > 0))];
          const valid = current.filter(t => !invalidTokens.includes(t));
          await ref.update({
            fcmTokens: valid,
            fcmToken: valid.length > 0 ? valid[valid.length - 1] : FieldValue.delete()
          });
        }
      } catch (e) {
        console.warn('Token cleanup failed:', e);
      }
    }

    return res.status(200).json({
      success: successCount > 0,
      successCount,
      failureCount,
      invalidTokens,
    });
  } catch (error) {
    console.error('Error sending push message:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
