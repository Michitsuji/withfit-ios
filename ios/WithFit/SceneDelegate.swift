import UIKit
import UserNotifications

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?
    private var backgroundTaskId: UIBackgroundTaskIdentifier = .invalid

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = (scene as? UIWindowScene) else { return }
        let window = UIWindow(windowScene: windowScene)
        let mainVC = MainViewController()
        window.rootViewController = mainVC
        self.window = window
        window.makeKeyAndVisible()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        UIApplication.shared.applicationIconBadgeNumber = 0
        if backgroundTaskId != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskId)
            backgroundTaskId = .invalid
        }
        NativeAudioAndTimerManager.shared.startSilentKeepAliveIfNeeded()
        MainViewController.shared?.syncNotificationPermissionStatus()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        NativeAudioAndTimerManager.shared.startSilentKeepAliveIfNeeded()
        backgroundTaskId = UIApplication.shared.beginBackgroundTask(withName: "WithFitRealtimeSync") { [weak self] in
            if let taskId = self?.backgroundTaskId, taskId != .invalid {
                UIApplication.shared.endBackgroundTask(taskId)
                self?.backgroundTaskId = .invalid
            }
        }
    }
}
