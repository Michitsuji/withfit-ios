import Foundation
import AVFoundation
import AudioToolbox
import UserNotifications
import UIKit

final class NativeAudioAndTimerManager {
    static let shared = NativeAudioAndTimerManager()

    private var keepAlivePlayer: AVAudioPlayer?
    private var alarmPlayer: AVAudioPlayer?
    private var vibrateTimer: Timer?
    private var isTrainingActive: Bool = false
    private var isRestTimerActive: Bool = false

    private let restTimerNotifId = "withfit_rest_timer"
    private let forgotTimerNotifId = "withfit_forgot_timer"

    private init() {}

    /// Spotify / Apple Music 等の他アプリの音楽再生を一切止めないオーディオセッション設定
    func configureAudioSession(duckOthers: Bool = false) {
        let session = AVAudioSession.sharedInstance()
        do {
            if duckOthers {
                try session.setCategory(.playback, mode: .default, options: [.duckOthers, .mixWithOthers])
            } else {
                try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            }
            try session.setActive(true)
        } catch {
            print("[WithFit Audio] AudioSession error: \(error.localizedDescription)")
        }
        startSilentKeepAliveIfNeeded()
    }

    // MARK: - Notification Permission Helper
    func ensureNotificationPermission(completion: @escaping (Bool) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                completion(true)
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                    MainViewController.shared?.syncNotificationPermissionStatus()
                    completion(granted)
                }
            default:
                completion(false)
            }
        }
    }

    // MARK: - Haptic Feedback (Taptic Engine)
    func triggerHaptic(style: String) {
        DispatchQueue.main.async {
            switch style {
            case "light":
                let gen = UIImpactFeedbackGenerator(style: .light)
                gen.prepare()
                gen.impactOccurred()
            case "medium":
                let gen = UIImpactFeedbackGenerator(style: .medium)
                gen.prepare()
                gen.impactOccurred()
            case "heavy":
                let gen = UIImpactFeedbackGenerator(style: .heavy)
                gen.prepare()
                gen.impactOccurred()
            case "selection":
                let gen = UISelectionFeedbackGenerator()
                gen.prepare()
                gen.selectionChanged()
            case "success":
                let gen = UINotificationFeedbackGenerator()
                gen.prepare()
                gen.notificationOccurred(.success)
            case "warning":
                let gen = UINotificationFeedbackGenerator()
                gen.prepare()
                gen.notificationOccurred(.warning)
            case "error":
                let gen = UINotificationFeedbackGenerator()
                gen.prepare()
                gen.notificationOccurred(.error)
            case "vibrate":
                AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
            default:
                let gen = UIImpactFeedbackGenerator(style: .light)
                gen.impactOccurred()
            }
        }
    }

    // MARK: - Background Keep-Alive (バックグラウンド・画面ロック中のリアルタイム通知＆タイマー維持)
    func setTrainingState(isTraining: Bool) {
        isTrainingActive = isTraining
        startSilentKeepAliveIfNeeded()
    }

    func startSilentKeepAliveIfNeeded() {
        if let player = keepAlivePlayer, player.isPlaying { return }
        guard let wavData = Self.makeSilentWavData(durationSeconds: 1) else { return }
        do {
            let player = try AVAudioPlayer(data: wavData)
            player.volume = 0.0
            player.numberOfLoops = -1
            player.prepareToPlay()
            player.play()
            self.keepAlivePlayer = player
        } catch {
            print("[WithFit Audio] Silent keep-alive error: \(error.localizedDescription)")
        }
    }

    /// 1秒間の無音PCM WAVデータをメモリ上で生成
    private static func makeSilentWavData(durationSeconds: Int) -> Data? {
        let sampleRate: UInt32 = 8000
        let numChannels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let numSamples = sampleRate * UInt32(durationSeconds)
        let dataSize = numSamples * UInt32(numChannels) * UInt32(bitsPerSample / 8)
        let chunkSize = 36 + dataSize

        var data = Data()
        data.append("RIFF".data(using: .ascii)!)
        data.append(withUnsafeBytes(of: chunkSize.littleEndian) { Data($0) })
        data.append("WAVE".data(using: .ascii)!)
        data.append("fmt ".data(using: .ascii)!)
        let subchunk1Size: UInt32 = 16
        let audioFormat: UInt16 = 1
        let byteRate = sampleRate * UInt32(numChannels) * UInt32(bitsPerSample / 8)
        let blockAlign = numChannels * (bitsPerSample / 8)
        data.append(withUnsafeBytes(of: subchunk1Size.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: audioFormat.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: numChannels.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: sampleRate.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: byteRate.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: blockAlign.littleEndian) { Data($0) })
        data.append(withUnsafeBytes(of: bitsPerSample.littleEndian) { Data($0) })
        data.append("data".data(using: .ascii)!)
        data.append(withUnsafeBytes(of: dataSize.littleEndian) { Data($0) })
        data.append(Data(count: Int(dataSize)))
        return data
    }

    // MARK: - Native Alarm Sound & Continuous Vibration
    func playNativeAlarm(volume: Float = 1.0) {
        DispatchQueue.main.async {
            self.stopAlarmSoundAndVibration()
            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
            let gen = UINotificationFeedbackGenerator()
            gen.notificationOccurred(.warning)

            self.vibrateTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { _ in
                AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
            }

            guard volume > 0.0 else { return }
            self.configureAudioSession(duckOthers: true)

            let alarmURL = Bundle.main.url(forResource: "alarm", withExtension: "mp3")
                ?? Bundle.main.resourceURL?.appendingPathComponent("WebBundle/alarm.mp3")

            if let url = alarmURL, FileManager.default.fileExists(atPath: url.path) {
                do {
                    let player = try AVAudioPlayer(contentsOf: url)
                    player.volume = min(1.0, max(0.0, volume))
                    player.numberOfLoops = -1
                    player.prepareToPlay()
                    player.play()
                    self.alarmPlayer = player
                } catch {
                    AudioServicesPlaySystemSound(1005)
                }
            } else {
                AudioServicesPlaySystemSound(1005)
            }
        }
    }

    func stopAlarmSoundAndVibration() {
        DispatchQueue.main.async {
            self.vibrateTimer?.invalidate()
            self.vibrateTimer = nil
            self.alarmPlayer?.stop()
            self.alarmPlayer = nil
            self.configureAudioSession(duckOthers: false)
        }
    }

    // MARK: - Interval Rest Timer (Native Notification + Alarm)
    func scheduleRestTimer(seconds: Int) {
        cancelRestTimer()
        guard seconds > 0 else { return }
        isRestTimerActive = true
        startSilentKeepAliveIfNeeded()

        ensureNotificationPermission { _ in
            let content = UNMutableNotificationContent()
            content.title = "⏰ インターバル終了！"
            content.body = "休憩時間が終了しました。次のセットに入りましょう！🔥"
            content.sound = .default
            content.userInfo = ["type": "joint"]
            if #available(iOS 15.0, *) {
                content.interruptionLevel = .active
            }

            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(max(1, seconds)), repeats: false)
            let request = UNNotificationRequest(identifier: self.restTimerNotifId, content: content, trigger: trigger)
            UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
        }
    }

    func cancelRestTimer() {
        isRestTimerActive = false
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [restTimerNotifId])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [restTimerNotifId])
        stopAlarmSoundAndVibration()
    }

    // MARK: - 30-Minute Workout Forgot Reminder
    func scheduleForgotTimer(seconds: Int) {
        cancelForgotTimer()
        let safeSeconds = max(60, seconds)
        ensureNotificationPermission { _ in
            let content = UNMutableNotificationContent()
            content.title = "⏳ 記録忘れはありませんか？"
            content.body = "最後の操作から30分以上経過しています。終了する場合は記録を保存してください。"
            content.sound = .default
            content.userInfo = ["type": "joint"]
            if #available(iOS 15.0, *) {
                content.interruptionLevel = .active
            }

            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(safeSeconds), repeats: false)
            let request = UNNotificationRequest(identifier: self.forgotTimerNotifId, content: content, trigger: trigger)
            UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
        }
    }

    func cancelForgotTimer() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [forgotTimerNotifId])
    }

    // MARK: - Immediate Local Banner Notification (trigger: nil で即時0秒発火・AltStore無料Apple ID完全対応)
    func showLocalNotification(id: String, title: String, body: String, type: String, postId: String) {
        ensureNotificationPermission { _ in
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            content.userInfo = [
                "type": type,
                "postId": postId
            ]
            if #available(iOS 15.0, *) {
                content.interruptionLevel = .active
            }
            // trigger: nil により iOS 純正の即時通知バナーとして確実に配信
            let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request) { error in
                if let error = error {
                    print("[WithFit Notification] Error: \(error.localizedDescription)")
                }
            }
        }
    }
}
