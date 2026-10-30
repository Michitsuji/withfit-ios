@echo off
chcp 65001 > nul
cd /d "%~dp0"

set REPO_URL=https://github.com/michitsuji/withfit-ios.git

if exist .git (
    rmdir /s /q .git
)

git init
git branch -M main
git remote add origin %REPO_URL%
git add -A
git -c core.editor=true commit -m "Initial commit for WithFit iOS Native repository"
git push -u -f origin main
echo.
echo 別リポジトリ (%REPO_URL%) へクリーンな状態で同期しました！
pause
