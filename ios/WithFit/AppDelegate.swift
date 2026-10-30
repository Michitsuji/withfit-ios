import UIKit
import UserNotifications
import AVFoundation

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        NativeAudioAndTimerManager.shared.configureAudioSession()
        LocalBundleServer.shared.start()
        return true
    }

    // MARK: - UISceneSession Lifecycle
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

    // MARK: - APNs Remote Push Token Registration
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let tokenParts = deviceToken.map { data in String(format: "%02.2hhx", data) }
        let token = tokenParts.joined()
        UserDefaults.standard.set(token, forKey: "withfit_apns_device_token")
        MainViewController.shared?.sendPushTokenToWeb(token: token)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[WithFit iOS] Remote notification registration warning: \(error.localizedDescription)")
        // Local notifications still work even on free Apple ID sideloaded builds
        MainViewController.shared?.sendPushTokenToWeb(token: "ios_native_local_notification_enabled")
    }

    // MARK: - UNUserNotificationCenterDelegate (Foreground & Tap Handling)
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .list, .sound, .badge])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let notifType = userInfo["type"] as? String ?? "general"
        let postId = userInfo["postId"] as? String ?? ""
        MainViewController.shared?.sendNotificationClickToWeb(type: notifType, postId: postId)
        completionHandler()
    }
}
