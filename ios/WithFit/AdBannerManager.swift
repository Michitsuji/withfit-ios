import UIKit
import GoogleMobileAds
import AppTrackingTransparency

// AdMob 設定（表示課金制バナー広告）
// NOTE: 現在は Google 公式のテスト用 ID。本番化には AdMob アカウントで発行した ID に差し替える。
enum AdMobConfig {
    /// バナー広告ユニット ID（テスト用）
    static let bannerAdUnitID = "ca-app-pub-3940256099942544/2934735716"
}

/// 画面下部（タブバーの上）に固定表示する AdMob バナーの管理。
/// 広告が読み込めたときだけ高さを持ち、失敗時は 0 に潰して WebView を全画面に戻す。
final class AdBannerManager: NSObject, BannerViewDelegate {
    static let shared = AdBannerManager()

    private var bannerView: BannerView?
    private weak var host: MainViewController?
    private var started = false

    private override init() { super.init() }

    /// MainViewController の準備ができたら一度だけ呼ぶ
    func start(in host: MainViewController) {
        guard !started else { return }
        started = true
        self.host = host

        let banner = BannerView(adSize: AdSizeBanner)
        banner.adUnitID = AdMobConfig.bannerAdUnitID
        banner.rootViewController = host
        banner.delegate = self
        banner.translatesAutoresizingMaskIntoConstraints = false
        banner.isHidden = true
        self.bannerView = banner

        host.view.addSubview(banner)
        NSLayoutConstraint.activate([
            banner.centerXAnchor.constraint(equalTo: host.view.centerXAnchor),
            banner.bottomAnchor.constraint(equalTo: host.tabBar.topAnchor)
        ])
        banner.load(Request())
    }

    /// トラッキング許可リクエスト（許可されると広告単価が上がる。拒否でも非パーソナライズ広告は出る）
    func requestTrackingAuthorizationIfNeeded() {
        guard ATTrackingManager.trackingAuthorizationStatus == .notDetermined else { return }
        // 起動直後はダイアログが競合しやすいので少し遅らせる
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            ATTrackingManager.requestTrackingAuthorization { _ in }
        }
    }

    // MARK: - BannerViewDelegate

    func bannerViewDidReceiveAd(_ bannerView: BannerView) {
        bannerView.isHidden = false
        host?.additionalSafeAreaInsets.bottom = bannerView.bounds.height
    }

    func bannerView(_ bannerView: BannerView, didFailToReceiveAdWithError error: Error) {
        bannerView.isHidden = true
        host?.additionalSafeAreaInsets.bottom = 0
        // 失敗しても一定時間後に再試行する（在庫なしはよくある）
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak bannerView] in
            bannerView?.load(Request())
        }
    }
}
