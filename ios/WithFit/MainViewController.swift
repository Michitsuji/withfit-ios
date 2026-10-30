import UIKit
import WebKit
import UserNotifications

final class MainViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {

    static weak var shared: MainViewController?

    private var webView: WKWebView!
    private var popupWebView: WKWebView?
    private var popupNavController: UINavigationController?
    private let statusBarBackgroundView = UIView()
    private var currentStatusBarStyle: UIStatusBarStyle = .darkContent

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return currentStatusBarStyle
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        Self.shared = self
        setupViews()
        loadWithFitApp()
    }

    private func setupViews() {
        view.backgroundColor = UIColor(red: 248/255, green: 250/255, blue: 252/255, alpha: 1.0)
        statusBarBackgroundView.backgroundColor = .white
        statusBarBackgroundView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusBarBackgroundView)

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
        window.WithFitNative = true;
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
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        // Safari互換User-Agentを設定してFirebase Google OAuthの403 disallowed_useragentを回避
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

        view.addSubview(webView)

        NSLayoutConstraint.activate([
            statusBarBackgroundView.topAnchor.constraint(equalTo: view.topAnchor),
            statusBarBackgroundView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            statusBarBackgroundView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            statusBarBackgroundView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),

            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        // 3本指ダブルタップでバックエンドAPI設定＆リロードメニューを開くネイティブジェスチャー
        let settingsGesture = UITapGestureRecognizer(target: self, action: #selector(showNativeDeveloperMenu))
        settingsGesture.numberOfTouchesRequired = 3
        settingsGesture.numberOfTapsRequired = 2
        view.addGestureRecognizer(settingsGesture)
    }

    private func loadWithFitApp() {
        LocalBundleServer.shared.start()
        let url = LocalBundleServer.shared.baseURL
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        webView.load(request)
    }

    // MARK: - WKScriptMessageHandler (React -> Swift Native Bridge)
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "WithFitNative" else { return }

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
        case "HAPTIC":
            let style = payload["style"] as? String ?? "light"
            NativeAudioAndTimerManager.shared.triggerHaptic(style: style)

        case "VIBRATE":
            NativeAudioAndTimerManager.shared.triggerHaptic(style: "vibrate")

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

        case "REQUEST_PUSH_TOKEN":
            syncNotificationPermissionStatus()
            if let savedToken = UserDefaults.standard.string(forKey: "withfit_apns_device_token") {
                sendPushTokenToWeb(token: savedToken)
            } else {
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

        case "SET_BACKEND_URL":
            if let urlStr = payload["url"] as? String {
                LocalBundleServer.shared.backendBaseURL = urlStr
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

    // MARK: - Swift -> React Messaging
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

    func requestNativeNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { [weak self] granted, _ in
            let status = granted ? "granted" : "denied"
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
            self?.sendToWeb(payload: [
                "type": "PUSH_PERMISSION_STATUS",
                "status": status
            ])
        }
    }

    private func applyNativeTheme(_ theme: String) {
        DispatchQueue.main.async {
            switch theme {
            case "dark", "mono":
                self.statusBarBackgroundView.backgroundColor = UIColor(red: 30/255, green: 41/255, blue: 59/255, alpha: 1.0) // #1e293b
                self.view.backgroundColor = UIColor(red: 15/255, green: 23/255, blue: 42/255, alpha: 1.0) // #0f172a
                self.currentStatusBarStyle = .lightContent
            case "ocean":
                self.statusBarBackgroundView.backgroundColor = UIColor(red: 3/255, green: 42/255, blue: 74/255, alpha: 1.0) // #032a4a
                self.view.backgroundColor = UIColor(red: 2/255, green: 21/255, blue: 38/255, alpha: 1.0) // #021526
                self.currentStatusBarStyle = .lightContent
            case "pop":
                self.statusBarBackgroundView.backgroundColor = .white
                self.view.backgroundColor = UIColor(red: 254/255, green: 249/255, blue: 195/255, alpha: 1.0) // #fef9c3
                self.currentStatusBarStyle = .darkContent
            default:
                self.statusBarBackgroundView.backgroundColor = .white
                self.view.backgroundColor = UIColor(red: 248/255, green: 250/255, blue: 252/255, alpha: 1.0) // #f8fafc
                self.currentStatusBarStyle = .darkContent
            }
            self.setNeedsStatusBarAppearanceUpdate()
        }
    }

    // MARK: - WKUIDelegate (Native iOS Alerts, Confirms, Prompts & OAuth Popup Sheet)
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

    // Firebase signInWithPopup (Google OAuth) 用のネイティブモーダルシート
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // 外部スポンサーリンク等はSafariで開く
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

    @objc private func showNativeDeveloperMenu() {
        NativeAudioAndTimerManager.shared.triggerHaptic(style: "medium")
        let sheet = UIAlertController(
            title: "WithFit iOS ネイティブ設定",
            message: "APIサーバーURL: \(LocalBundleServer.shared.backendBaseURL)",
            preferredStyle: .actionSheet
        )
        sheet.addAction(UIAlertAction(title: "画面を再読み込み", style: .default) { [weak self] _ in
            self?.webView.reload()
        })
        sheet.addAction(UIAlertAction(title: "APIサーバーURLを変更", style: .default) { [weak self] _ in
            self?.promptBackendURLChange()
        })
        sheet.addAction(UIAlertAction(title: "キャンセル", style: .cancel, handler: nil))
        presentTopAlert(sheet)
    }

    private func promptBackendURLChange() {
        let alert = UIAlertController(
            title: "APIサーバーURL設定",
            message: "プッシュ通知(/api/sendPush)用のバックエンドURLを入力してください",
            preferredStyle: .alert
        )
        alert.addTextField { tf in
            tf.text = LocalBundleServer.shared.backendBaseURL
            tf.placeholder = "https://withfit.vercel.app"
            tf.keyboardType = .URL
        }
        alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel, handler: nil))
        alert.addAction(UIAlertAction(title: "保存", style: .default) { _ in
            if let text = alert.textFields?.first?.text, !text.isEmpty {
                LocalBundleServer.shared.backendBaseURL = text
            }
        })
        presentTopAlert(alert)
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
                    try? outData.write(to: nativeDBFileURL, options: .atomic)
                }
            }
        }
    }
}
