import UIKit
import WebKit
import UserNotifications
import AuthenticationServices
import CryptoKit
import AVFoundation
import CoreImage
import Photos
import PhotosUI

final class MainViewController: UITabBarController, UITabBarControllerDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {

    static weak var shared: MainViewController?

    private var webView: WKWebView!
    private var popupWebView: WKWebView?
    private var popupNavController: UINavigationController?
    private let statusBarBackgroundView = UIView()
    private var currentStatusBarStyle: UIStatusBarStyle = .darkContent
    private var hasRequestedInitialNotifAuth = false

    private let tabKeys = ["timeline", "exercises", "record", "data", "friends"]
    private var tabVCs: [UIViewController] = []
    private var isReselectingTab = false
    private var webViewConstraints: [NSLayoutConstraint] = []
    // タブバー表示状態（Web側のログイン状態と、ロード中/全画面表示中の強制非表示を合成する）
    private var isTabBarLoggedIn = false
    private var splashView: UIView?
    private var splashShownAt: CFTimeInterval = 0
    private var splashDismissed = false
    private var appleSignInNonce: String?
    private var splashProgressView: UIProgressView?
    private var splashProgressValue: Float = 0
    private var splashProgressTimer: Timer?
    private var splashProgressShown = false
    private var isTabBarForceHidden = false

    private func refreshTabBarVisibility() {
        self.tabBar.isHidden = isTabBarForceHidden || !isTabBarLoggedIn
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return currentStatusBarStyle
    }

    override var childForStatusBarStyle: UIViewController? {
        return nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        Self.shared = self
        self.delegate = self
        setupNativeLiquidGlassTabs()
        setupWebView()
        if let firstVC = tabVCs.first {
            attachWebView(to: firstVC)
        }
        loadWithFitApp()
        AdBannerManager.shared.start(in: self)
        setupSplash()
    }

    // MARK: - Native Splash（起動表示はネイティブ側で完結させる）
    private func setupSplash() {
        let splash = UIView()
        splash.backgroundColor = UIColor(named: "LaunchBackground") ?? UIColor(red: 248/255, green: 250/255, blue: 252/255, alpha: 1.0)
        splash.translatesAutoresizingMaskIntoConstraints = false

        // ロゴ＋文字は1枚の合成画像（LaunchLogo）を使う。起動画面（Launch Screen）と
        // まったく同じ画像・同じサイズなので、起動画面→スプラッシュで絵が切り替わらない
        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.contentMode = .scaleAspectFit
        logo.translatesAutoresizingMaskIntoConstraints = false
        splash.addSubview(logo)

        view.addSubview(splash)
        view.bringSubviewToFront(splash)
        NSLayoutConstraint.activate([
            splash.topAnchor.constraint(equalTo: view.topAnchor),
            splash.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            splash.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            splash.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            logo.centerXAnchor.constraint(equalTo: splash.centerXAnchor),
            logo.centerYAnchor.constraint(equalTo: splash.centerYAnchor),
            logo.widthAnchor.constraint(equalToConstant: 200),
            logo.heightAnchor.constraint(equalToConstant: 49)
        ])

        // 進捗バー（表示の要否は Web 側の概算 LOAD_ESTIMATE で決まる）
        let progressView = UIProgressView(progressViewStyle: .bar)
        progressView.trackTintColor = UIColor(red: 203/255, green: 213/255, blue: 225/255, alpha: 1.0)
        progressView.progressTintColor = UIColor(red: 0/255, green: 112/255, blue: 192/255, alpha: 1.0)
        progressView.layer.cornerRadius = 2
        progressView.clipsToBounds = true
        progressView.alpha = 0
        progressView.translatesAutoresizingMaskIntoConstraints = false
        splash.addSubview(progressView)
        NSLayoutConstraint.activate([
            progressView.centerXAnchor.constraint(equalTo: splash.centerXAnchor),
            progressView.topAnchor.constraint(equalTo: logo.bottomAnchor, constant: 28),
            progressView.widthAnchor.constraint(equalToConstant: 160),
            progressView.heightAnchor.constraint(equalToConstant: 4)
        ])
        splashProgressView = progressView
        // 表示するかどうかは Web 側の概算（LOAD_ESTIMATE）で決まる。
        // 長くなりそうな時だけ最初から表示し、短く済む時は出さない。
        splashView = splash
        splashShownAt = CACurrentMediaTime()
        // Web 側から準備完了が来ない場合の保険（6秒で自動的に開く）
        DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) { [weak self] in
            self?.dismissSplash()
        }
    }

    private func showSplashProgressIfNeeded() {
        guard !splashDismissed, splashView != nil, !splashProgressShown else { return }
        splashProgressShown = true
        if splashProgressValue > 0 {
            splashProgressView?.setProgress(splashProgressValue, animated: false)
        }
        UIView.animate(withDuration: 0.3) {
            self.splashProgressView?.alpha = 1
        }
        // 実進捗が止まって見えないよう、95%を上限にゆっくり進める
        splashProgressTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in
            guard let self = self, !self.splashDismissed else { return }
            if self.splashProgressValue < 0.95 {
                self.splashProgressValue = min(0.95, self.splashProgressValue + (0.95 - self.splashProgressValue) * 0.02 + 0.001)
                self.splashProgressView?.setProgress(self.splashProgressValue, animated: true)
            }
        }
    }

    private func dismissSplash() {
        guard !splashDismissed, let splash = splashView else { return }
        splashDismissed = true
        splashProgressTimer?.invalidate()
        splashProgressTimer = nil
        if splashProgressShown {
            splashProgressView?.setProgress(1.0, animated: true)
        }
        let elapsed = CACurrentMediaTime() - splashShownAt
        let wait = max(0, 1.0 - elapsed)
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
            UIView.animate(withDuration: 0.45, delay: 0, options: [.curveEaseIn]) {
                splash.transform = CGAffineTransform(scaleX: 1.9, y: 1.9)
            }
            UIView.animate(withDuration: 0.14, delay: 0.31, options: [.curveEaseIn], animations: {
                splash.alpha = 0
            }, completion: { _ in
                splash.removeFromSuperview()
                if self.splashView === splash { self.splashView = nil }
            })
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !hasRequestedInitialNotifAuth {
            hasRequestedInitialNotifAuth = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.requestNativeNotificationPermissionIfNeeded()
            }
        }
        AdBannerManager.shared.requestTrackingAuthorizationIfNeeded()
    }

    // MARK: - Genuine iOS 26 Native UITabBarController Setup (Liquid Glass UI)
    private func setupNativeLiquidGlassTabs() {
        let specs: [(key: String, title: String, icon: String, selectedIcon: String)] = [
            ("timeline", "ホーム", "house", "house.fill"),
            ("exercises", "種目", "dumbbell", "dumbbell.fill"),
            ("record", "記録", "plus.circle", "plus.circle.fill"),
            ("data", "データ", "calendar", "calendar"),
            ("friends", "フレンド", "person.2", "person.2.fill")
        ]

        var controllers: [UIViewController] = []
        for (idx, spec) in specs.enumerated() {
            let vc = UIViewController()
            vc.edgesForExtendedLayout = .all
            vc.extendedLayoutIncludesOpaqueBars = true
            vc.view.backgroundColor = .clear

            let item = UITabBarItem(
                title: spec.title,
                image: UIImage(systemName: spec.icon),
                selectedImage: UIImage(systemName: spec.selectedIcon)
            )
            item.tag = idx
            vc.tabBarItem = item
            controllers.append(vc)
        }

        self.tabVCs = controllers
        self.viewControllers = controllers
        self.selectedIndex = 0
        // 起動直後は必ずタブバーを隠す。Web側の読み込みが完了し、
        // ログイン状態が SYNC_ACTIVE_TAB で届いてから表示する
        self.tabBar.isHidden = true
        self.tabBar.tintColor = UIColor(red: 0/255, green: 112/255, blue: 192/255, alpha: 1.0)
    }

    private func setupWebView() {
        view.backgroundColor = UIColor(red: 248/255, green: 250/255, blue: 252/255, alpha: 1.0)
        statusBarBackgroundView.backgroundColor = UIColor(red: 248/255, green: 250/255, blue: 252/255, alpha: 1.0)
        statusBarBackgroundView.translatesAutoresizingMaskIntoConstraints = false

        let config = WKWebViewConfiguration()
        config.processPool = WKProcessPool()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        let contentController = WKUserContentController()
        let savedNativeDBJSON = Self.loadNativeLocalDBJSON()
        let bridgeScriptSource = """
        window.__WITHFIT_NATIVE_DB__ = \(savedNativeDBJSON);
        window.__WITHFIT_OS_PERMISSION__ = 'default';
        window.WithFitNative = true;
        window.WithFitUsesNativeTabBar = true;
        window.ReactNativeWebView = {
          postMessage: function(msgStr) {
            try {
              var parsed = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
              if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.WithFitNative) {
                window.webkit.messageHandlers.WithFitNative.postMessage(parsed);
              }
            } catch (e) {}
          }
        };
        """
        let userScript = WKUserScript(source: bridgeScriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        contentController.addUserScript(userScript)
        contentController.add(self, name: "WithFitNative")
        config.userContentController = contentController

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

    }

    private func attachWebView(to targetVC: UIViewController) {
        guard let container = targetVC.view else { return }
        if webView.superview === container { return }

        NSLayoutConstraint.deactivate(webViewConstraints)
        statusBarBackgroundView.removeFromSuperview()
        webView.removeFromSuperview()

        container.addSubview(statusBarBackgroundView)
        container.addSubview(webView)

        let constraints = [
            statusBarBackgroundView.topAnchor.constraint(equalTo: container.topAnchor),
            statusBarBackgroundView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            statusBarBackgroundView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            statusBarBackgroundView.bottomAnchor.constraint(equalTo: container.safeAreaLayoutGuide.topAnchor),

            webView.topAnchor.constraint(equalTo: container.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ]
        NSLayoutConstraint.activate(constraints)
        self.webViewConstraints = constraints
    }

    // MARK: - UITabBarControllerDelegate (Native iOS 26 Liquid Glass Tab Selection)
    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        isReselectingTab = (viewController === selectedViewController)
        attachWebView(to: viewController)
        return true
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        NativeAudioAndTimerManager.shared.triggerHaptic(style: "selection")
        let idx = viewController.tabBarItem.tag
        guard idx >= 0 && idx < tabKeys.count else { return }
        let tabKey = tabKeys[idx]
        sendToWeb(payload: [
            "type": "NATIVE_TAB_SELECT",
            "tab": tabKey,
            "isReselect": isReselectingTab
        ])
    }

    private func loadWithFitApp() {
        LocalBundleServer.shared.start()
        let url = LocalBundleServer.shared.baseURL
        // バイトコードキャッシュを有効化して0秒で高速起動
        let request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30)
        webView.load(request)
    }

    // MARK: - WKScriptMessageHandler (React -> Swift Native Bridge)
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "WithFitNative" else { return }

        // 呼び出し元がローカルバンドル以外（外部ページやポップアップ等）の場合は受け付けない
        let senderHost = message.frameInfo.request.url?.host?.lowercased() ?? ""
        guard senderHost == "localhost" || senderHost == "127.0.0.1" else { return }

        var dict: [String: Any]?
        if let bodyDict = message.body as? [String: Any] {
            dict = bodyDict
        } else if let bodyStr = message.body as? String,
                  let data = bodyStr.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            dict = parsed
        }
        guard let payload = dict, let type = payload["type"] as? String else { return }

        switch type {
        case "APP_READY":
            dismissSplash()

        case "LOAD_ESTIMATE":
            if let show = payload["showBar"] as? Bool, show {
                showSplashProgressIfNeeded()
            }

        case "LOAD_PROGRESS":
            if let v = payload["value"] as? Double {
                splashProgressValue = max(splashProgressValue, Float(min(1.0, max(0.0, v))))
                if splashProgressShown {
                    splashProgressView?.setProgress(splashProgressValue, animated: true)
                }
            }

        case "APPLE_SIGN_IN":
            startAppleSignIn()

        case "HAPTIC":
            let style = payload["style"] as? String ?? "light"
            NativeAudioAndTimerManager.shared.triggerHaptic(style: style)

        case "SHARE_IMAGE":
            // v46で実績のある方式（UIImageをメインスレッドで渡す）
            if let b64 = payload["image"] as? String,
               let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
               let image = UIImage(data: data) {
                DispatchQueue.main.async { [weak self] in
                    self?.presentShareSheet(image: image)
                }
            }

        case "OPEN_SHARE_CAMERA":
            // ネイティブのライブカメラ（コラージュ重ね表示付き）を開く
            var overlay: UIImage? = nil
            if let b64 = payload["overlay"] as? String,
               let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) {
                overlay = UIImage(data: data)
            }
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                let vc = ShareCameraViewController()
                vc.overlayImage = overlay
                vc.modalPresentationStyle = .fullScreen
                vc.onCapturedImage = { [weak self] image in
                    if let b64 = image.jpegData(compressionQuality: 0.92)?.base64EncodedString() {
                        self?.sendToWeb(payload: ["type": "SHARE_CAMERA_RESULT", "image": b64])
                    }
                }
                vc.onCancelled = { [weak self] in
                    self?.sendToWeb(payload: ["type": "SHARE_CAMERA_RESULT", "cancelled": true])
                }
                vc.onError = { [weak self] message in
                    self?.sendToWeb(payload: ["type": "SHARE_CAMERA_RESULT", "error": message])
                }
                var topVC: UIViewController = self
                while let presented = topVC.presentedViewController { topVC = presented }
                topVC.present(vc, animated: true)
            }

        case "OPEN_SHARE_EDITOR":
            // シェア画像の編集画面（全面Swift）を開く。
            // overlay は記録部分だけを描いた透明PNG（1080x1920）。
            guard let b64 = payload["overlay"] as? String,
                  let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
                  let overlay = UIImage(data: data) else { break }
            let autoOpen = payload["autoOpen"] as? String ?? "none"
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                let editor = ShareEditorViewController()
                editor.overlayImage = overlay
                editor.autoOpen = autoOpen
                editor.modalPresentationStyle = .fullScreen
                var topVC: UIViewController = self
                while let presented = topVC.presentedViewController { topVC = presented }
                topVC.present(editor, animated: true)
            }

        case "SAVE_IMAGE":
            // 完成画像をフォトライブラリへ直接保存する
            if let b64 = payload["image"] as? String,
               let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
               let image = UIImage(data: data) {
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] status in
                    guard status == .authorized || status == .limited else {
                        self?.sendToWeb(payload: ["type": "SAVE_IMAGE_RESULT", "error": "denied"])
                        return
                    }
                    PHPhotoLibrary.shared().performChanges({
                        PHAssetChangeRequest.creationRequestForAsset(from: image)
                    }) { success, _ in
                        if success {
                            self?.sendToWeb(payload: ["type": "SAVE_IMAGE_RESULT", "ok": true])
                        } else {
                            self?.sendToWeb(payload: ["type": "SAVE_IMAGE_RESULT", "error": "failed"])
                        }
                    }
                }
            } else {
                sendToWeb(payload: ["type": "SAVE_IMAGE_RESULT", "error": "invalid"])
            }

        case "SHARE_TO_INSTAGRAM_STORIES":
            // 画像をペーストボード経由で Instagram ストーリーズ作成画面へ渡す
            if let b64 = payload["image"] as? String,
               let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) {
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    let pasteboardItems: [String: Any] = ["com.instagram.sharedSticker.backgroundImage": data]
                    UIPasteboard.general.setItems([pasteboardItems], options: [.expirationDate: Date().addingTimeInterval(60 * 5)])
                    let appId = Bundle.main.object(forInfoDictionaryKey: "WithFitFacebookAppID") as? String ?? ""
                    var components = URLComponents(string: "instagram-stories://share")
                    if !appId.isEmpty {
                        components?.queryItems = [URLQueryItem(name: "source_application", value: appId)]
                    }
                    if let url = components?.url, UIApplication.shared.canOpenURL(url) {
                        UIApplication.shared.open(url, options: [:], completionHandler: nil)
                    } else if let image = UIImage(data: data) {
                        // Instagram が無い場合は通常の共有シートにフォールバック
                        self.presentShareSheet(image: image)
                    }
                }
            }

        case "VIBRATE":
            NativeAudioAndTimerManager.shared.triggerHaptic(style: "vibrate")

        case "PLAY_ALARM":
            let volume = (payload["volume"] as? NSNumber)?.floatValue ?? 1.0
            NativeAudioAndTimerManager.shared.playNativeAlarm(volume: volume)

        case "STOP_ALARM":
            NativeAudioAndTimerManager.shared.stopAlarmSoundAndVibration()

        case "START_REST_TIMER":
            let seconds = (payload["seconds"] as? NSNumber)?.intValue ?? 0
            NativeAudioAndTimerManager.shared.scheduleRestTimer(seconds: seconds)

        case "CANCEL_REST_TIMER":
            NativeAudioAndTimerManager.shared.cancelRestTimer()

        case "START_FORGOT_TIMER":
            let seconds = (payload["seconds"] as? NSNumber)?.intValue ?? 1800
            NativeAudioAndTimerManager.shared.scheduleForgotTimer(seconds: seconds)

        case "CANCEL_FORGOT_TIMER":
            NativeAudioAndTimerManager.shared.cancelForgotTimer()

        case "SET_TRAINING_STATE":
            let isTraining = payload["isTraining"] as? Bool ?? false
            NativeAudioAndTimerManager.shared.setTrainingState(isTraining: isTraining)
            updateRecordTabTrainingState(isTraining: isTraining)
            if #available(iOS 16.1, *) {
                let gymName = payload["gymName"] as? String ?? "ジム"
                let exerciseName = payload["exerciseName"] as? String ?? ""
                let exerciseIndex = payload["exerciseIndex"] as? Int ?? -1
                let currentSet = payload["currentSet"] as? Int ?? 0
                let restRinging = payload["restRinging"] as? Bool ?? false
                var restStartedAt: Date? = nil
                var restEndsAt: Date? = nil
                if let restStartMs = payload["restStartTime"] as? Double, restStartMs > 0 {
                    restStartedAt = Date(timeIntervalSince1970: restStartMs / 1000.0)
                    let restDurationSec = payload["restDurationSec"] as? Int ?? 0
                    if restDurationSec > 0 {
                        restEndsAt = restStartedAt?.addingTimeInterval(TimeInterval(restDurationSec))
                    }
                }
                let startDate: Date?
                if let startMs = payload["trainingStartTime"] as? Double, startMs > 0 {
                    startDate = Date(timeIntervalSince1970: startMs / 1000.0)
                } else {
                    startDate = nil
                }
                TrainingLiveActivityManager.shared.syncTrainingState(
                    isTraining: isTraining,
                    startTime: startDate,
                    gymName: gymName,
                    exerciseName: exerciseName,
                    exerciseIndex: exerciseIndex,
                    currentSet: currentSet,
                    restStartedAt: restStartedAt,
                    restEndsAt: restRinging ? nil : restEndsAt,
                    restRinging: restRinging
                )
            }

        case "SYNC_ACTIVE_TAB":
            let tab = payload["tab"] as? String ?? "timeline"
            let isLoggedIn = payload["isLoggedIn"] as? Bool ?? true
            DispatchQueue.main.async {
                self.isTabBarLoggedIn = isLoggedIn
                self.refreshTabBarVisibility()
                if let idx = self.tabKeys.firstIndex(of: tab), idx != self.selectedIndex {
                    let targetVC = self.tabVCs[idx]
                    self.attachWebView(to: targetVC)
                    self.selectedIndex = idx
                }
            }

        case "SET_TAB_BAR_HIDDEN":
            let hidden = payload["hidden"] as? Bool ?? false
            DispatchQueue.main.async {
                self.isTabBarForceHidden = hidden
                self.refreshTabBarVisibility()
            }

        case "SHOW_LOCAL_NOTIFICATION":
            let id = payload["id"] as? String ?? "notif_\(Date().timeIntervalSince1970)"
            let title = payload["title"] as? String ?? "WithFit"
            let body = payload["body"] as? String ?? ""
            let dataDict = payload["data"] as? [String: Any] ?? [:]
            let nType = dataDict["type"] as? String ?? "general"
            let postId = dataDict["postId"] as? String ?? ""
            NativeAudioAndTimerManager.shared.showLocalNotification(id: id, title: title, body: body, type: nType, postId: postId)

        case "REQUEST_PUSH_PERMISSION":
            requestNativeNotificationPermission()

        case "CHECK_PUSH_PERMISSION":
            syncNotificationPermissionStatus()

        case "REQUEST_PUSH_TOKEN":
            syncNotificationPermissionStatus()
            if let savedToken = UserDefaults.standard.string(forKey: "withfit_apns_device_token") {
                sendPushTokenToWeb(token: savedToken)
            } else {
                sendPushTokenToWeb(token: "ios_native_local_notification_enabled")
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }

        case "SET_THEME":
            let theme = payload["theme"] as? String ?? "light"
            applyNativeTheme(theme)

        case "COPY_TO_CLIPBOARD":
            if let text = payload["text"] as? String {
                UIPasteboard.general.string = text
            }

        case "SAVE_LOCAL_DB":
            if let userId = payload["userId"] as? String,
               let dataStr = payload["data"] as? String {
                Self.saveNativeLocalDBJSON(userId: userId, jsonString: dataStr)
            }

        default:
            break
        }
    }

    private func updateRecordTabTrainingState(isTraining: Bool) {
        DispatchQueue.main.async {
            guard self.tabVCs.count > 2 else { return }
            let recordItem = self.tabVCs[2].tabBarItem
            if isTraining {
                recordItem?.title = "記録中"
                recordItem?.image = UIImage(systemName: "timer")
                recordItem?.selectedImage = UIImage(systemName: "timer")
                recordItem?.badgeValue = "●"
                recordItem?.badgeColor = UIColor.systemOrange
            } else {
                recordItem?.title = "記録"
                recordItem?.image = UIImage(systemName: "plus.circle")
                recordItem?.selectedImage = UIImage(systemName: "plus.circle.fill")
                recordItem?.badgeValue = nil
            }
        }
    }

    // MARK: - Swift -> React Messaging
    // 共有シートを最前面の画面から表示する
    private func presentShareSheet(image: UIImage) {
        let avc = UIActivityViewController(activityItems: [image], applicationActivities: nil)
        avc.popoverPresentationController?.sourceView = self.view
        avc.popoverPresentationController?.sourceRect = CGRect(x: self.view.bounds.midX, y: self.view.bounds.midY, width: 0, height: 0)
        var topVC: UIViewController = self
        while let presented = topVC.presentedViewController { topVC = presented }
        topVC.present(avc, animated: true)
    }

    func sendToWeb(payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let jsonStr = String(data: data, encoding: .utf8) else { return }
        let js = "window.postMessage(\(jsonStr), '*');"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    func sendPushTokenToWeb(token: String) {
        sendToWeb(payload: [
            "type": "PUSH_TOKEN",
            "token": token
        ])
    }


    func sendNotificationClickToWeb(type: String, postId: String) {
        sendToWeb(payload: [
            "type": "NOTIFICATION_CLICK",
            "data": [
                "type": type,
                "postId": postId
            ]
        ])
    }

    private func requestNativeNotificationPermissionIfNeeded() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            if settings.authorizationStatus == .notDetermined {
                self?.requestNativeNotificationPermission()
            } else {
                self?.syncNotificationPermissionStatus()
            }
        }
    }

    func requestNativeNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { [weak self] granted, _ in
            let status = granted ? "granted" : "denied"
            DispatchQueue.main.async {
                self?.webView?.evaluateJavaScript("window.__WITHFIT_OS_PERMISSION__ = '\(status)';", completionHandler: nil)
            }
            self?.sendToWeb(payload: [
                "type": "PUSH_PERMISSION_STATUS",
                "status": status
            ])
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
                let fallbackToken = UserDefaults.standard.string(forKey: "withfit_apns_device_token") ?? "ios_native_local_notification_enabled"
                self?.sendPushTokenToWeb(token: fallbackToken)
            }
        }
    }

    func syncNotificationPermissionStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            let status: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                status = "granted"
            case .denied:
                status = "denied"
            default:
                status = "default"
            }
            DispatchQueue.main.async {
                self?.webView?.evaluateJavaScript("window.__WITHFIT_OS_PERMISSION__ = '\(status)';", completionHandler: nil)
            }
            self?.sendToWeb(payload: [
                "type": "PUSH_PERMISSION_STATUS",
                "status": status
            ])
            if status == "granted" {
                let fallbackToken = UserDefaults.standard.string(forKey: "withfit_apns_device_token") ?? "ios_native_local_notification_enabled"
                self?.sendPushTokenToWeb(token: fallbackToken)
            }
        }
    }

    private func applyNativeTheme(_ theme: String) {
        DispatchQueue.main.async {
            switch theme {
            case "dark", "mono":
                self.statusBarBackgroundView.backgroundColor = UIColor(red: 30/255, green: 41/255, blue: 59/255, alpha: 1.0)
                self.view.backgroundColor = UIColor(red: 15/255, green: 23/255, blue: 42/255, alpha: 1.0)
                self.currentStatusBarStyle = .lightContent
                self.overrideUserInterfaceStyle = .dark
                self.tabBar.tintColor = UIColor(red: 52/255, green: 211/255, blue: 153/255, alpha: 1.0)
            case "ocean":
                self.statusBarBackgroundView.backgroundColor = UIColor(red: 3/255, green: 42/255, blue: 74/255, alpha: 1.0)
                self.view.backgroundColor = UIColor(red: 2/255, green: 21/255, blue: 38/255, alpha: 1.0)
                self.currentStatusBarStyle = .lightContent
                self.overrideUserInterfaceStyle = .dark
                self.tabBar.tintColor = UIColor(red: 56/255, green: 189/255, blue: 248/255, alpha: 1.0)
            case "pop":
                self.statusBarBackgroundView.backgroundColor = .white
                self.view.backgroundColor = UIColor(red: 254/255, green: 249/255, blue: 195/255, alpha: 1.0)
                self.currentStatusBarStyle = .darkContent
                self.overrideUserInterfaceStyle = .light
                self.tabBar.tintColor = UIColor(red: 236/255, green: 72/255, blue: 153/255, alpha: 1.0)
            default:
                self.statusBarBackgroundView.backgroundColor = .white
                self.view.backgroundColor = UIColor(red: 248/255, green: 250/255, blue: 252/255, alpha: 1.0)
                self.currentStatusBarStyle = .darkContent
                self.overrideUserInterfaceStyle = .light
                self.tabBar.tintColor = UIColor(red: 0/255, green: 112/255, blue: 192/255, alpha: 1.0)
            }
            self.setNeedsStatusBarAppearanceUpdate()
        }
    }

    // MARK: - WKUIDelegate
    // WebView 内コンテンツ（自前バンドル）からのカメラ/マイク取得はアプリ側で許可する。
    // これにより getUserMedia の許可ダイアログが毎回出る問題を防ぐ
    // （OSレベルのカメラ許可は初回のみ iOS が表示し、以降は設定に保持される）。
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        let host = origin.host.lowercased()
        if host == "localhost" || host == "127.0.0.1" {
            decisionHandler(.grant)
        } else {
            decisionHandler(.deny)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        NativeAudioAndTimerManager.shared.triggerHaptic(style: "light")
        let alert = UIAlertController(title: "WithFit", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler()
        })
        presentTopAlert(alert)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        NativeAudioAndTimerManager.shared.triggerHaptic(style: "medium")
        let alert = UIAlertController(title: "WithFit", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in
            completionHandler(false)
        })
        let isDestructive = message.contains("削除") || message.contains("破棄") || message.contains("退会") || message.contains("解除")
        alert.addAction(UIAlertAction(title: "OK", style: isDestructive ? .destructive : .default) { _ in
            completionHandler(true)
        })
        presentTopAlert(alert)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: "WithFit", message: prompt, preferredStyle: .alert)
        alert.addTextField { tf in
            tf.text = defaultText
        }
        alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in
            completionHandler(nil)
        })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        presentTopAlert(alert)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let targetURL = navigationAction.request.url,
           let host = targetURL.host?.lowercased(),
           !host.contains("google") && !host.contains("firebase") && !host.contains("localhost") {
            UIApplication.shared.open(targetURL, options: [:], completionHandler: nil)
            return nil
        }

        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.uiDelegate = self
        popup.navigationDelegate = self
        popup.customUserAgent = webView.customUserAgent
        self.popupWebView = popup

        let vc = UIViewController()
        vc.view = popup
        vc.navigationItem.title = "Google アカウント連携"
        vc.navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "閉じる",
            style: .done,
            target: self,
            action: #selector(closePopupWebView)
        )

        let nav = UINavigationController(rootViewController: vc)
        nav.modalPresentationStyle = .pageSheet
        self.popupNavController = nav
        present(nav, animated: true, completion: nil)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        if webView == popupWebView {
            closePopupWebView()
        }
    }

    @objc private func closePopupWebView() {
        popupNavController?.dismiss(animated: true, completion: nil)
        popupNavController = nil
        popupWebView = nil
    }

    private func presentTopAlert(_ alert: UIAlertController) {
        var topVC: UIViewController = self
        while let presented = topVC.presentedViewController {
            topVC = presented
        }
        topVC.present(alert, animated: true, completion: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        syncNotificationPermissionStatus()
    }

    // MARK: - iOS Native File Persistence for Local DB (Documents/withfit_local_db.json)
    private static var nativeDBFileURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("withfit_local_db.json")
    }

    private static func loadNativeLocalDBJSON() -> String {
        guard let data = try? Data(contentsOf: nativeDBFileURL),
              let str = String(data: data, encoding: .utf8),
              !str.isEmpty else {
            return "{}"
        }
        return str
    }

    private static func saveNativeLocalDBJSON(userId: String, jsonString: String) {
        DispatchQueue.global(qos: .utility).async {
            var rootDict: [String: Any] = [:]
            if let existingData = try? Data(contentsOf: nativeDBFileURL),
               let parsed = try? JSONSerialization.jsonObject(with: existingData) as? [String: Any] {
                rootDict = parsed
            }
            if let userData = jsonString.data(using: .utf8),
               let userObj = try? JSONSerialization.jsonObject(with: userData) {
                rootDict[userId] = userObj
                if let outData = try? JSONSerialization.data(withJSONObject: rootDict) {
                    try? outData.write(to: nativeDBFileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    var dbURL = nativeDBFileURL
                    var resourceValues = URLResourceValues()
                    resourceValues.isExcludedFromBackup = true
                    try? dbURL.setResourceValues(resourceValues)
                }
            }
        }
    }
}


// MARK: - Sign in with Apple
extension MainViewController: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private func startAppleSignIn() {
        let nonce = UUID().uuidString
        appleSignInNonce = nonce
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = sha256(nonce)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    private func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return view.window ?? ASPresentationAnchor()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            sendToWeb(payload: ["type": "APPLE_SIGN_IN_RESULT", "error": "invalid_credential"])
            return
        }
        var payload: [String: Any] = [
            "type": "APPLE_SIGN_IN_RESULT",
            "identityToken": token,
            "appleUserId": credential.user,
            "nonce": appleSignInNonce ?? ""
        ]
        if let name = credential.fullName {
            let full = [name.familyName, name.givenName].compactMap { $0 }.joined(separator: "")
            if !full.isEmpty { payload["fullName"] = full }
        }
        if let email = credential.email { payload["email"] = email }
        sendToWeb(payload: payload)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        sendToWeb(payload: ["type": "APPLE_SIGN_IN_RESULT", "error": "cancelled_or_failed"])
    }
}

// MARK: - Share Camera (ネイティブのライブカメラ: コラージュを重ねたまま撮影する)
final class ShareCameraViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
    var overlayImage: UIImage?
    var onCapturedImage: ((UIImage) -> Void)?
    var onCancelled: (() -> Void)?
    var onError: ((String) -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "withfit.share.camera.session")
    // シャッター音を鳴らさないため、静止画撮影ではなく映像フレームから切り出す方式を使う
    private let videoOutput = AVCaptureVideoDataOutput()
    private let ciContext = CIContext()
    private var captureRequested = false
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var currentInput: AVCaptureDeviceInput?
    private var currentDevice: AVCaptureDevice?
    private var currentPosition: AVCaptureDevice.Position = .back
    private var finished = false

    private let stageView = UIView()
    private let overlayView = UIImageView()
    private let focusIndicator = UIView()
    private var shutterButton: UIButton!
    private var flipButton: UIButton!
    private var backButton: UIButton!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildUI()
        NotificationCenter.default.addObserver(self, selector: #selector(subjectAreaChanged), name: .AVCaptureDeviceSubjectAreaDidChange, object: nil)
        checkPermissionAndStart()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutStage()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isBeingDismissed && !finished {
            finished = true
            stopSession()
            onCancelled?()
        }
    }

    private func buildUI() {
        stageView.backgroundColor = .black
        stageView.clipsToBounds = true
        stageView.layer.cornerRadius = 16
        view.addSubview(stageView)
        overlayView.image = overlayImage
        overlayView.contentMode = .scaleToFill
        overlayView.isUserInteractionEnabled = false
        stageView.addSubview(overlayView)

        // タップでピント・露出を合わせるためのフォーカス枠
        focusIndicator.layer.borderColor = UIColor.systemYellow.cgColor
        focusIndicator.layer.borderWidth = 1.5
        focusIndicator.layer.cornerRadius = 6
        focusIndicator.alpha = 0
        focusIndicator.isUserInteractionEnabled = false
        stageView.addSubview(focusIndicator)
        let tap = UITapGestureRecognizer(target: self, action: #selector(focusTapped(_:)))
        stageView.addGestureRecognizer(tap)

        backButton = makeBarButton(title: "‹ 戻る", action: #selector(cancelTapped))
        flipButton = makeBarButton(title: "切替", action: #selector(flipTapped))
        view.addSubview(backButton)
        view.addSubview(flipButton)

        shutterButton = UIButton(type: .custom)
        shutterButton.backgroundColor = UIColor.white.withAlphaComponent(0.25)
        shutterButton.layer.cornerRadius = 36
        shutterButton.layer.borderWidth = 4
        shutterButton.layer.borderColor = UIColor.white.cgColor
        let inner = UIView(frame: CGRect(x: 9, y: 9, width: 54, height: 54))
        inner.backgroundColor = .white
        inner.layer.cornerRadius = 27
        inner.isUserInteractionEnabled = false
        shutterButton.addSubview(inner)
        shutterButton.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
        view.addSubview(shutterButton)
    }

    private func makeBarButton(title: String, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = .boldSystemFont(ofSize: 15)
        b.backgroundColor = UIColor.white.withAlphaComponent(0.12)
        b.layer.cornerRadius = 18
        b.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
        b.sizeToFit()
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func layoutStage() {
        let bounds = view.bounds
        let safeBottom = view.safeAreaInsets.bottom
        let controlsH: CGFloat = 120 + safeBottom
        let availH = bounds.height - controlsH - 64
        let stageW = max(200, min(bounds.width - 24, availH * 9 / 16, 430))
        let stageH = stageW * 16 / 9
        let stageY = max(48, (bounds.height - controlsH - stageH) / 2 + 24)
        stageView.frame = CGRect(x: (bounds.width - stageW) / 2, y: stageY, width: stageW, height: stageH)
        previewLayer?.frame = stageView.bounds
        overlayView.frame = stageView.bounds
        let barY = bounds.height - safeBottom - 92
        backButton.frame = CGRect(x: 20, y: barY + 14, width: 86, height: 40)
        flipButton.frame = CGRect(x: bounds.width - 106, y: barY + 14, width: 86, height: 40)
        shutterButton.frame = CGRect(x: bounds.width / 2 - 36, y: barY, width: 72, height: 72)
    }

    private func checkPermissionAndStart() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureAndStart()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    if granted {
                        self.configureAndStart()
                    } else {
                        self.finishWithError("カメラの許可がありません。設定アプリで WithFit のカメラを許可してください。")
                    }
                }
            }
        default:
            finishWithError("カメラの許可がありません。設定アプリで WithFit のカメラを許可してください。")
        }
    }

    private func camera(for position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera],
            mediaType: .video,
            position: position
        )
        return discovery.devices.first
    }

    // 映像フレーム用に、できるだけ高解像度（4K優先）のフォーマットを選ぶ
    private func applyBestFormat(to device: AVCaptureDevice) {
        let format = device.formats.filter { fmt in
            let dims = CMVideoFormatDescriptionGetDimensions(fmt.formatDescription)
            return dims.height >= 2160 && fmt.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 30 }
        }.max { a, b in
            CMVideoFormatDescriptionGetDimensions(a.formatDescription).width < CMVideoFormatDescriptionGetDimensions(b.formatDescription).width
        }
        guard let format = format else { return }
        do {
            try device.lockForConfiguration()
            device.activeFormat = format
            device.unlockForConfiguration()
        } catch { }
    }

    private func configureAndStart() {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            self.session.beginConfiguration()
            self.session.sessionPreset = .inputPriority
            guard let device = self.camera(for: .back),
                  let input = try? AVCaptureDeviceInput(device: device),
                  self.session.canAddInput(input) else {
                self.session.commitConfiguration()
                DispatchQueue.main.async { self.finishWithError("カメラを初期化できませんでした。") }
                return
            }
            self.applyBestFormat(to: device)
            self.session.addInput(input)
            self.currentInput = input
            self.currentDevice = device
            self.currentPosition = .back
            self.videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            self.videoOutput.alwaysDiscardsLateVideoFrames = true
            self.videoOutput.setSampleBufferDelegate(self, queue: self.sessionQueue)
            if self.session.canAddOutput(self.videoOutput) {
                self.session.addOutput(self.videoOutput)
            }
            self.session.commitConfiguration()
            DispatchQueue.main.async {
                let layer = AVCaptureVideoPreviewLayer(session: self.session)
                layer.videoGravity = .resizeAspectFill
                self.stageView.layer.insertSublayer(layer, at: 0)
                self.previewLayer = layer
                self.layoutStage()
                self.applyOrientationAndMirroring()
            }
            self.session.startRunning()
        }
    }

    private func setPortrait(_ conn: AVCaptureConnection) {
        if #available(iOS 17.0, *) {
            if conn.isVideoRotationAngleSupported(90) {
                conn.videoRotationAngle = 90
            }
        } else if conn.isVideoOrientationSupported {
            conn.videoOrientation = .portrait
        }
    }

    private func applyOrientationAndMirroring() {
        let mirrored = (currentPosition == .front)
        if let conn = previewLayer?.connection {
            setPortrait(conn)
            if conn.isVideoMirroringSupported {
                conn.automaticallyAdjustsVideoMirroring = false
                conn.isVideoMirrored = mirrored
            }
        }
    }

    @objc private func flipTapped() {
        let target: AVCaptureDevice.Position = (currentPosition == .back) ? .front : .back
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            guard let device = self.camera(for: target),
                  let newInput = try? AVCaptureDeviceInput(device: device) else { return }
            self.session.beginConfiguration()
            if let current = self.currentInput {
                self.session.removeInput(current)
            }
            if self.session.canAddInput(newInput) {
                self.session.addInput(newInput)
                self.currentInput = newInput
                self.currentDevice = device
                self.currentPosition = target
                self.applyBestFormat(to: device)
            } else if let current = self.currentInput {
                self.session.addInput(current)
            }
            self.session.commitConfiguration()
            DispatchQueue.main.async {
                self.applyOrientationAndMirroring()
                self.resetFocusToContinuous()
            }
        }
    }

    // MARK: タップでピント・露出合わせ
    @objc private func focusTapped(_ gesture: UITapGestureRecognizer) {
        guard let layer = previewLayer, let device = currentDevice else { return }
        let point = gesture.location(in: stageView)
        let devicePoint = layer.captureDevicePointConverted(fromLayerPoint: point)
        do {
            try device.lockForConfiguration()
            if device.isFocusPointOfInterestSupported {
                device.focusPointOfInterest = devicePoint
                if device.isFocusModeSupported(.autoFocus) {
                    device.focusMode = .autoFocus
                }
            }
            if device.isExposurePointOfInterestSupported {
                device.exposurePointOfInterest = devicePoint
                if device.isExposureModeSupported(.autoExpose) {
                    device.exposureMode = .autoExpose
                }
            }
            device.isSubjectAreaChangeMonitoringEnabled = true
            device.unlockForConfiguration()
        } catch { }
        showFocusIndicator(at: point)
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func resetFocusToContinuous() {
        guard let device = currentDevice else { return }
        do {
            try device.lockForConfiguration()
            if device.isFocusPointOfInterestSupported {
                device.focusPointOfInterest = CGPoint(x: 0.5, y: 0.5)
            }
            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            }
            if device.isExposurePointOfInterestSupported {
                device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
            }
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            device.unlockForConfiguration()
        } catch { }
    }

    @objc private func subjectAreaChanged() {
        resetFocusToContinuous()
    }

    private func showFocusIndicator(at point: CGPoint) {
        focusIndicator.frame = CGRect(x: point.x - 34, y: point.y - 34, width: 68, height: 68)
        focusIndicator.alpha = 1
        focusIndicator.transform = CGAffineTransform(scaleX: 1.3, y: 1.3)
        UIView.animate(withDuration: 0.18, animations: {
            self.focusIndicator.transform = .identity
        }) { _ in
            UIView.animate(withDuration: 0.3, delay: 0.6, options: [], animations: {
                self.focusIndicator.alpha = 0
            })
        }
    }

    @objc private func shutterTapped() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        // 次に届く映像フレームを撮影する（シャッター音は鳴らない）
        sessionQueue.async { [weak self] in
            self?.captureRequested = true
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard captureRequested else { return }
        captureRequested = false
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        var ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        ciImage = ciImage.oriented(currentPosition == .front ? .leftMirrored : .right)
        let origin = ciImage.extent.origin
        if origin.x != 0 || origin.y != 0 {
            ciImage = ciImage.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
        }
        let w = ciImage.extent.width
        let h = ciImage.extent.height
        guard w > 0, h > 0 else { return }
        // 1080x1920（9:16）に cover で切り抜く
        let scale = max(1080 / w, 1920 / h)
        let scaled = ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let cropRect = CGRect(x: (w * scale - 1080) / 2, y: (h * scale - 1920) / 2, width: 1080, height: 1920)
        guard let cgImage = ciContext.createCGImage(scaled, from: cropRect) else { return }
        let image = UIImage(cgImage: cgImage, scale: 1, orientation: .up)
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.finished else { return }
            self.finished = true
            self.stopSession()
            self.dismiss(animated: true) { self.onCapturedImage?(image) }
        }
    }

    @objc private func cancelTapped() {
        guard !finished else { return }
        finished = true
        stopSession()
        dismiss(animated: true) { self.onCancelled?() }
    }

    private func finishWithError(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.finished else { return }
            self.finished = true
            self.stopSession()
            self.dismiss(animated: true) { self.onError?(message) }
        }
    }

    private func stopSession() {
        sessionQueue.async { [weak self] in
            if self?.session.isRunning == true {
                self?.session.stopRunning()
            }
        }
    }
}

// MARK: - Share Editor (シェア画像の編集画面: 全面Swift)
// 写真の選択・撮影・位置調整・合成・保存・共有をすべてネイティブで行う。
// 記録部分の描画は Web 側で作った透明PNG（overlayImage）を重ねるだけ。
final class ShareEditorViewController: UIViewController, PHPickerViewControllerDelegate, UIGestureRecognizerDelegate {
    var overlayImage: UIImage?
    var autoOpen: String = "none"

    private var photo: UIImage?
    private var viewS: CGFloat = 1
    private var viewX: CGFloat = 0
    private var viewY: CGFloat = 0

    private let stageView = UIView()
    private let photoView = UIImageView()
    private let overlayView = UIImageView()
    private let emptyIcon = UIImageView()
    private let emptyLabel = UILabel()
    private let hintLabel = UILabel()
    private var closeButton: UIButton!
    private var titleLabel: UILabel!
    private var cameraSourceButton: UIButton!
    private var albumSourceButton: UIButton!
    private var actionBar: UIVisualEffectView!
    private var changeButton: UIButton!
    private var retakeButton: UIButton!
    private var saveButton: UIButton!
    private var shareButton: UIButton!

    private let edgeFeedback = UISelectionFeedbackGenerator()
    private var edgeState = (x: false, y: false, sMax: false, fit: true)
    private var lastHapticAt: TimeInterval = 0
    private var didAutoOpen = false
    private var saving = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildUI()
        updateBars()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutAll()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !didAutoOpen {
            didAutoOpen = true
            if autoOpen == "camera" {
                openCamera()
            } else if autoOpen == "album" {
                openPicker()
            }
        }
    }

    // MARK: UI構築
    private func buildUI() {
        // ヘッダー
        titleLabel = UILabel()
        titleLabel.text = "シェア画像を作成"
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 16, weight: .bold)
        titleLabel.textAlignment = .center
        view.addSubview(titleLabel)

        var closeConfig = UIButton.Configuration.filled()
        closeConfig.image = UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .bold))
        closeConfig.cornerStyle = .capsule
        closeConfig.baseBackgroundColor = UIColor.white.withAlphaComponent(0.12)
        closeConfig.baseForegroundColor = .white
        closeButton = UIButton(configuration: closeConfig)
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(closeButton)

        // ステージ
        stageView.backgroundColor = UIColor.white.withAlphaComponent(0.06)
        stageView.clipsToBounds = true
        stageView.layer.cornerRadius = 20
        stageView.layer.borderWidth = 1
        stageView.layer.borderColor = UIColor.white.withAlphaComponent(0.08).cgColor
        view.addSubview(stageView)

        photoView.contentMode = .scaleToFill
        photoView.isUserInteractionEnabled = false
        photoView.isHidden = true
        stageView.addSubview(photoView)

        overlayView.image = overlayImage
        overlayView.contentMode = .scaleToFill
        overlayView.isUserInteractionEnabled = false
        stageView.addSubview(overlayView)

        emptyIcon.image = UIImage(systemName: "photo.on.rectangle.angled", withConfiguration: UIImage.SymbolConfiguration(pointSize: 52, weight: .light))
        emptyIcon.tintColor = UIColor.white.withAlphaComponent(0.25)
        emptyIcon.contentMode = .center
        stageView.addSubview(emptyIcon)
        emptyLabel.text = "まずは写真を選んでください"
        emptyLabel.textColor = UIColor.white.withAlphaComponent(0.5)
        emptyLabel.font = .systemFont(ofSize: 13, weight: .medium)
        emptyLabel.textAlignment = .center
        stageView.addSubview(emptyLabel)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.delegate = self
        stageView.addGestureRecognizer(pan)
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        pinch.delegate = self
        stageView.addGestureRecognizer(pinch)

        hintLabel.textColor = UIColor.white.withAlphaComponent(0.55)
        hintLabel.font = .systemFont(ofSize: 12)
        hintLabel.textAlignment = .center
        view.addSubview(hintLabel)

        // 写真が無いときの入口ボタン
        cameraSourceButton = makeSourceButton(symbol: "camera.fill", title: "写真を撮影", filled: true, action: #selector(openCameraTapped))
        albumSourceButton = makeSourceButton(symbol: "photo.on.rectangle", title: "アルバムから選ぶ", filled: false, action: #selector(openPickerTapped))
        view.addSubview(cameraSourceButton)
        view.addSubview(albumSourceButton)

        // 写真があるときの下部ツールバー
        actionBar = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        changeButton = makeToolButton(symbol: "photo.on.rectangle", title: "写真を変更", action: #selector(openPickerTapped))
        retakeButton = makeToolButton(symbol: "camera", title: "撮り直す", action: #selector(openCameraTapped))
        saveButton = makeToolButton(symbol: "square.and.arrow.down", title: "保存", action: #selector(saveTapped))
        shareButton = makeToolButton(symbol: "square.and.arrow.up", title: "共有する", action: #selector(shareTapped), emphasized: true)
        actionBar.contentView.addSubview(changeButton)
        actionBar.contentView.addSubview(retakeButton)
        actionBar.contentView.addSubview(saveButton)
        actionBar.contentView.addSubview(shareButton)
        view.addSubview(actionBar)
    }

    private func makeSourceButton(symbol: String, title: String, filled: Bool, action: Selector) -> UIButton {
        var config = UIButton.Configuration.filled()
        config.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .bold))
        config.title = title
        config.imagePadding = 8
        config.cornerStyle = .medium
        config.baseBackgroundColor = filled ? .systemBlue : UIColor.white.withAlphaComponent(0.14)
        config.baseForegroundColor = .white
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = .systemFont(ofSize: 15, weight: .bold)
            return outgoing
        }
        let b = UIButton(configuration: config)
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func makeToolButton(symbol: String, title: String, action: Selector, emphasized: Bool = false) -> UIButton {
        var config = UIButton.Configuration.plain()
        config.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 21, weight: .semibold))
        config.title = title
        config.imagePlacement = .top
        config.imagePadding = 4
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = .systemFont(ofSize: 11, weight: .semibold)
            return outgoing
        }
        let b = UIButton(configuration: config)
        b.tintColor = emphasized ? .systemBlue : .white
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func layoutAll() {
        let bounds = view.bounds
        let safeTop = view.safeAreaInsets.top
        let safeBottom = view.safeAreaInsets.bottom
        let topH = safeTop + 60
        let bottomH = safeBottom + 118
        let availH = bounds.height - topH - bottomH
        let stageW = max(200, min(bounds.width - 32, availH * 9 / 16, 430))
        let stageH = stageW * 16 / 9
        let stageX = (bounds.width - stageW) / 2
        let stageY = topH + max(0, (availH - stageH) / 2)
        stageView.frame = CGRect(x: stageX, y: stageY, width: stageW, height: stageH)
        overlayView.frame = stageView.bounds
        emptyIcon.frame = CGRect(x: (stageW - 72) / 2, y: stageH / 2 - 62, width: 72, height: 56)
        emptyLabel.frame = CGRect(x: 16, y: stageH / 2 + 2, width: stageW - 32, height: 20)
        updatePhotoFrame()

        titleLabel.frame = CGRect(x: 64, y: safeTop + 10, width: bounds.width - 128, height: 38)
        closeButton.frame = CGRect(x: 16, y: safeTop + 10, width: 38, height: 38)

        hintLabel.frame = CGRect(x: 16, y: stageY + stageH + 10, width: bounds.width - 32, height: 18)

        let barY = bounds.height - safeBottom - 60
        let halfW = (stageW - 10) / 2
        cameraSourceButton.frame = CGRect(x: stageX, y: barY, width: halfW, height: 52)
        albumSourceButton.frame = CGRect(x: stageX + halfW + 10, y: barY, width: halfW, height: 52)

        let actionH: CGFloat = 74 + safeBottom
        actionBar.frame = CGRect(x: 0, y: bounds.height - actionH, width: bounds.width, height: actionH)
        let itemW = bounds.width / 4
        changeButton.frame = CGRect(x: 0, y: 4, width: itemW, height: 64)
        retakeButton.frame = CGRect(x: itemW, y: 4, width: itemW, height: 64)
        saveButton.frame = CGRect(x: itemW * 2, y: 4, width: itemW, height: 64)
        shareButton.frame = CGRect(x: itemW * 3, y: 4, width: itemW, height: 64)
    }

    private func updateBars() {
        let hasPhoto = photo != nil
        cameraSourceButton.isHidden = hasPhoto
        albumSourceButton.isHidden = hasPhoto
        actionBar.isHidden = !hasPhoto
        emptyIcon.isHidden = hasPhoto
        emptyLabel.isHidden = hasPhoto
        hintLabel.text = hasPhoto ? "ドラッグ・ピンチで写真の位置を調整できます" : ""
    }

    // MARK: 写真の位置調整（Canvas座標 1080x1920 で管理し、常に画面を覆う範囲に制限）
    private func clamped(s: CGFloat, x: CGFloat, y: CGFloat) -> (s: CGFloat, x: CGFloat, y: CGFloat, maxX: CGFloat, maxY: CGFloat) {
        guard let photo = photo else { return (1, 0, 0, 0, 0) }
        let iw = photo.size.width
        let ih = photo.size.height
        let base = max(1080 / iw, 1920 / ih)
        let cs = min(4, max(1, s))
        let dw = iw * base * cs
        let dh = ih * base * cs
        let maxX = max(0, (dw - 1080) / 2)
        let maxY = max(0, (dh - 1920) / 2)
        return (cs, min(maxX, max(-maxX, x)), min(maxY, max(-maxY, y)), maxX, maxY)
    }

    private func applyView(s: CGFloat, x: CGFloat, y: CGFloat) {
        let c = clamped(s: s, x: x, y: y)
        viewS = c.s
        viewX = c.x
        viewY = c.y
        updatePhotoFrame()
        let st = (
            x: c.maxX > 0 && abs(abs(c.x) - c.maxX) < 1,
            y: c.maxY > 0 && abs(abs(c.y) - c.maxY) < 1,
            sMax: c.s >= 4,
            fit: c.s == 1 && c.x == 0 && c.y == 0
        )
        let hitEdge = (st.x && !edgeState.x) || (st.y && !edgeState.y) || (st.sMax && !edgeState.sMax)
        let hitFit = st.fit && !edgeState.fit
        let now = Date().timeIntervalSince1970
        if (hitEdge || hitFit) && now - lastHapticAt > 0.09 {
            if hitFit {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } else {
                edgeFeedback.selectionChanged()
            }
            lastHapticAt = now
        }
        edgeState = st
    }

    private func updatePhotoFrame() {
        guard let photo = photo else { return }
        let iw = photo.size.width
        let ih = photo.size.height
        let base = max(1080 / iw, 1920 / ih)
        let dw = iw * base * viewS
        let dh = ih * base * viewS
        let k = stageView.bounds.width / 1080
        photoView.frame = CGRect(
            x: ((1080 - dw) / 2 + viewX) * k,
            y: ((1920 - dh) / 2 + viewY) * k,
            width: dw * k,
            height: dh * k
        )
    }

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        guard photo != nil, gesture.state == .changed else { return }
        let t = gesture.translation(in: stageView)
        gesture.setTranslation(.zero, in: stageView)
        let k = 1080 / max(1, stageView.bounds.width)
        applyView(s: viewS, x: viewX + t.x * k, y: viewY + t.y * k)
    }

    @objc private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
        guard photo != nil, gesture.state == .changed else { return }
        let ns = viewS * gesture.scale
        gesture.scale = 1
        applyView(s: ns, x: viewX, y: viewY)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        return true
    }

    // MARK: 写真の取り込み
    private func setPhoto(_ image: UIImage) {
        photo = image
        photoView.image = image
        photoView.isHidden = false
        edgeState = (x: false, y: false, sMax: false, fit: true)
        applyView(s: 1, x: 0, y: 0)
        updateBars()
    }

    @objc private func openCameraTapped() { openCamera() }
    @objc private func openPickerTapped() { openPicker() }

    private func openCamera() {
        let vc = ShareCameraViewController()
        vc.overlayImage = overlayImage
        vc.modalPresentationStyle = .fullScreen
        vc.onCapturedImage = { [weak self] image in
            self?.setPhoto(image)
        }
        vc.onError = { [weak self] message in
            self?.showNotice(message)
        }
        present(vc, animated: true)
    }

    private func openPicker() {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider,
              provider.canLoadObject(ofClass: UIImage.self) else { return }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            if let image = object as? UIImage {
                DispatchQueue.main.async { self?.setPhoto(image) }
            }
        }
    }

    // MARK: 合成・保存・共有
    private func renderFinal() -> UIImage? {
        guard let overlay = overlayImage else { return nil }
        let size = CGSize(width: 1080, height: 1920)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            UIColor.black.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            if let photo = photo {
                let iw = photo.size.width
                let ih = photo.size.height
                let base = max(1080 / iw, 1920 / ih)
                let dw = iw * base * viewS
                let dh = ih * base * viewS
                photo.draw(in: CGRect(x: (1080 - dw) / 2 + viewX, y: (1920 - dh) / 2 + viewY, width: dw, height: dh))
            }
            overlay.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    @objc private func shareTapped() {
        guard let image = renderFinal() else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let avc = UIActivityViewController(activityItems: [image], applicationActivities: nil)
        avc.popoverPresentationController?.sourceView = stageView
        avc.popoverPresentationController?.sourceRect = stageView.bounds
        present(avc, animated: true)
    }

    @objc private func saveTapped() {
        guard !saving, let image = renderFinal() else { return }
        saving = true
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] status in
            guard let self = self else { return }
            guard status == .authorized || status == .limited else {
                DispatchQueue.main.async {
                    self.saving = false
                    self.showNotice("保存できませんでした。設定アプリで写真への保存を許可してください。")
                }
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }) { success, _ in
                DispatchQueue.main.async {
                    self.saving = false
                    if success {
                        self.flashSaved()
                    } else {
                        self.showNotice("保存に失敗しました。")
                    }
                }
            }
        }
    }

    private func flashSaved() {
        var config = saveButton.configuration
        config?.title = "保存しました"
        config?.image = UIImage(systemName: "checkmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 21, weight: .bold))
        saveButton.configuration = config
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            guard let self = self else { return }
            var back = self.saveButton.configuration
            back?.title = "保存"
            back?.image = UIImage(systemName: "square.and.arrow.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 21, weight: .semibold))
            self.saveButton.configuration = back
        }
    }

    private func showNotice(_ message: String) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    @objc private func closeTapped() {
        dismiss(animated: true)
    }
}
