import WidgetKit
import SwiftUI
import ActivityKit

// ==========================================
// WithFitLiveActivity.swift — Widget 拡張エントリ
// トレーニング記録中の Live Activity
// （ロック画面バナー＋ Dynamic Island）を描画する。
// ==========================================

@main
struct WithFitWidgets: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            TrainingLiveActivityWidget()
        }
    }
}

@available(iOS 16.1, *)
struct TrainingLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrainingActivityAttributes.self) { context in
            // ===== ロック画面 / バナー表示 =====
            VStack(spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: "dumbbell.fill")
                    .font(.system(size: 26))
                    .foregroundColor(.green)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text("トレーニング中")
                            .font(.headline)
                            .foregroundColor(.primary)
                        Text(context.attributes.gymName)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    if context.state.exerciseName.isEmpty {
                        Text("種目を選択してください")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    } else {
                        Text(context.state.exerciseName)
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(.primary)
                            .lineLimit(1)
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text(context.attributes.startTime, style: .timer)
                        .font(.system(.title3, design: .rounded).weight(.bold))
                        .monospacedDigit()
                        .foregroundColor(.green)
                        .multilineTextAlignment(.trailing)
                    if context.state.exerciseCount > 0 {
                        Text("\(context.state.exerciseCount)種目")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }
            if context.state.totalSets > 0 {
                HStack(spacing: 8) {
                    ProgressView(value: Double(context.state.completedSets), total: Double(max(context.state.totalSets, 1)))
                        .tint(.green)
                    Text("\(context.state.completedSets)/\(context.state.totalSets) セット")
                        .font(.caption2.weight(.bold))
                        .foregroundColor(.secondary)
                        .fixedSize()
                }
            }
            }
            .padding(14)
            .activityBackgroundTint(Color.black.opacity(0.35))
            .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                // ===== Dynamic Island 展開時 =====
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 4) {
                        Image(systemName: "dumbbell.fill")
                            .foregroundColor(.green)
                        Text("記録中")
                            .font(.caption.weight(.bold))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.startTime, style: .timer)
                        .font(.system(.body, design: .rounded).weight(.bold))
                        .monospacedDigit()
                        .foregroundColor(.green)
                        .frame(maxWidth: 90)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.state.exerciseName.isEmpty ? context.attributes.gymName : context.state.exerciseName)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Spacer()
                        if context.state.exerciseCount > 0 {
                            Text("\(context.state.exerciseCount)種目")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        if context.state.totalSets > 0 {
                            Text("\(context.state.completedSets)/\(context.state.totalSets) セット")
                                .font(.caption.weight(.bold))
                                .foregroundColor(.green)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "dumbbell.fill")
                    .foregroundColor(.green)
            } compactTrailing: {
                Text(context.attributes.startTime, style: .timer)
                    .monospacedDigit()
                    .foregroundColor(.green)
                    .frame(maxWidth: 64)
            } minimal: {
                Image(systemName: "dumbbell.fill")
                    .foregroundColor(.green)
            }
        }
    }
}
