import WidgetKit
import SwiftUI
import ActivityKit

// ==========================================
// WithFitLiveActivity.swift — Widget 拡張エントリ
// トレーニング記録中の Live Activity
// （ロック画面バナー＋ Dynamic Island）を描画する。
// デザイン: ダークスレート背景 × エメラルド（アプリのテーマカラー）
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

@available(iOS 16.1, *)
struct TrainingLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrainingActivityAttributes.self) { context in
            // ===== ロック画面 / バナー表示 =====
            VStack(alignment: .leading, spacing: 12) {
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

                // 現在の種目名（主役）
                Text(context.state.exerciseName.isEmpty ? "種目を選択してください" : context.state.exerciseName)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(context.state.exerciseName.isEmpty ? .white.opacity(0.45) : .white)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Divider()
                    .overlay(Color.white.opacity(0.14))

                // 下段: 経過時間（大） / 種目プログレス
                HStack(alignment: .bottom, spacing: 12) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("経過時間")
                            .font(.system(size: 10, weight: .bold))
                            .tracking(1.0)
                            .foregroundColor(.white.opacity(0.5))
                        Text(context.attributes.startTime, style: .timer)
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundColor(.white)
                    }

                    Spacer()

                    if context.state.exerciseCount > 0 && context.state.exerciseIndex >= 0 {
                        VStack(alignment: .trailing, spacing: 5) {
                            HStack(alignment: .firstTextBaseline, spacing: 2) {
                                Text("\(context.state.exerciseIndex + 1)")
                                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                                    .foregroundColor(accent)
                                Text("/ \(context.state.exerciseCount) 種目")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(.white.opacity(0.55))
                            }
                            ProgressView(
                                value: Double(context.state.exerciseIndex + 1),
                                total: Double(max(context.state.exerciseCount, 1))
                            )
                            .frame(width: 92)
                            .tint(accent)
                        }
                    } else if context.state.exerciseCount > 0 {
                        Text("全 \(context.state.exerciseCount) 種目")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.white.opacity(0.55))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
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
                    Text(context.attributes.startTime, style: .timer)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(accent)
                        .frame(maxWidth: 96)
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
                        if context.state.exerciseCount > 0 && context.state.exerciseIndex >= 0 {
                            Text("\(context.state.exerciseIndex + 1) / \(context.state.exerciseCount)")
                                .font(.system(size: 11, weight: .heavy, design: .rounded))
                                .foregroundColor(.black.opacity(0.85))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(Capsule().fill(accent))
                        }
                    }
                    .padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(accent)
            } compactTrailing: {
                Text(context.attributes.startTime, style: .timer)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(accent)
                    .frame(maxWidth: 76)
            } minimal: {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(accent)
            }
        }
    }
}
