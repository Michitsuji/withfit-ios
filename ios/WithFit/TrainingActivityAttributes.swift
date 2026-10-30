import Foundation
import ActivityKit

// ==========================================
// TrainingActivityAttributes.swift
// トレーニング記録中 Live Activity の属性定義。
// アプリ本体と Widget 拡張の両ターゲットでコンパイルされる共有ファイル。
// ==========================================

@available(iOS 16.1, *)
struct TrainingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// 現在実施中の種目名（未選択の場合は空文字）
        var exerciseName: String
        /// 記録中の種目の総数
        var exerciseCount: Int
        /// 現在の種目で完了チェック済みのセット数
        var completedSets: Int
        /// 現在の種目の総セット数
        var totalSets: Int
    }

    /// トレーニングを開始したジム名
    var gymName: String
    /// トレーニング開始時刻（経過時間表示の基準）
    var startTime: Date
}
