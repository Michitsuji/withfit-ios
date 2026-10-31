import Foundation
import AppIntents
import ActivityKit

// ==========================================
// RestTimerIntents.swift
// ロック画面の Live Activity 上のボタンからレストタイマーを操作する
// App Intent（iOS 17+ の対話型 Live Activity）。
// アプリ本体と Widget 拡張の両ターゲットでコンパイルされる共有ファイル。
//
// perform() はアプリのプロセスで実行される前提で、
// 1) Live Activity の表示状態を即時更新する
// 2) UserDefaults に上書き内容を書き、Darwin 通知でアプリ側へ知らせる
//    → アプリ側（NativeAudioAndTimerManager）がアラーム通知の
//      再スケジュールと記録画面（Web）への同期を行う
// ==========================================

@available(iOS 17.0, *)
enum RestTimerOverrideStore {
    static let endsAtKey = "withfit.restEndsAtOverride"
    static let activeKey = "withfit.restOverrideActive"
    static let darwinName = "com.michitsuji.withfit.restTimerOverrideChanged"

    static func save(endsAtMs: Double) {
        UserDefaults.standard.set(endsAtMs, forKey: endsAtKey)
        UserDefaults.standard.set(true, forKey: activeKey)
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(darwinName as CFString),
            nil, nil, true
        )
    }
}

/// 「+30秒」ボタン: レスト終了予定を30秒延ばす
@available(iOS 17.0, *)
struct ExtendRestTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "レストを30秒延長"
    static var isDiscoverable: Bool = false

    init() {}

    func perform() async throws -> some IntentResult {
        guard let activity = Activity<TrainingActivityAttributes>.activities.first(where: { $0.activityState == .active }) else {
            return .result()
        }
        let state = activity.content.state
        guard let endsAt = state.restEndsAt, !state.restRinging else { return .result() }

        let newEnd = endsAt.addingTimeInterval(30)
        var newState = state
        newState.restEndsAt = newEnd
        await activity.update(ActivityContent(state: newState, staleDate: nil))

        RestTimerOverrideStore.save(endsAtMs: newEnd.timeIntervalSince1970 * 1000)
        return .result()
    }
}

/// 「停止」ボタン: レストタイマーを止める（鳴動中のアラームも止まる）
@available(iOS 17.0, *)
struct StopRestTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "レストタイマーを停止"
    static var isDiscoverable: Bool = false

    init() {}

    func perform() async throws -> some IntentResult {
        if let activity = Activity<TrainingActivityAttributes>.activities.first(where: { $0.activityState == .active }) {
            var newState = activity.content.state
            newState.restStartedAt = nil
            newState.restEndsAt = nil
            newState.restRinging = false
            await activity.update(ActivityContent(state: newState, staleDate: nil))
        }
        RestTimerOverrideStore.save(endsAtMs: 0)
        return .result()
    }
}
