@echo off
chcp 65001 > nul
cd /d "%~dp0"

REM ========================================================
REM iOSネイティブ版専用 GitHub リポジトリ設定（Web版とは別リポジトリ）
REM ========================================================
set REPO_URL=https://github.com/michitsuji/withfit-ios.git

if not exist .git (
    git init
    git branch -M main
    git remote add origin %REPO_URL%
) else (
    git remote set-url origin %REPO_URL%
)

if exist src\changes.json (
    node src\apply_changes.js
)

git add -A
git diff --cached --quiet || git -c core.editor=true commit -m "Update WithFit iOS Native App"
git push -u -f origin main
echo.
echo ========================================================
echo 完了しました！(%REPO_URL%)
echo GitHub Actions のクラウドMac上で iOSネイティブアプリ (WithFit-iOS.ipa) の自動ビルドが開始されました。
echo 約2〜3分後に download_ios_ipa.bat から最新の .ipa を取得できます。
echo ========================================================
pause
