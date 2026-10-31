import WidgetKit
import SwiftUI
import ActivityKit

// ==========================================
// WithFitLiveActivity.swift — Widget 拡張エントリ
// トレーニング記録中の Live Activity
// （ロック画面バナー＋ Dynamic Island）を描画する。
//
// デザイン方針:
// - メインは2つのタイマー（記録時間／レスト）を大きく並べる
// - 種目・セットは「総数」ではなく「何種目目・何セット目」だけ表示
// - 操作ボタンは付けない（表示専用）。レスト終了は通知で知らせる
// ==========================================

private let accent = Color(red: 0.063, green: 0.725, blue: 0.506) // #10B981
private let panelBackground = Color(red: 0.051, green: 0.071, blue: 0.098) // slate-950 近似

@main
struct WithFitWidgets: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            TrainingLiveActivityWidget()
        }
    }
}

/// 「2種目目 ・ 3セット目」のような現在の序数ラベル（総数は出さない）
@available(iOS 16.1, *)
private func ordinalText(for state: TrainingActivityAttributes.ContentState) -> String {
    var parts: [String] = []
    if state.exerciseIndex >= 0 { parts.append("\(state.exerciseIndex + 1)種目目") }
    if state.currentSet > 0 { parts.append("\(state.currentSet)セット目") }
    return parts.joined(separator: " ・ ")
}

/// ダンベルアイコンのバッジ（共通パーツ）
private struct DumbbellBadge: View {
    var size: CGFloat = 24

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(accent)
                .frame(width: size, height: size)
            Image(systemName: "dumbbell.fill")
                .font(.system(size: size * 0.48, weight: .bold))
                .foregroundColor(.black.opacity(0.85))
        }
    }
}

/// レストタイマーの表示（カウントダウン／カウントアップ／鳴動中／未使用）
@available(iOS 16.1, *)
private struct RestTimerValue: View {
    let state: TrainingActivityAttributes.ContentState
    var fontSize: CGFloat = 26

    var body: some View {
        if state.restRinging {
            HStack(spacing: 5) {
                Image(systemName: "bell.and.waves.left.and.right.fill")
                    .font(.system(size: fontSize * 0.62, weight: .bold))
                Text("終了！")
                    .font(.system(size: fontSize * 0.86, weight: .heavy, design: .rounded))
            }
            .foregroundColor(.red)
        } else if let endsAt = state.restEndsAt {
            let startedAt = state.restStartedAt ?? endsAt.addingTimeInterval(-3600)
            Text(timerInterval: min(startedAt, endsAt)...endsAt, countsDown: true)
                .font(.system(size: fontSize, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(accent)
        } else if let startedAt = state.restStartedAt {
            Text(startedAt, style: .timer)
                .font(.system(size: fontSize, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(.white)
        } else {
            Text("--:--")
                .font(.system(size: fontSize, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(.white.opacity(0.28))
        }
    }
}

@available(iOS 16.1, *)
struct TrainingLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrainingActivityAttributes.self) { context in
            // ===== ロック画面 / バナー表示 =====
            VStack(alignment: .leading, spacing: 9) {
                // ヘッダー: バッジ＋状態ラベル / ジム名
                HStack(spacing: 7) {
                    DumbbellBadge(size: 22)
                    Text("トレーニング中")
                        .font(.system(size: 12, weight: .heavy))
                        .tracking(1.4)
                        .foregroundColor(.white)
                    Spacer()
                    HStack(spacing: 3) {
                        Image(systemName: "mappin.and.ellipse")
                            .font(.system(size: 10, weight: .semibold))
                        Text(context.attributes.gymName)
                            .font(.system(size: 11, weight: .semibold))
                            .lineLimit(1)
                    }
                    .foregroundColor(.white.opacity(0.55))
                }

                // 現在位置（何種目目・何セット目）＋種目名
                VStack(alignment: .leading, spacing: 2) {
                    let ordinal = ordinalText(for: context.state)
                    if !ordinal.isEmpty {
                        Text(ordinal)
                            .font(.system(size: 11, weight: .heavy))
                            .tracking(0.8)
                            .foregroundColor(accent)
                    }
                    Text(context.state.exerciseName.isEmpty ? "種目を選択してください" : context.state.exerciseName)
                        .font(.system(size: 19, weight: .bold))
                        .foregroundColor(context.state.exerciseName.isEmpty ? .white.opacity(0.45) : .white)
                        .lineLimit(1)
                }

                Divider()
                    .overlay(Color.white.opacity(0.14))

                // メイン: 2つのタイマー
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("記録時間")
                            .font(.system(size: 10, weight: .bold))
                            .tracking(1.0)
                            .foregroundColor(.white.opacity(0.5))
                        Text(context.attributes.startTime, style: .timer)
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundColor(.white)
                    }

                    Rectangle()
                        .fill(Color.white.opacity(0.14))
                        .frame(width: 1, height: 44)

                    VStack(alignment: .leading, spacing: 1) {
                        Text("レスト")
                            .font(.system(size: 10, weight: .bold))
                            .tracking(1.0)
                            .foregroundColor(.white.opacity(0.5))
                        RestTimerValue(state: context.state)
                    }

                    Spacer()
                }

            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .activityBackgroundTint(panelBackground)
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                // ===== Dynamic Island 展開時 =====
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        DumbbellBadge(size: 20)
                        Text("WithFit")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundColor(.white)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    // レスト中はレスト残り、そうでなければ記録時間
                    Group {
                        if context.state.restEndsAt != nil || context.state.restStartedAt != nil || context.state.restRinging {
                            RestTimerValue(state: context.state, fontSize: 16)
                        } else {
                            Text(context.attributes.startTime, style: .timer)
                                .font(.system(size: 16, weight: .bold, design: .rounded))
                                .monospacedDigit()
                                .foregroundColor(.white)
                        }
                    }
                    .frame(maxWidth: 110)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.gymName)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.white.opacity(0.55))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 8) {
                        Text(context.state.exerciseName.isEmpty ? "種目を選択してください" : context.state.exerciseName)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                            .lineLimit(1)
                        Spacer()
                        let ordinal = ordinalText(for: context.state)
                        if !ordinal.isEmpty {
                            Text(ordinal)
                                .font(.system(size: 11, weight: .heavy))
                                .foregroundColor(accent)
                        }
                    }
                    .padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(accent)
            } compactTrailing: {
                Group {
                    if context.state.restEndsAt != nil || context.state.restRinging {
                        RestTimerValue(state: context.state, fontSize: 13)
                    } else {
                        Text(context.attributes.startTime, style: .timer)
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundColor(accent)
                    }
                }
                .frame(maxWidth: 76)
            } minimal: {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(accent)
            }
        }
    }
}
