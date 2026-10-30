/**
 * push_jobs コレクションへの追加をトリガーに、プッシュ通知を送信する関数。
 *
 * iOSネイティブアプリの端末トークンは APNs デバイストークン（64文字hex）のため
 * FCM では届かない。APNs トークンは APNs へ直接配信し、それ以外は FCM で送信する
 * （アプリ未起動・終了状態でも通知が届くようにするため）。
 *
 * APNs 用の環境変数:
 *   APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY(.p8)
 *   APNS_BUNDLE_ID（未設定時は com.michitsuji.withfit）
 *   APNS_PRODUCTION（'true' 本番のみ / 'false' Sandboxのみ / 未設定は両方試行）
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const http2 = require("http2");
const crypto = require("crypto");

// Firebase Admin SDKの初期化
admin.initializeApp();

const APNS_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/;
const PLACEHOLDER_TOKENS = new Set(["ios_native_local_notification_enabled"]);

function getApnsConfig() {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const privateKey = process.env.APNS_PRIVATE_KEY
    ? process.env.APNS_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined;
  if (!keyId || !teamId || !privateKey) return null;
  return {
    keyId,
    teamId,
    privateKey,
    bundleId: process.env.APNS_BUNDLE_ID || "com.michitsuji.withfit",
    production: process.env.APNS_PRODUCTION,
  };
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createApnsJwt(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = base64Url(JSON.stringify({ iss: config.teamId, iat: now }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64Url(signature)}`;
}

function sendApnsOnce(host, config, jwt, deviceToken, payloadObj) {
  return new Promise((resolve) => {
    const session = http2.connect(`https://${host}`);
    session.on("error", () => resolve({ ok: false, reason: "ConnectionError" }));
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "authorization": `bearer ${jwt}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    req.on("response", (headers) => {
      status = headers[":status"] || 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
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
    req.on("error", () => {
      try { session.close(); } catch (e) {}
      resolve({ ok: false, reason: "RequestError" });
    });
    req.end(JSON.stringify(payloadObj));
  });
}

async function sendViaApns(deviceToken, title, body, data) {
  const config = getApnsConfig();
  if (!config) {
    throw new Error("APNs env vars (APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY) are not set.");
  }
  const jwt = createApnsJwt(config);
  const payloadObj = {
    aps: {
      alert: { title, body },
      sound: "default",
      badge: 1,
      "mutable-content": 1,
    },
    ...(data || {}),
  };
  const hosts = config.production === "true"
    ? ["api.push.apple.com"]
    : config.production === "false"
      ? ["api.sandbox.push.apple.com"]
      : ["api.push.apple.com", "api.sandbox.push.apple.com"];

  let lastReason = "Unknown";
  for (const host of hosts) {
    const result = await sendApnsOnce(host, config, jwt, deviceToken, payloadObj);
    if (result.ok) return `apns:${host}`;
    lastReason = result.reason;
    if (result.reason !== "BadDeviceToken") break;
  }
  throw new Error(`APNs send failed: ${lastReason}`);
}

// push_jobsコレクションに新しいデータが追加されたときに実行される関数
exports.sendPushNotification = functions.firestore
  .document("artifacts/withfit-app/public/data/push_jobs/{jobId}")
  .onCreate(async (snap, context) => {
    const jobData = snap.data();
    const targetToken = jobData.targetToken;
    const title = jobData.title || "WithFit";
    const body = jobData.body || "";
    const data = (jobData.data && typeof jobData.data === "object") ? jobData.data : {};

    // トークンがない場合は終了
    if (!targetToken) {
      console.log("通知先のトークンがありません。");
      return null;
    }

    try {
      let response;
      if (PLACEHOLDER_TOKENS.has(targetToken)) {
        throw new Error("Placeholder token is not deliverable");
      } else if (APNS_TOKEN_PATTERN.test(targetToken)) {
        // iOSネイティブ端末: APNs へ直接配信
        response = await sendViaApns(targetToken, title, body, data);
      } else {
        // Android / Web: FCM 経由で送信
        response = await admin.messaging().send({
          notification: { title, body },
          data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          ),
          token: targetToken,
        });
      }
      console.log("通知の送信に成功しました:", response);

      // 成功した場合はステータスを完了に更新
      return snap.ref.update({
        status: "completed",
        response: String(response),
      });
    } catch (error) {
      console.error("通知の送信に失敗しました:", error);

      // 失敗した場合はステータスをエラーに更新
      return snap.ref.update({
        status: "failed",
        error: error.message,
      });
    }
  });
const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })
setGlobalOptions({ maxInstances: 10 });
