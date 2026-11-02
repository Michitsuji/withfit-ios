// ==========================================
// FriendsView.js — フレンド管理・フレンド詳細・不具合要望レポート画面コンポーネント
// ==========================================
import React, { useState, useEffect, useMemo } from 'react';
import { Users, Flame, Circle, Trophy, Target, Copy, UserPlus, AlignLeft, Bell, Sparkles, Activity, Award, ArrowUp, ArrowDown, Trash2, X } from 'lucide-react';
import { onSnapshot, collection, setDoc, doc, query, orderBy, deleteDoc, getDoc } from 'firebase/firestore';
import { db, appId } from './firebase';
import { MASTER_USER, formatDateFromTimestamp } from './utils';
import { UserAvatar, renderUsernameWithBadge, TimerDisplay, LiquidGlassSegmented } from './CommonUI';
import { copyTextToClipboard } from './nativeBridge';
import { DataView } from './DataView';

// --- フレンド画面 ---
// データ保存量の概算ヘルパー（フッター表示用）
const byteSizeOf = (v) => { try { return new Blob([typeof v === 'string' ? v : JSON.stringify(v ?? {})]).size; } catch (e) { return 0; } };
const formatBytes = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;
const localStorageBytes = () => {
  try {
    let t = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      t += byteSizeOf(k) + byteSizeOf(localStorage.getItem(k) || '');
    }
    if (typeof window !== 'undefined' && window.__WITHFIT_NATIVE_DB__) t += byteSizeOf(window.__WITHFIT_NATIVE_DB__);
    return t;
  } catch (e) { return 0; }
};

function FriendsView({ currentUser, myInfo, accountsInfo, onUserClick, onSendRequest, onAccept, onReject, onRemoveFriend, onSendPartnerRequest, onAcceptPartnerRequest, onRejectPartnerRequest, onRemovePartner, onFriendClick, onGenerateFriendCode, posts, targetFriendTab, setTargetFriendTab, onImport, onImportItem, onSendTestPush }) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [reportsCount, setReportsCount] = useState(0);

  useEffect(() => {
    if (currentUser === MASTER_USER && db) {
      const unsub = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'reports'), (snap) => {
        setReportsCount(snap.size);
      });
      return () => unsub();
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser === MASTER_USER && db) {
      const unsub = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'contentReports'), (snap) => {
        let n = 0;
        snap.forEach(d => { if (d.data().status !== 'resolved') n++; });
        setContentReportsCount(n);
      });
      return () => unsub();
    }
  }, [currentUser]);
  const [searchUsername, setSearchUsername] = useState('');
  const [searchPartnerName, setSearchPartnerName] = useState('');
  const partnerName = myInfo?.partnerId;
  const partnerInfo = partnerName ? accountsInfo[partnerName] : null;
  const isPartnerEnabled = myInfo?.enablePartnerFeature || false;
  const [activeTab, setActiveTab] = useState(targetFriendTab || (isPartnerEnabled ? 'partner' : 'friends'));

  useEffect(() => {
    if (targetFriendTab) {
      setActiveTab(targetFriendTab);
      if (setTargetFriendTab) setTargetFriendTab(null);
    }
  }, [targetFriendTab, setTargetFriendTab]);
  const [rankingType, setRankingType] = useState('friends');
  const [isRankingExpanded, setIsRankingExpanded] = useState(false);
  const [reportText, setReportText] = useState('');
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [showReportsModal, setShowReportsModal] = useState(false);
  const [contentReportsCount, setContentReportsCount] = useState(0);
  const [showContentReportsModal, setShowContentReportsModal] = useState(false);
  const [testPushTarget, setTestPushTarget] = useState(currentUser || '');
  const [testPushMessage, setTestPushMessage] = useState('');
  const [isSendingTestPush, setIsSendingTestPush] = useState(false);

  const handlePartnerSearchSubmit = (e) => {
    e.preventDefault();
    onSendPartnerRequest(searchPartnerName.trim());
    setSearchPartnerName('');
  };

  const rankingData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const userVolumes = {};
    
    (posts || []).forEach(p => {
      const d = new Date(p.timestamp);
      if (d.getFullYear() === year && d.getMonth() === month) {
        if (userVolumes[p.author] === undefined) userVolumes[p.author] = 0;
        userVolumes[p.author] += Number(p.volume) || 0;
      }
    });

    if (userVolumes[currentUser] === undefined) userVolumes[currentUser] = 0;

    const myFriends = myInfo.friends || [];

    const allUsersArray = Object.entries(userVolumes)
      .map(([username, volume]) => ({
        username,
        volume,
        displayName: accountsInfo[username]?.displayName || username,
        photoUrl: accountsInfo[username]?.photoUrl || null
      }))
      .sort((a, b) => b.volume - a.volume);

    const friendRanking = allUsersArray.filter(u => u.username === currentUser || myFriends.includes(u.username));

    return { globalRanking: allUsersArray, friendRanking };
  }, [posts, currentUser, myInfo.friends, accountsInfo]);

  useEffect(() => {
    const timerId = setInterval(() => setCurrentTime(Date.now()), 5000);
    return () => clearInterval(timerId);
  }, []);

  const getTimeAgo = (timestamp) => {
    if (!timestamp || timestamp === 0) return '不明';
    const diff = Math.max(0, currentTime - timestamp);
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}秒前`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}分前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}時間前`;
    const days = Math.floor(hours / 24);
    return `${days}日前`;
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    onSendRequest(searchUsername.trim());
    setSearchUsername('');
  };

  const myFriends = myInfo.friends || [];

  let partnerPosts = [];
  let totalMonthVolume = 0;
  let myMonthVolume = 0;
  let partnerMonthVolume = 0;
  let myPercent = 0;
  let partnerPercent = 0;
  let cardGradient = 'bg-gradient-to-br from-slate-400 to-slate-500 shadow-slate-500/20'; 
  let iconBorder = 'border-slate-300';
  let badgeColor = 'bg-slate-400';
  let isPartnerTraining = false;
  let isPartnerOnline = false;
  let pLastActive = 0;

  if (partnerName && partnerInfo) {
      isPartnerTraining = partnerInfo.isTraining;
      pLastActive = partnerInfo.lastActive || 0;
      const pIsAppOnline = partnerInfo.isAppOnline !== false;
      isPartnerOnline = pIsAppOnline && pLastActive > 0 && (currentTime - pLastActive < 45000);

      if (isPartnerTraining) { cardGradient = 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-orange-500/20'; iconBorder = 'border-orange-400'; badgeColor = isPartnerOnline ? 'bg-amber-400' : 'bg-slate-400'; } 
      else if (isPartnerOnline) { cardGradient = 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/20'; iconBorder = 'border-emerald-400'; badgeColor = 'bg-emerald-400'; }

      partnerPosts = posts ? posts.filter(p => p.author === partnerName) : [];

      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      const currentMonthPosts = posts.filter(p => {
        const d = new Date(p.timestamp);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      });

      myMonthVolume = currentMonthPosts.filter(p => p.author === currentUser).reduce((sum, p) => sum + (Number(p.volume) || 0), 0);
      partnerMonthVolume = currentMonthPosts.filter(p => p.author === partnerName).reduce((sum, p) => sum + (Number(p.volume) || 0), 0);
      totalMonthVolume = myMonthVolume + partnerMonthVolume;
      const targetVolume = 500000; 
      
      myPercent = Math.min(100, (myMonthVolume / targetVolume) * 100);
      partnerPercent = Math.min(100 - myPercent, (partnerMonthVolume / targetVolume) * 100);
  }

  return (
    <div className="space-y-6 animate-in fade-in">
      
      <LiquidGlassSegmented
        className="mb-6"
        value={activeTab}
        onChange={setActiveTab}
        options={[
          ...(isPartnerEnabled ? [{ value: 'partner', label: 'パートナー' }] : []),
          { value: 'friends', label: 'フレンド一覧' },
          { value: 'add', label: 'フレンド追加' }
        ]}
      />

      {isPartnerEnabled && activeTab === 'partner' && (
        <div className="space-y-6 animate-in fade-in">
          {myInfo.partnerRequests && myInfo.partnerRequests.length > 0 && (
             <div className="mb-6 space-y-2">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">パートナー申請 承認待ち</h3>
                {myInfo.partnerRequests.map(reqUser => (
                   <div key={reqUser} className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-3 flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-3">
                         <UserAvatar userId={reqUser} accountsInfo={accountsInfo} size={40} onClick={onUserClick} />
                         {renderUsernameWithBadge(reqUser, accountsInfo[reqUser]?.displayName, accountsInfo, "font-bold text-slate-800 dark:text-slate-100 text-sm", onUserClick)}
                      </div>
                      <div className="flex gap-2">
                         <button onClick={() => onAcceptPartnerRequest(reqUser)} className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors">承認</button>
                         <button onClick={() => onRejectPartnerRequest(reqUser)} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors">拒否</button>
                      </div>
                   </div>
                ))}
             </div>
          )}

          {!partnerName && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
                 <Users size={18} className="text-amber-500" /> パートナーを追加する
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-bold mb-4">フレンドコードで検索するか、既存のフレンドからパートナー申請を送りましょう。パートナーは1人だけ設定できます。</p>
              
              <form onSubmit={handlePartnerSearchSubmit} className="flex gap-2 mb-6">
                <input type="text" value={searchPartnerName} onChange={e => setSearchPartnerName(e.target.value)} required placeholder="フレンドコードまたはユーザー名" className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-800 dark:text-slate-100 focus:border-amber-500 focus:outline-none text-base" style={{ fontSize: '16px' }}/>
                <button type="submit" disabled={!searchPartnerName.trim()} className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 rounded-xl transition-colors disabled:opacity-50 shadow-sm text-sm">申請</button>
              </form>

              {myFriends.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-3">フレンドから選ぶ</h4>
                  <div className="space-y-2">
                    {myFriends.map(f => {
                       const fInfo = accountsInfo[f];
                       const hasRequested = (fInfo?.partnerRequests || []).includes(currentUser);
                       return (
                         <div key={f} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                           <div className="flex items-center gap-2">
                              <UserAvatar userId={f} accountsInfo={accountsInfo} size={32} onClick={onUserClick} />
                              {renderUsernameWithBadge(f, fInfo?.displayName, accountsInfo, "font-bold text-slate-800 dark:text-slate-200 text-sm", onUserClick)}
                           </div>
                           {hasRequested ? (
                              <span className="text-[10px] font-bold text-slate-400 px-3 py-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg">申請済</span>
                           ) : (
                              <button onClick={() => onSendPartnerRequest(f)} className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors">申請</button>
                           )}
                         </div>
                       )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {partnerName && partnerInfo && (
            <>
          <div className={`rounded-3xl p-6 relative overflow-hidden shadow-lg w-full text-white transition-colors duration-500 ${cardGradient}`}>
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10"></div>
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-black/10 rounded-full blur-2xl -ml-10 -mb-10"></div>
            
            <div className="flex flex-col items-center justify-center text-center relative z-10 py-4">
              <div className="relative mb-4">
                <UserAvatar userId={partnerName} accountsInfo={accountsInfo} size={96} className="shadow-xl" onClick={onUserClick} />
                <div className={`absolute bottom-0 right-0 w-6 h-6 border-4 border-white rounded-full ${badgeColor} z-20`}></div>
              </div>
              <p className="font-bold text-2xl mb-1 cursor-pointer" onClick={() => onUserClick && onUserClick(partnerName)}>{partnerInfo.displayName || partnerName}</p>
              
              {partnerInfo.goal && (
                 <div className="mt-2 bg-black/20 px-4 py-2 rounded-xl text-sm font-bold backdrop-blur-sm w-full max-w-[280px]">
                    <p className="text-white/80 text-xs mb-1">目標</p>
                    <p className="text-white break-words">{partnerInfo.goal}</p>
                 </div>
              )}

              {isPartnerTraining ? (
                <div className="mt-4 flex flex-col items-center gap-1.5 bg-black/30 px-4 py-2.5 rounded-2xl text-sm font-bold backdrop-blur-sm">
                    <div className="flex items-center gap-2"><Flame size={16} className={`${isPartnerOnline ? 'text-amber-300 animate-pulse' : 'text-slate-400'}`} /> トレーニング中 {isPartnerOnline ? '(オンライン)' : '(オフライン)'} <TimerDisplay startTime={partnerInfo.trainingStartTime} /></div>
                    {partnerInfo.currentExerciseName && <div className="text-[10px] text-amber-100 opacity-90 border-t border-white/20 pt-1 mt-1 w-full text-center">現在: {partnerInfo.currentExerciseName}</div>}
                </div>
              ) : isPartnerOnline ? (
                <div className="mt-4 inline-flex items-center gap-2 bg-black/30 px-4 py-1.5 rounded-full text-sm font-bold backdrop-blur-sm"><Circle fill="currentColor" size={10} className="text-emerald-300 animate-pulse" /> オンライン</div>
              ) : (
                <div className="mt-4 inline-flex items-center gap-2 bg-black/20 px-4 py-1.5 rounded-full text-sm font-bold backdrop-blur-sm text-slate-200"><Circle fill="currentColor" size={10} className="text-slate-300" /> オフライン</div>
              )}
              {!isPartnerOnline && (
                <div className="mt-2 text-xs font-bold text-white/70">
                  最終アクセス: {getTimeAgo(pLastActive)}
                </div>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-600 to-purple-600 rounded-3xl p-6 text-white shadow-lg relative overflow-hidden">
             <div className="absolute top-2 right-2 text-white/20"><Trophy size={80}/></div>
             <div className="relative z-10">
               <h3 className="font-bold text-lg flex items-center gap-2 mb-2"><Target size={20}/> 今月のふたりで500トンチャレンジ！</h3>
               <p className="text-xs text-blue-100 font-bold mb-4">ふたりの合計総負荷量で500,000kgを目指そう！</p>
               
               <div className="flex justify-between items-end mb-2">
                  <span className="text-2xl font-bold">{totalMonthVolume.toLocaleString()} <span className="text-sm font-normal">kg</span></span>
                  <span className="text-sm font-bold text-blue-200">/ 500,000 kg</span>
               </div>
               
               <div className="w-full h-4 bg-black/30 rounded-full overflow-hidden flex">
                  <div className="h-full bg-emerald-400 transition-all duration-1000" style={{ width: `${myPercent}%` }}></div>
                  <div className="h-full bg-rose-400 transition-all duration-1000" style={{ width: `${partnerPercent}%` }}></div>
               </div>
               
               <div className="flex justify-between items-center mt-3 text-xs font-bold">
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-400"></div>{currentUser}: {myMonthVolume.toLocaleString()}kg</div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-rose-400"></div>{partnerInfo.displayName || partnerName}: {partnerMonthVolume.toLocaleString()}kg</div>
               </div>
             </div>
          </div>
          

          <div className="mt-8 partner-data-view">
             <style>{`.partner-data-view > div > h2:first-child { display: none; }`}</style>
             <DataView 
               posts={posts} 
               currentUser={currentUser} 
               targetUser={partnerName} 
               accountsInfo={accountsInfo} 
               onImport={onImport}
               onImportItem={onImportItem}
               onToggleLike={() => {}} 
               onAddComment={() => {}} 
               onDeleteComment={() => {}} 
               onToggleCommentLike={() => {}} 
               onUserClick={onFriendClick} 
             />
          </div>

          <div className="mt-8 text-center pt-4 border-t border-slate-200 dark:border-slate-800">
             <button onClick={onRemovePartner} className="text-xs font-bold text-slate-400 hover:text-rose-500 transition-colors">パートナーを解除する</button>
          </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'add' && (
        <div className="space-y-6">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl p-4 flex items-center justify-between shadow-sm">
            <div>
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-1">あなたのフレンドコード</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-300 tracking-widest">{myInfo.friendCode || '未発行'}</p>
            </div>
            {myInfo.friendCode ? (
               <button onClick={() => { copyTextToClipboard(myInfo.friendCode); alert('コピーしました'); }} className="p-2 bg-white dark:bg-slate-900 rounded-lg text-emerald-500 shadow-sm border border-emerald-100 dark:border-emerald-800 transition-colors hover:bg-emerald-100 dark:hover:bg-slate-800"><Copy size={18} /></button>
            ) : (
               <button onClick={onGenerateFriendCode} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg font-bold text-sm shadow-sm transition-colors hover:bg-emerald-600">発行する</button>
            )}
          </div>

          <form onSubmit={handleSearchSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
               <UserPlus size={18} className="text-emerald-500" /> フレンドコードで検索
            </h3>
            <div className="flex gap-2">
              <input type="text" value={searchUsername} onChange={e => setSearchUsername(e.target.value)} required placeholder="5桁のコードを入力" className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-800 dark:text-slate-100 focus:border-emerald-500 focus:outline-none text-base" style={{ fontSize: '16px' }}/>
              <button type="submit" disabled={!searchUsername.trim()} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-6 rounded-xl transition-colors disabled:opacity-50 shadow-sm">追加</button>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 font-bold">※追加したフレンドの記録はタイムラインやデータ画面に表示されます。</p>
          </form>

          {currentUser === MASTER_USER && (
            <>
              <button onClick={() => setShowReportsModal(true)} className="relative w-full py-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-blue-600 dark:text-blue-400 font-bold rounded-xl shadow-sm hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors flex items-center justify-center gap-2">
                <AlignLeft size={18} /> 【マスター限定】不具合報告一覧を見る
                {reportsCount > 0 && (
                  <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md">
                    {reportsCount}
                  </div>
                )}
              </button>
              <button onClick={() => setShowContentReportsModal(true)} className="relative w-full py-3 mt-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 font-bold rounded-xl shadow-sm hover:bg-rose-100 dark:hover:bg-rose-900 transition-colors flex items-center justify-center gap-2">
                <AlignLeft size={18} /> 【マスター限定】コンテンツ通報一覧を見る
                {contentReportsCount > 0 && (
                  <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md">
                    {contentReportsCount}
                  </div>
                )}
              </button>
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-2xl p-5 shadow-sm mt-4">
                <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400 mb-4 flex items-center gap-2">
                  <Bell size={18} /> 【マスター限定】通知システム配信テスト
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">送信先ユーザー</label>
                    <select 
                      value={testPushTarget} 
                      onChange={(e) => setTestPushTarget(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-slate-800 dark:text-slate-100 font-bold focus:outline-none focus:border-amber-500 text-sm"
                    >
                      <option value="" disabled>送信先を選択</option>
                      {[currentUser, ...myFriends].map(f => {
                        const acc = accountsInfo[f];
                        const tCount = Array.isArray(acc?.fcmTokens) ? acc.fcmTokens.length : (acc?.fcmToken ? 1 : 0);
                        return (
                          <option key={f} value={f}>
                            {acc?.displayName || f}{f === currentUser ? ' (自分)' : ''} — {tCount > 0 ? `Push登録:${tCount}台` : 'アプリ内通知のみ'}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">メッセージ内容</label>
                    <input 
                      type="text" 
                      value={testPushMessage} 
                      onChange={(e) => setTestPushMessage(e.target.value)} 
                      placeholder="テストメッセージを入力"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-slate-800 dark:text-slate-100 font-bold focus:outline-none focus:border-amber-500 text-sm"
                    />
                  </div>
                  <button 
                    onClick={async () => {
                      if (!onSendTestPush || isSendingTestPush) return;
                      setIsSendingTestPush(true);
                      try {
                        await onSendTestPush(testPushTarget, testPushMessage);
                        setTestPushMessage('');
                      } finally {
                        setIsSendingTestPush(false);
                      }
                    }}
                    disabled={!testPushTarget || !testPushMessage.trim() || isSendingTestPush}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-xl text-sm shadow-md transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                  >
                    {isSendingTestPush ? <Activity size={16} className="animate-spin" /> : <Bell size={16} />}
                    通知を送信する（アプリ内＋Push）
                  </button>
                </div>
              </div>
            </>
          )}

          {currentUser !== MASTER_USER && (
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!reportText.trim()) return;
              setIsSendingReport(true);
              const reportId = `report_${Date.now()}`;
              try {
                await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId), {
                  author: currentUser,
                  text: reportText.trim(),
                  timestamp: Date.now()
                });
                alert('不具合・ご要望を報告しました。ご協力ありがとうございます！');
                setReportText('');
              } catch (error) {
                console.error(error);
                alert('送信に失敗しました。');
              } finally {
                setIsSendingReport(false);
              }
            }} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                <Sparkles size={16} className="text-blue-500" /> 不具合・ご要望の報告
              </h3>
              <textarea 
                value={reportText} 
                onChange={e => setReportText(e.target.value)} 
                placeholder="不具合の動作や、追加してほしい機能などがあれば自由に入力してください。" 
                required 
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none resize-none" 
                rows={3} 
                style={{ fontSize: '14px' }}
              />
              <button 
                type="submit" 
                disabled={isSendingReport || !reportText.trim()} 
                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2.5 rounded-xl text-sm shadow-md transition-colors disabled:opacity-50 mt-3 flex items-center justify-center gap-2"
              >
                {isSendingReport ? <Activity size={16} className="animate-spin" /> : '報告を送信する'}
              </button>
            </form>
          )}
        </div>
      )}

      {activeTab === 'friends' && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-blue-600 via-purple-600 to-pink-500 rounded-3xl p-5 text-white shadow-xl mb-6 overflow-hidden relative">
            <div className="absolute -right-6 -bottom-6 text-white/10 transform rotate-12 pointer-events-none">
              <Trophy size={140} />
            </div>
            <div className="flex items-center justify-between mb-4 relative z-10">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Trophy className="text-amber-300 animate-bounce" size={18} />
                今月の総負荷ランキング
              </h3>
              <div className="flex bg-black/20 rounded-lg p-0.5">
                <button onClick={() => setRankingType('friends')} className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${rankingType === 'friends' ? 'bg-white/20 text-white' : 'text-white/60'}`}>フレンド</button>
                <button onClick={() => setRankingType('global')} className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${rankingType === 'global' ? 'bg-white/20 text-white' : 'text-white/60'}`}>全世界</button>
              </div>
            </div>
            <div className="space-y-2.5 relative z-10">
              {(rankingType === 'global' ? rankingData.globalRanking : rankingData.friendRanking).slice(0, isRankingExpanded ? 100 : 5).map((user, idx) => {
                const isMe = user.username === currentUser;
                let rankBadge = <span className="text-xs font-bold w-6 text-center text-white/70">{idx + 1}</span>;
                if (idx === 0) rankBadge = <Award className="text-amber-300 shrink-0" size={20} />;
                if (idx === 1) rankBadge = <Award className="text-slate-300 shrink-0" size={20} />;
                if (idx === 2) rankBadge = <Award className="text-amber-600 shrink-0" size={20} />;

                return (
                  <div key={user.username} className={`flex items-center justify-between p-2.5 rounded-2xl border backdrop-blur-md transition-all ${isMe ? 'bg-white/20 border-white/40 shadow-md' : 'bg-black/10 border-white/10 hover:bg-black/20'}`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-6 flex justify-center items-center shrink-0">{rankBadge}</div>
                      <UserAvatar userId={user.username} accountsInfo={accountsInfo} size={28} onClick={onUserClick} />
                      {renderUsernameWithBadge(user.username, user.displayName, accountsInfo, `text-xs font-bold truncate ${isMe ? 'text-amber-200' : ''}`, onUserClick)}
                    </div>
                    <span className="font-mono font-bold text-xs bg-black/20 px-2.5 py-1 rounded-full shrink-0">
                      {Math.round(user.volume).toLocaleString()}<span className="text-[9px] font-normal ml-0.5">kg</span>
                    </span>
                  </div>
                );
              })} 
              {(rankingType === 'global' ? rankingData.globalRanking : rankingData.friendRanking).length > 5 && (
                <button 
                  onClick={() => setIsRankingExpanded(!isRankingExpanded)} 
                  className="w-full mt-3 py-2.5 text-xs font-bold text-white/90 bg-black/20 hover:bg-black/30 rounded-xl transition-colors backdrop-blur-md border border-white/10 flex items-center justify-center gap-1"
                >
                  {isRankingExpanded ? <><ArrowUp size={14}/> 閉じる</> : <><ArrowDown size={14}/> もっと見る</>}
                </button>
              )}
            </div>
          </div>

          {myInfo.friendRequests && myInfo.friendRequests.length > 0 && (
             <div className="mb-6 space-y-2">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">承認待ち</h3>
                {myInfo.friendRequests.map(reqUser => (
                   <div key={reqUser} className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl p-3 flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-3">
                         <UserAvatar userId={reqUser} accountsInfo={accountsInfo} size={40} onClick={onUserClick} />
                         {renderUsernameWithBadge(reqUser, accountsInfo[reqUser]?.displayName, accountsInfo, "font-bold text-slate-800 dark:text-slate-100 text-sm", onUserClick)}
                      </div>
                      <div className="flex gap-2">
                         <button onClick={() => onAccept(reqUser)} className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors">承認</button>
                         <button onClick={() => onReject(reqUser)} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors">拒否</button>
                      </div>
                   </div>
                ))}
             </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-4">
            <UserAvatar userId={currentUser} accountsInfo={accountsInfo} size={48} onClick={onUserClick} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-slate-800 dark:text-slate-100 text-base truncate cursor-pointer" onClick={() => onUserClick && onUserClick(currentUser)}>{myInfo?.displayName || currentUser}</span>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 shrink-0">あなた</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-bold truncate">{myInfo?.goal || '目標を設定してトレーニングを頑張りましょう'}</p>
            </div>
          </div>
          <div className="w-full h-px bg-slate-200 dark:bg-slate-800"></div>
          {myFriends.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center shadow-sm">
              <Users className="mx-auto text-slate-300 dark:text-slate-600 w-12 h-12 mb-4" />
              <p className="text-slate-500 dark:text-slate-400 font-bold">フレンドがいません。</p>
              <button onClick={() => setActiveTab('add')} className="mt-4 text-emerald-500 font-bold text-sm bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2 rounded-full border border-emerald-100 dark:border-emerald-900">フレンドを追加する</button>
            </div>
          ) : (
            myFriends.map(friendUsername => {
              const friendInfo = accountsInfo[friendUsername];
              if (!friendInfo) return null;
              
              const isTraining = friendInfo.isTraining;
              const lastActive = friendInfo.lastActive || 0;
              const isAppOnline = friendInfo.isAppOnline !== false;
              const isOnline = isAppOnline && lastActive > 0 && (currentTime - lastActive < 45000);

              return (
                <div key={friendUsername} onClick={() => onFriendClick && onFriendClick(friendUsername)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center justify-between group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <UserAvatar userId={friendUsername} accountsInfo={accountsInfo} size={48} />
                      <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 border-2 border-white dark:border-slate-900 rounded-full z-10 ${isTraining ? 'bg-amber-400' : isOnline ? 'bg-emerald-400' : 'bg-slate-400'}`}></div>
                    </div>
                    <div>
                      <h3>{renderUsernameWithBadge(friendUsername, friendInfo.displayName, accountsInfo, "font-bold text-slate-800 dark:text-slate-100")}</h3>
                      {isTraining ? (
                        <div className="flex flex-col gap-0.5">
                          <p className="text-xs text-amber-500 font-bold flex items-center gap-1"><Flame size={12}/>トレーニング中 {friendInfo.currentExerciseName ? `- ${friendInfo.currentExerciseName}` : ''}</p>
                          {!isOnline && <p className="text-[10px] text-slate-400 font-bold">最終アクセス: {getTimeAgo(lastActive)}</p>}
                        </div>
                      ) : isOnline ? (
                        <p className="text-xs text-emerald-500 font-bold">オンライン</p>
                      ) : (
                        <p className="text-xs text-slate-400 font-bold">最終アクセス: {getTimeAgo(lastActive)}</p>
                      )}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); onRemoveFriend(friendUsername); }} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-full transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <Trash2 size={18} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      <ReportsModal isOpen={showReportsModal} onClose={() => setShowReportsModal(false)} db={db} accountsInfo={accountsInfo} onUserClick={onUserClick} />
      <ContentReportsModal isOpen={showContentReportsModal} onClose={() => setShowContentReportsModal(false)} accountsInfo={accountsInfo} />

      <div className="mt-12 text-center pb-4 pt-6 border-t border-slate-200/50 dark:border-slate-800/50">
        <div className="flex items-center justify-center gap-4 mb-2">
          <button onClick={() => window.open('https://michitsuji.github.io/withfit-ios/privacy.html', '_blank')} className="text-[11px] font-bold text-slate-400 dark:text-slate-500 underline underline-offset-2">プライバシーポリシー</button>
          <button onClick={() => window.open('https://michitsuji.github.io/withfit-ios/terms.html', '_blank')} className="text-[11px] font-bold text-slate-400 dark:text-slate-500 underline underline-offset-2">利用規約</button>
        </div>
        <p className="mb-1 text-[11px] font-bold text-slate-400 dark:text-slate-500">データ保存量（目安）　データベース: {formatBytes(byteSizeOf(posts.filter(p => p.author === currentUser)) + byteSizeOf(accountsInfo[currentUser]))} ／ ローカル: {formatBytes(localStorageBytes())}</p>
        <p className="text-xs font-bold text-slate-400 dark:text-slate-500">WithFit v1.2.0 (2026.10.30, 04:59, updated)</p>
      </div>
    </div>
  );
}

// --- フレンド詳細モーダル ---
function FriendDetailModal({ friendUsername, posts, accountsInfo, onClose, onToggleLike, onImport, onImportItem, currentUser, onAddComment, onDeleteComment, onToggleCommentLike, onUserClick }) {
  const friendInfo = accountsInfo[friendUsername] || {};

  return (
    <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm z-50 flex flex-col justify-end sm:justify-center sm:items-center animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-slate-50 dark:bg-slate-950 sm:rounded-3xl rounded-t-3xl flex flex-col h-[90vh] sm:h-[85vh] w-full sm:max-w-md overflow-hidden shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10 pt-safe">
          <div className="flex items-center gap-2">
             <UserAvatar userId={friendUsername} accountsInfo={accountsInfo} size={32} onClick={onUserClick} />
             <h2>{renderUsernameWithBadge(friendUsername, friendInfo.displayName, accountsInfo, "text-lg font-bold text-slate-800 dark:text-white", onUserClick)}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-full"><X size={20} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24 sm:pb-4">
           {friendInfo.goal && (
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                 <p className="text-xs text-slate-500 dark:text-slate-400 font-bold mb-1">目標</p>
                 <p className="text-sm text-slate-800 dark:text-slate-200 font-bold">{friendInfo.goal}</p>
              </div>
           )}

           <DataView posts={posts} currentUser={currentUser} targetUser={friendUsername} accountsInfo={accountsInfo} onImport={onImport} onImportItem={onImportItem} onToggleLike={onToggleLike} onAddComment={onAddComment} onDeleteComment={onDeleteComment} onToggleCommentLike={onToggleCommentLike} onUserClick={onUserClick} />
        </div>
      </div>
    </div>
  );
}

// --- 不具合・要望一覧モーダル ---
function ContentReportsModal({ isOpen, onClose, accountsInfo }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!isOpen || !db) return;
    const unsub = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'contentReports'), (snap) => {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setItems(list);
    });
    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;
  const pending = items.filter(i => i.status !== 'resolved');

  const markResolved = async (item) => {
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'contentReports', item.id), { status: 'resolved', resolvedAt: Date.now() }, { merge: true });
    } catch (e) {}
  };

  const deleteTarget = async (item) => {
    if (!window.confirm('対象を削除して対応済みにしますか？')) return;
    try {
      if (item.targetType === 'post' && item.postId) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'workouts', item.postId));
      } else if (item.targetType === 'comment' && item.postId && item.targetId) {
        const postRef = doc(db, 'artifacts', appId, 'public', 'data', 'workouts', item.postId);
        const snap = await getDoc(postRef);
        if (snap.exists()) {
          const comments = (snap.data().comments || []).filter(c => c.id !== item.targetId && c.parentId !== item.targetId);
          await setDoc(postRef, { comments }, { merge: true });
        }
      }
      await markResolved(item);
    } catch (e) {
      alert('削除に失敗しました');
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 w-full max-w-md max-h-[80vh] overflow-y-auto rounded-3xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-black text-slate-800 dark:text-slate-100">コンテンツ通報（未対応 {pending.length}件）</h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-full"><X size={18} /></button>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm font-bold text-slate-400 text-center py-8">未対応の通報はありません</p>
        ) : (
          <div className="space-y-3">
            {pending.map(item => (
              <div key={item.id} className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <div className="text-[11px] font-bold text-slate-400 mb-1">
                  {item.targetType === 'post' ? '投稿' : 'コメント'} ／ 通報者: {accountsInfo[item.reporter]?.displayName || item.reporter} ／ 相手: {accountsInfo[item.reportedUser]?.displayName || item.reportedUser}
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words mb-3">{item.snapshotText || '（内容なし）'}</p>
                <div className="flex gap-2">
                  <button onClick={() => deleteTarget(item)} className="flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded-lg transition-colors">対象を削除</button>
                  <button onClick={() => markResolved(item)} className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors">対応済みにする</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportsModal({ isOpen, onClose, db, accountsInfo, onUserClick }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !db) return;
    const reportsRef = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const q = query(reportsRef, orderBy('timestamp', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reportsData = [];
      snapshot.forEach(doc => {
        reportsData.push({ id: doc.id, ...doc.data() });
      });
      setReports(reportsData);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsubscribe();
  }, [isOpen, db]);

  const handleDeleteReport = async (id) => {
    if (!window.confirm('この報告を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', id));
    } catch (e) {}
  };

  const getRelativeTime = (timestamp) => {
    const diff = Math.max(0, Date.now() - timestamp);
    const m = Math.floor(diff / 60000);
    if (m === 0) return 'たった今';
    if (m < 60) return `${m}分前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}時間前`;
    return `${Math.floor(h / 24)}日前`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950/40">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">不具合・要望一覧</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-full"><X size={18}/></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {loading ? (
            <div className="text-center p-4 text-slate-400 font-bold text-xs">読み込み中...</div>
          ) : reports.length === 0 ? (
            <div className="text-center p-4 text-slate-400 font-bold text-xs">報告はありません</div>
          ) : (
            reports.map(report => {
              const uInfo = accountsInfo && accountsInfo[report.author];
              return (
                <div key={report.id} className="bg-slate-50 dark:bg-slate-950/50 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 relative">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <UserAvatar userId={report.author} accountsInfo={accountsInfo} size={24} onClick={onUserClick} />
                      <div className="flex flex-col">
                        {renderUsernameWithBadge(report.author, uInfo?.displayName, accountsInfo, "text-xs font-bold text-slate-800 dark:text-slate-200", onUserClick)}
                        <span className="text-[9px] text-slate-400">{getRelativeTime(report.timestamp)}</span>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteReport(report.id)} className="text-slate-400 hover:text-rose-500 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words pl-8 leading-relaxed">{report.text}</p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export {
  FriendsView,
  FriendDetailModal,
  ReportsModal
};