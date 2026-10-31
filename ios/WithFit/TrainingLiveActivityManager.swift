import Foundation
import ActivityKit

// ==========================================
// TrainingLiveActivityManager.swift
// トレーニング状態（Web→Swiftブリッジの SET_TRAINING_STATE）と
// Live Activity の開始・更新・終了を仲介するマネージャ。
// iOS 16.1 未満では何もしない（呼び出し側でも #available で保護する）。
// ==========================================

@available(iOS 16.1, *)
final class TrainingLiveActivityManager {
    static let shared = TrainingLiveActivityManager()

    private var activity: Activity<TrainingActivityAttributes>?
    private var currentStartTime: Date?
    private var lastState: TrainingActivityAttributes.ContentState?

    private init() {}

    private func makeState(exerciseName: String, exerciseIndex: Int, currentSet: Int, restStartedAt: Date?, restEndsAt: Date?, restRinging: Bool) -> TrainingActivityAttributes.ContentState {
        TrainingActivityAttributes.ContentState(
            exerciseName: exerciseName,
            exerciseIndex: exerciseIndex,
            currentSet: currentSet,
            restStartedAt: restStartedAt,
            restEndsAt: restEndsAt,
            restRinging: restRinging
        )
    }

    /// トレーニング開始時に呼ぶ。既に同じ開始時刻の Activity があれば更新に回す
    func start(startTime: Date, gymName: String, exerciseName: String, exerciseIndex: Int, currentSet: Int, restStartedAt: Date?, restEndsAt: Date?, restRinging: Bool) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            print("[WithFit LiveActivity] Live Activities are not enabled")
            return
        }
        if let _ = activity, currentStartTime == startTime {
            update(exerciseName: exerciseName, exerciseIndex: exerciseIndex, currentSet: currentSet, restStartedAt: restStartedAt, restEndsAt: restEndsAt, restRinging: restRinging)
            return
        }
        // 開始時刻が違う古い Activity が残っていたら終了してから作り直す
        end(dismissNow: true)

        let attributes = TrainingActivityAttributes(gymName: gymName, startTime: startTime)
        let initialState = makeState(exerciseName: exerciseName, exerciseIndex: exerciseIndex, currentSet: currentSet, restStartedAt: restStartedAt, restEndsAt: restEndsAt, restRinging: restRinging)
        do {
            if #available(iOS 16.2, *) {
                activity = try Activity.request(
                    attributes: attributes,
                    content: ActivityContent(state: initialState, staleDate: nil)
                )
            } else {
                activity = try Activity.request(
                    attributes: attributes,
                    contentState: initialState
                )
            }
            currentStartTime = startTime
            lastState = initialState
        } catch {
            print("[WithFit LiveActivity] Failed to start: \(error.localizedDescription)")
        }
    }

    /// 種目・セット・レスト状態の変化時に呼ぶ
    func update(exerciseName: String, exerciseIndex: Int, currentSet: Int, restStartedAt: Date?, restEndsAt: Date?, restRinging: Bool) {
        guard let activity = activity else { return }
        let state = makeState(exerciseName: exerciseName, exerciseIndex: exerciseIndex, currentSet: currentSet, restStartedAt: restStartedAt, restEndsAt: restEndsAt, restRinging: restRinging)
        lastState = state
        Task {
            if #available(iOS 16.2, *) {
                await activity.update(ActivityContent(state: state, staleDate: nil))
            } else {
                await activity.update(using: state)
            }
        }
    }

    /// トレーニング終了時に呼ぶ
    func end(dismissNow: Bool = false) {
        guard let activity = activity else {
            currentStartTime = nil
            lastState = nil
            return
        }
        self.activity = nil
        currentStartTime = nil
        // Activity.content は iOS 16.2+ のAPIなので、16.1 でも使えるよう
        // 最後に送った状態を自前で保持して使い回す
        let finalState = lastState ?? makeState(exerciseName: "", exerciseIndex: -1, currentSet: 0, restStartedAt: nil, restEndsAt: nil, restRinging: false)
        lastState = nil
        Task {
            if #available(iOS 16.2, *) {
                await activity.end(
                    ActivityContent(state: finalState, staleDate: nil),
                    dismissalPolicy: dismissNow ? .immediate : .default
                )
            } else {
                await activity.end(using: finalState, dismissalPolicy: dismissNow ? .immediate : .default)
            }
        }
    }

    /// SET_TRAINING_STATE ブリッジの受け口。状態に応じて開始/更新/終了を振り分ける
    func syncTrainingState(isTraining: Bool, startTime: Date?, gymName: String, exerciseName: String, exerciseIndex: Int, currentSet: Int, restStartedAt: Date?, restEndsAt: Date?, restRinging: Bool) {
        if isTraining {
            let startedAt = startTime ?? currentStartTime ?? Date()
            if activity == nil || currentStartTime != startedAt {
                start(startTime: startedAt, gymName: gymName, exerciseName: exerciseName, exerciseIndex: exerciseIndex, currentSet: currentSet, restStartedAt: restStartedAt, restEndsAt: restEndsAt, restRinging: restRinging)
            } else {
                update(exerciseName: exerciseName, exerciseIndex: exerciseIndex, currentSet: currentSet, restStartedAt: restStartedAt, restEndsAt: restEndsAt, restRinging: restRinging)
            }
        } else {
            end()
        }
    }
}
