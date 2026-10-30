# WithFit（ウィズフィット）iOS ネイティブアプリ版 🏋️‍♂️🔥📱

> **「みんなで鍛える、記録アプリ」**  
> 友人同士でトレーニング記録・重量・体組成データを共有し、モチベーションを高め合える高機能ソーシャルワークアウトトラッカー（**iOS ネイティブアプリ `.ipa` / Windows PC + GitHub Actions クラウドビルド対応**）。

---

## 📱 iOS ネイティブアプリ版の主な特徴（PWA廃止・完全ネイティブ化）

1. **スタンドアロン iOS ネイティブアプリ (`WithFit.app` / `.ipa`)**
   - PWA（マニフェスト・Service Worker・「ホーム画面に追加」誘導）を完全廃止。
   - アプリ内にフロントエンド資産（`WebBundle`）とローカル高速配信サーバー（`LocalBundleServer.swift`）を内蔵し、ネイティブアプリとして即座に起動します。
2. **ロック画面・バックグラウンド完全対応のインターバルタイマー**
   - 休憩タイマー開始と同時に iOS ネイティブの `UNUserNotificationCenter`（Time-Sensitive 通知）をスケジュール。
   - **画面をロックしてポケットに入れていても、他アプリ（Spotify・LINE・YouTube等）を開いていても**、インターバル終了時刻に iPhone のロック画面・Dynamic Island・Apple Watch へ確実にアラーム通知が鳴動します。
3. **ジムの音楽（Spotify / Apple Music）を一切止めないオーディオ設計**
   - `AVAudioSession` の `.ambient` + `.mixWithOthers` 制御により、アプリ起動中やタイマー操作中もバックグラウンドの音楽再生が止まりません。
4. **トレーニング中のバックグラウンド維持 & 記録忘れ防止通知**
   - トレーニング開始中（`isTraining` ON）はネイティブの無音キープアライブによりバックグラウンドでも通信・タイマーを維持。
   - 開始3分後のフレンド自動通知、30分操作なしの記録忘れリマインダー、合トレリアルタイム同期、新着通知バナーがネイティブで動作します。
5. **iOS Taptic Engine（触覚フィードバック）& ネイティブ UI 統合**
   - タブ切り替え、記録ボタン、荷重／アシスト切替、セット完了、ナイス！、アラーム鳴動時に iPhone の Taptic Engine（`UIImpactFeedbackGenerator` / `UINotificationFeedbackGenerator`）が振動。
   - 確認ダイアログ（`confirm` / `alert`）も URL 表記のない iOS 純正 `UIAlertController` で表示され、テーマ（ライト／ダーク／オーシャン／ポップ）に応じて iOS ステータスバーの文字色・背景色もリアルタイムに連動します。
6. **Mac 不要！Windows PC ＋ GitHub だけで `.ipa` をクラウド自動生成**
   - GitHub Actions のクラウド Mac（`macos-latest` + Xcode）が自動的に `WithFit-iOS.ipa` をビルドし、GitHub Releases に公開します。

---

## 🚀 Windows PC から iPhone へインストールする手順（Mac 不要）

### ステップ 1：GitHub へプッシュして `.ipa` をクラウドビルドする

1. フォルダ内の **`apdate.bat`**（初回またはクリーン同期時は **`reset_github.bat`**）をダブルクリックします。
2. GitHub にコードがプッシュされると、GitHub Actions（`Build WithFit iOS Native App (.ipa)`）が自動的に起動し、クラウド上の Mac で Xcode ビルドが実行されます（所要時間：約2〜3分）。
3. フォルダ内の **`download_ios_ipa.bat`** をダブルクリックすると、GitHub Releases の最新リリースページ（`ios-latest`）が開きます。
4. **`WithFit-iOS.ipa`** を Windows PC にダウンロードします。

> 💡 GitHub の **「Actions」タブ → 最新のワークフロー実行結果 → 「Artifacts」欄の `WithFit-iOS-App`** からも `WithFit-iOS.ipa` をダウンロードできます。

---

### ステップ 2：Windows PC から iPhone に `WithFit-iOS.ipa` をインストールする

無料の Apple ID（年額99ドルの開発者登録なし）のまま、Windows PC から以下のいずれかの定番ツールで iPhone へインストールできます。

#### 方法A：Sideloadly を使う場合（一番手軽でおすすめ）
1. Windows PC に **iTunes（Microsoft Store版ではなくApple公式インストーラー版）** と **iCloud（Apple公式版）**、および **[Sideloadly](https://sideloadly.io/)** をインストールします。
2. iPhone と Windows PC をケーブルで接続し、iPhone 側で「このコンピュータを信頼」をタップします。
3. Sideloadly を起動し、**IPA アイコン** にダウンロードした `WithFit-iOS.ipa` をドラッグ＆ドロップします。
4. `Apple ID` 欄にご自身の Apple ID（メールアドレス）を入力し、**「Start」** をクリックします（初回のみパスワードと2段階認証コードを入力）。
5. インストール完了後、iPhone のホーム画面に **WithFit** アプリが追加されます！
   - ※初回起動時に「信頼されていないデベロッパ」と表示された場合は、iPhone の **「設定」→「一般」→「VPNとデバイス管理」** からご自身の Apple ID をタップして「信頼」を押してください。
   - ※iOS 16 以降でデベロッパモードの案内が出た場合は、**「設定」→「プライバシーとセキュリティ」→「デベロッパモード」** をオンにして再起動してください。
   - ※Sideloadly は同じ Wi-Fi 内に PC があれば自動更新（Wi-Fi Sideloading）も可能です。

#### 方法B：AltStore / SideStore を使う場合（iPhone 単体での署名更新に対応）
1. Windows PC に **[AltServer](https://altstore.io/)**（または **[SideStore](https://sidestore.io/)**）をインストールして iPhone へ導入します。
2. iPhone で `WithFit-iOS.ipa` をダウンロードし、AltStore / SideStore アプリの「My Apps」画面左上の「＋」ボタンから `WithFit-iOS.ipa` を選択してインストールします。

---

## 🔄 普段のコード更新フロー（`changes.json` 対応）

これまで通り、PC の **`apdate.bat`** または **スマホの GitHub アプリから `src/changes.json` をコミット** するだけで、以下がすべて自動実行されます：

1. `node src/apply_changes.js` によるソースコードの自動書き換え
2. Vercel 側の API サーバー（`/api/gemini`, `/api/sendPush`）の自動更新
3. GitHub Actions（クラウド Mac）による最新 **`WithFit-iOS.ipa`** の自動リビルド＆ GitHub Releases（`ios-latest`）への上書き公開

> 💡 **アプリ内の隠しネイティブ設定メニュー**  
> iPhone アプリ画面上で **「3本指でダブルタップ」** すると、ネイティブ設定シートが開き、画面の再読み込みや API サーバー URL（Vercel の URL）の確認・変更が行えます。

---

## 📁 ディレクトリ構成

```text
WithFit/
├── .github/
│   └── workflows/
│       └── ios-build.yml        # クラウドMac(Xcode)で WithFit-iOS.ipa を自動生成・公開するCI
├── ios/                         # iOS ネイティブアプリ (Swift / Xcode プロジェクト)
│   ├── WithFit.xcodeproj/       # Xcode プロジェクトファイル
│   ├── project.yml              # XcodeGen 構成定義ファイル
│   └── WithFit/
│       ├── AppDelegate.swift                # アプリ起動・APNs/ローカル通知デリゲート
│       ├── SceneDelegate.swift              # ウィンドウ・フォアグラウンド復帰管理
│       ├── MainViewController.swift         # WKWebView・Safe Area・ネイティブブリッジ・OAuthシート
│       ├── LocalBundleServer.swift          # ローカル配信サーバー & /api/* バックエンドプロキシ
│       ├── NativeAudioAndTimerManager.swift # Taptic Engine・バックグラウンド維持・ネイティブタイマー通知
│       ├── Assets.xcassets/                 # iOS アプリアイコン一式 (AppIcon.appiconset)
│       ├── WebBundle/                       # ビルド済みフロントエンド格納先
│       ├── Info.plist                       # iOS アプリ設定・バックグラウンドモード定義
│       └── WithFit.entitlements             # 通知エンタイトルメント
├── api/
│   ├── gemini.js                # Gemini API連携用サーバーレス関数 (CORS対応)
│   └── sendPush.js              # FCM/APNsプッシュ通知配信サーバーレス関数 (CORS対応)
├── functions/                   # Firebase Cloud Functions
├── public/
│   ├── index.html               # iOSネイティブビューポート仕様HTML (PWA廃止済み)
│   ├── icon.png
│   └── alarm.mp3                # インターバルタイマー用アラーム音
├── src/
│   ├── nativeBridge.js          # iOS ネイティブブリッジ連携モジュール (Haptics/Timer/Push/Theme)
│   ├── App.js                   # メインルーティング、グローバル状態、ネイティブ通知連携
│   ├── CommonUI.js              # 共通UI（ネイティブ触覚フィードバック統合）
│   ├── DataView.js              # カレンダー、推移グラフ、月間レポート
│   ├── ExercisesView.js         # 種目・ジム管理画面
│   ├── FriendsView.js           # フレンド一覧、申請、プロフィール詳細
│   ├── ProfileModals.js         # ログイン画面、プロフィール設定、Google連携
│   ├── RecordView.js            # トレーニング記録・開始画面、プログラム管理
│   ├── WorkoutCard.js           # タイムライン投稿カード、コメント、構成コピー
│   ├── WorkoutForm.js           # 種目入力フォーム、セット行入力、並び替え、編集モーダル
│   ├── CoachAndGame.js          # AIコーチチャット、ミニゲーム
│   ├── firebase.js              # Firebase初期化設定
│   ├── utils.js                 # ボリューム計算、PR判定、日付フォーマット等のユーティリティ
│   ├── apply_changes.js         # changes.json をソースコードに自動適用するスクリプト
│   └── changes.json             # AI変更差分ファイル
├── apdate.bat                   # Windows PCからのワンクリック更新＆iOSクラウドビルド開始スクリプト
├── download_ios_ipa.bat         # 最新 WithFit-iOS.ipa のダウンロードページを開くスクリプト
└── reset_github.bat             # Windows PCからGitHubリポジトリを一発で強制クリーン化するスクリプト
```
