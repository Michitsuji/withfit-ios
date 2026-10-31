import Foundation
import ActivityKit

// ==========================================
// TrainingActivityAttributes.swift
// トレーニング記録中 Live Activity の属性定義。
// アプリ本体と Widget 拡張の両ターゲットでコンパイルされる共有ファイル。
// ※ 種目数・セット数の「総数」は後から増える前提のため保持しない。
//    表示するのは「何種目目・何セット目」という現在の序数のみ。
// ==========================================

@available(iOS 16.1, *)
struct TrainingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// 現在実施中の種目名（未選択の場合は空文字）
        var exerciseName: String
        /// 現在の種目が何番目か（0始まり。未選択・不明は -1）
        var exerciseIndex: Int
        /// 現在の種目で実施中のセットが何セット目か（1始まり。不明は 0）
        var currentSet: Int
        /// レストタイマー開始時刻（レスト中でない場合は nil）
        var restStartedAt: Date?
        /// レストタイマー終了予定時刻（カウントアップ中・未使用は nil）
        var restEndsAt: Date?
        /// レストタイマーが鳴動中かどうか
        var restRinging: Bool
    }

    /// トレーニングを開始したジム名
    var gymName: String
    /// トレーニング開始時刻（経過時間表示の基準）
    var startTime: Date
}
