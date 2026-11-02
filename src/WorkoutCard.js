// ==========================================
// WorkoutCard.js — ワークアウトカード＆タイムライン画面コンポーネント
// ==========================================
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Clock, MapPin, Edit2, Trash2, MoreVertical, FileText, Scale, ListPlus, Copy, X, Dumbbell, Flame, Activity, Zap, AlignLeft, Heart, MessageCircle, ArrowDown, ArrowUp, Send, Plus } from 'lucide-react';
import { generateColor, calculateWorkoutTotals, formatShortDateTime, formatDuration, getVolumeMetaphor, getCategoryColor, getRelativeTime } from './utils';
import { UserAvatar, renderUsernameWithBadge } from './CommonUI';
import { copyTextToClipboard, triggerHaptic } from './nativeBridge';

// --- 共通コンポーネント：ワークアウトカード ---
function WorkoutCard({ post, currentUser, accountsInfo, onEdit, onDelete, onToggleLike, onImport, onImportItem, onAddComment, onDeleteComment, onToggleCommentLike, onUserClick }) {
  const [localComments, setLocalComments] = useState(post.comments || []);
  const [showComments, setShowComments] = useState(localComments.length > 0);
  const [commentText, setCommentText] = useState('');
  const [mentionQuery, setMentionQuery] = useState(null);
  const [replyingToId, setReplyingToId] = useState(null);
  const [expandedThreads, setExpandedThreads] = useState({});
  const textareaRef = useRef(null);
  const commentsContainerRef = useRef(null);

  useEffect(() => {
    setLocalComments(post.comments || []);
  }, [post.comments]);

  useEffect(() => {
    if (showComments && commentsContainerRef.current) {
      commentsContainerRef.current.scrollTop = commentsContainerRef.current.scrollHeight;
    }
  }, [showComments, localComments.length]);

  const handleReply = (username, parentId = null) => {
    if (parentId) {
      setReplyingToId(parentId);
      setExpandedThreads(prev => ({...prev, [parentId]: true}));
    }
    if (textareaRef.current) textareaRef.current.focus();
  };

  const handleDeleteLocalComment = (commentId) => {
    if (window.confirm("このコメントを削除しますか？")) {
      setLocalComments(prev => prev.filter(c => c.id !== commentId && c.parentId !== commentId));
      if (onDeleteComment) onDeleteComment(post.id, commentId);
    }
  };

  const toggleThread = (threadId) => {
    setExpandedThreads(prev => {
      const willExpand = !prev[threadId];
      if (willExpand) {
        setTimeout(() => {
          const threadEl = document.getElementById(`thread-${threadId}`);
          const container = commentsContainerRef.current;
          if (threadEl && container) {
             const scrollTarget = threadEl.offsetTop + threadEl.offsetHeight - container.clientHeight + 40;
             if (container.scrollTop < scrollTarget) {
                 container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
             }
          }
        }, 100);
      }
      return {...prev, [threadId]: willExpand};
    });
  };

  const handleCommentChange = (e) => {
    const text = e.target.value;
    setCommentText(text);
    const match = text.match(/@([a-zA-Z0-9_ぁ-んァ-ヶ一-龠]*)$/);
    if (match) {
      setMentionQuery(match[1]);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (username) => {
    const newText = commentText.replace(/@([a-zA-Z0-9_ぁ-んァ-ヶ一-龠]*)$/, `@${username} `);
    setCommentText(newText);
    setMentionQuery(null);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const submitComment = () => {
    if (!commentText.trim()) return;
    
    // 楽観的UI更新
    const newComment = {
      id: 'temp_' + Date.now(),
      author: currentUser,
      text: commentText.trim(),
      timestamp: Date.now(),
      likedUsers: [],
      parentId: replyingToId || null
    };
    setLocalComments(prev => [...prev, newComment]);

    if (onAddComment) {
      onAddComment(post.id, commentText, replyingToId || null);
      if (replyingToId) {
        setExpandedThreads(prev => ({...prev, [replyingToId]: true}));
      }
      setCommentText('');
      setMentionQuery(null);
      setReplyingToId(null);
    }
  };

  const handleCommentLike = (commentId) => {
    // 楽観的UI更新
    setLocalComments(prev => prev.map(c => {
      if (c.id === commentId) {
        const likedUsers = c.likedUsers || [];
        const isLiked = likedUsers.includes(currentUser);
        return { ...c, likedUsers: isLiked ? likedUsers.filter(u => u !== currentUser) : [...likedUsers, currentUser] };
      }
      return c;
    }));
    if (onToggleCommentLike) onToggleCommentLike(post.id, commentId);
  };

  const myFriendsList = accountsInfo[currentUser]?.friends || [];
  const mentionCandidates = mentionQuery !== null ? Object.entries(accountsInfo).filter(([uname, data]) => 
    myFriendsList.includes(uname) && (uname.includes(mentionQuery) || (data.displayName && data.displayName.includes(mentionQuery)))
  ) : [];

  const renderCommentText = (text) => {
    const parts = text.split(/(@[a-zA-Z0-9_ぁ-んァ-ヶ一-龠]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const username = part.substring(1);
        const userExists = Object.keys(accountsInfo).includes(username) || Object.values(accountsInfo).some(u => u.displayName === username);
        if (userExists) {
          return <span key={i} className="text-emerald-500 font-bold">{part}</span>;
        }
      }
      return <span key={i}>{part}</span>;
    });
  };
  const [showLikesModal, setShowLikesModal] = useState(false);
  const [showPostMenu, setShowPostMenu] = useState(false);
  const postMenuRef = useRef(null);

  useEffect(() => {
    if (!showPostMenu) return;
    const handleOutside = (e) => {
      if (postMenuRef.current && !postMenuRef.current.contains(e.target)) {
        setShowPostMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showPostMenu]);
  const isMyPost = post.author === currentUser;
  
  const likedUsers = post.likedUsers || [];
  const isCurrentlyLiked = likedUsers.includes(currentUser);
  const displayLikesCount = Math.max(post.likes || 0, likedUsers.length);
  const authorInfo = accountsInfo && accountsInfo[post.author];
  const hideMetrics = !isMyPost && authorInfo?.hideBodyMetrics;
  
  const authorColor = authorInfo?.userColor || (post.author ? generateColor(post.author) : '#10b981');

  const baseWeight = Number(post.bodyWeight) || Number(authorInfo?.weight) || 60;
  const { processedItems, totalVolume, totalCalories } = useMemo(() => {
      return calculateWorkoutTotals(post.items || [], post.duration, baseWeight);
  }, [post.items, post.duration, baseWeight]);

  const displayVolumeCalc = (!post.items || post.items.length === 0) ? 0 : ((post.volume && post.volume > 0) ? post.volume : totalVolume);
  const displayCalories = (!post.items || post.items.length === 0) ? 0 : ((post.calories && post.calories > 0) ? post.calories : totalCalories);
  const displaySets = post.totalSets || processedItems.reduce((acc, it) => acc + (it.sets?.length || 0), 0);
  
  const categoryCounts = {};
  processedItems.forEach(item => {
    if (item.category) {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + (item.sets?.length || 0);
    }
  });
  const categories = Object.keys(categoryCounts).sort((a, b) => categoryCounts[b] - categoryCounts[a]);

  const handleExportText = () => {
    const d = new Date(post.timestamp);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${days[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    
    let text = `【トレーニング記録】\n`;
    text += `日時: ${dateStr}\n`;
    if (post.gymName) text += `場所: ${post.gymName}\n`;
    if (post.bodyWeight || post.bodyFat) {
        text += `体組成: `;
        if (post.bodyWeight) text += `${post.bodyWeight}kg `;
        if (post.bodyFat) text += `${post.bodyFat}%`;
        text += `\n`;
    }
    if (displayVolumeCalc > 0) text += `総負荷量: ${displayVolumeCalc.toLocaleString()}kg\n`;
    if (displayCalories > 0) text += `総消費: ${displayCalories.toLocaleString()} kcal\n`;
    text += `\n`;

    processedItems.forEach((item, idx) => {
        text += `■ ${idx + 1}. ${item.exerciseName}`;
        if (item.category) text += ` [${item.category}]`;
        text += `\n`;
        
        if (item.isSuperSet && item.superExerciseName) {
            text += `  スーパー: ${item.superExerciseName}\n`;
            if (item.superExerciseName3) text += `  ジャイアント: ${item.superExerciseName3}\n`;
        }

        const getSetText = (setObj, wType, type, isDrop, prefix) => {
            const isCardio = wType === 'cardio';
            const isLR = wType === 'lr';
            
            const val = (f) => {
              let fieldName = f;
              if (type === 'super2') fieldName = 'super' + f.charAt(0).toUpperCase() + f.slice(1);
              if (type === 'super3') fieldName = 'super' + f.charAt(0).toUpperCase() + f.slice(1) + '3';
              return setObj[fieldName] || '';
            };

            if (isCardio) {
                const distance = val('distance');
                const time = val('time');
                const calories = val('calories');
                if (!distance && !time && !calories) return null;
                let t = `${prefix} `;
                if (distance) t += `${distance}km `;
                if (time) t += `${time}分 `;
                if (calories) t += `${calories}kcal `;
                return t.trim() + '\n';
            }

            const weight = val('weight');
            const reps = val('reps');
            const lReps = val('lReps');
            const rReps = val('rReps');
            const forcedReps = val('forcedReps');

            if (!weight && !reps && !lReps && !rReps) return null;

            let displayWeight = weight || 0;
            let weightLabel = 'kg';
            if (wType === 'plate') weightLabel = '枚';
            else if (wType === 'oneSide') weightLabel = 'kg(片)';
            else if (wType === 'bodyWeight') {
                if (Number(weight) < 0) { displayWeight = weight; weightLabel = 'kg'; } 
                else if (Number(weight) > 0) { displayWeight = `+${weight}`; weightLabel = 'kg'; } 
                else { displayWeight = '自重'; weightLabel = ''; }
            }

            let t = `${prefix} ${displayWeight}${weightLabel} x `;
            if (isLR) {
                t += `L:${lReps||0} R:${rReps||0}回`;
            } else {
                t += `${reps||0}回`;
            }
            if (forcedReps) t += ` (+補助${forcedReps})`;
            return t + '\n';
        };

        if (item.sets && Array.isArray(item.sets)) {
            item.sets.forEach((set, sIdx) => {
                const mainText = getSetText(set, item.weightType, 'main', false, `Set ${sIdx + 1}:`);
                if (mainText) text += `  ${mainText}`;
                
                if (item.isDropSet && set.dropSets) {
                    set.dropSets.forEach((ds, dsIdx) => {
                        const dropText = getSetText(ds, item.weightType, 'main', true, `   ↳ Drop:`);
                        if (dropText) text += `  ${dropText}`;
                    });
                }
                
                if (item.isSuperSet && item.superExerciseName) {
                    const sup2Text = getSetText(set, item.superWeightType || 'total', 'super2', false, `   ↳ Sup2:`);
                    if (sup2Text) text += `  ${sup2Text}`;
                    
                    if (item.isDropSet && set.dropSets && !set.superDropSets) {
                        set.dropSets.forEach((ds, dsIdx) => {
                            if (ds.superWeight !== undefined) {
                                const dsSup2Text = getSetText(ds, item.superWeightType || 'total', 'super2', true, `     ↳ Drop2:`);
                                if (dsSup2Text) text += `    ${dsSup2Text}`;
                            }
                        });
                    }
                    if (item.isDropSet && set.superDropSets) {
                        set.superDropSets.forEach((ds, dsIdx) => {
                            const dsSup2Text = getSetText(ds, item.superWeightType || 'total', 'super2', true, `     ↳ Drop2:`);
                            if (dsSup2Text) text += `    ${dsSup2Text}`;
                        });
                    }
                }

                if (item.isSuperSet && item.superExerciseName3) {
                    const sup3Text = getSetText(set, item.superWeightType3 || 'total', 'super3', false, `   ↳ Sup3:`);
                    if (sup3Text) text += `  ${sup3Text}`;
                    
                    if (item.isDropSet && set.dropSets && !set.superDropSets3) {
                        set.dropSets.forEach((ds, dsIdx) => {
                            if (ds.superWeight3 !== undefined) {
                                const dsSup3Text = getSetText(ds, item.superWeightType3 || 'total', 'super3', true, `     ↳ Drop3:`);
                                if (dsSup3Text) text += `    ${dsSup3Text}`;
                            }
                        });
                    }
                    if (item.isDropSet && set.superDropSets3) {
                        set.superDropSets3.forEach((ds, dsIdx) => {
                            const dsSup3Text = getSetText(ds, item.superWeightType3 || 'total', 'super3', true, `     ↳ Drop3:`);
                            if (dsSup3Text) text += `    ${dsSup3Text}`;
                        });
                    }
                }
            });
        }
        if (item.memo) text += `  メモ: ${item.memo}\n`;
        text += `\n`;
    });

    copyTextToClipboard(text).then(() => {
        alert("テキストをクリップボードにコピーしました！");
    }).catch(err => {
        alert("コピーに失敗しました。");
    });
    setShowPostMenu(false);
  };

  const renderSetRow = (setObj, wType, type, isDrop, label) => {
    // 統一レイアウト: 全ての行（通常/LR/プレート/片側/自重/有酸素、メイン/スーパー/ドロップ）で
    // 「ラベル列（固定幅）＋ 数値ライン＋ バッジライン ＋ 1RMライン」の同じ骨格を使う。
    // PRバッジは専用ラインに置くため、バッジの有無で数値の位置が一切ずれない。
    const isLR = wType === 'lr';
    const isPlate = wType === 'plate';
    const isBodyWeight = wType === 'bodyWeight';
    const isCardio = wType === 'cardio';

    const val = (f) => {
      let fieldName = f;
      if (type === 'super2') fieldName = 'super' + f.charAt(0).toUpperCase() + f.slice(1);
      if (type === 'super3') fieldName = 'super' + f.charAt(0).toUpperCase() + f.slice(1) + '3';
      return setObj[fieldName] || '';
    };

    // ラベル色とインデントは行単位で統一（ドロップ=オレンジ、スーパー=紫、メイン=グレー）
    let labelColorClass = 'text-slate-500 dark:text-slate-400';
    if (isDrop) labelColorClass = 'text-orange-500';
    else if (type !== 'main') labelColorClass = 'text-purple-500 dark:text-purple-400';
    const indentClass = (isDrop || type !== 'main') ? 'pl-4' : '';

    if (isCardio) {
      const distance = val('distance');
      const time = val('time');
      const calories = val('calories');
      if (!distance && !time && !calories) return null;
      return (
        <div className={`flex items-start border-b border-slate-200/50 dark:border-slate-800/50 py-2 last:border-0 ${indentClass}`}>
          <span className={`font-bold w-14 text-xs shrink-0 pt-0.5 ${labelColorClass}`}>{label}</span>
          <div className="flex-1 min-w-0 flex flex-wrap justify-center items-baseline gap-x-3 gap-y-0.5 px-1">
            {distance && <span className="font-bold text-[15px] text-slate-800 dark:text-slate-100 whitespace-nowrap">{distance}<span className="text-[10px] font-normal text-slate-400 ml-0.5">km</span></span>}
            {time && <span className="font-bold text-[15px] text-slate-800 dark:text-slate-100 whitespace-nowrap">{time}<span className="text-[10px] font-normal text-slate-400 ml-0.5">分</span></span>}
            {calories && <span className="font-bold text-[15px] text-slate-800 dark:text-slate-100 whitespace-nowrap">{calories}<span className="text-[10px] font-normal text-slate-400 ml-0.5">kcal</span></span>}
          </div>
        </div>
      );
    }

    const weight = val('weight');
    const reps = val('reps');
    const lReps = val('lReps');
    const rReps = val('rReps');
    const forcedReps = val('forcedReps');

    if (!weight && !reps && !lReps && !rReps) return null;

    const forced = forcedReps ? <span className="text-rose-500 text-xs ml-1 whitespace-nowrap">(+{forcedReps})</span> : null;
    const showBadges = type === 'main' && (setObj.isWeightPR || setObj.isRepsPR);

    let displayWeight = weight || 0;
    let weightLabel = 'kg';

    if (isPlate) weightLabel = '枚';
    else if (wType === 'oneSide') weightLabel = 'kg(片)';
    else if (isBodyWeight) {
      if (Number(weight) < 0) { displayWeight = weight; weightLabel = 'kg'; }
      else if (Number(weight) > 0) { displayWeight = `+${weight}`; weightLabel = 'kg'; }
      else { displayWeight = '自重'; weightLabel = ''; }
    }

    let rmTextNode = null;
    if (weight && wType !== 'bodyWeight') {
      const currentReps = isLR ? Math.max(Number(lReps) || 0, Number(rReps) || 0) : (Number(reps) || 0);
      const wNum = Number(weight);
      if (wNum > 0 && currentReps > 0) {
        const rm = Math.round((wNum * (1 + currentReps / 40)) * 10) / 10;
        rmTextNode = <div className="text-[10px] text-slate-400 font-bold text-center mt-0.5">推定1RM: {rm}kg</div>;
      }
    }

    return (
      <div className={`flex items-start border-b border-slate-200/50 dark:border-slate-800/50 py-2 last:border-0 ${indentClass}`}>
        <span className={`font-bold w-14 text-xs shrink-0 pt-0.5 ${labelColorClass}`}>{label}</span>
        <div className="flex-1 min-w-0 px-1">
          {/* 数値ライン: 重量スロットと回数スロットは全行で固定幅。バッジでは絶対にずれない */}
          <div className="flex justify-center items-baseline gap-2">
            <span className="inline-flex items-baseline justify-end gap-0.5 min-w-[58px]">
              <span className="font-bold text-[15px] sm:text-base tracking-wide text-slate-800 dark:text-slate-100">{displayWeight}</span>
              {weightLabel && <span className="text-[10px] font-normal text-slate-400">{weightLabel}</span>}
            </span>
            <span className="text-slate-300 dark:text-slate-600 font-bold">×</span>
            <span className="inline-flex items-baseline justify-start gap-0.5 min-w-[66px]">
              {isLR ? (
                <span className="font-bold text-[13px] tracking-tight text-slate-800 dark:text-slate-100 whitespace-nowrap">L:{lReps || 0} R:{rReps || 0}</span>
              ) : (
                <span className="font-bold text-[15px] sm:text-base tracking-wide text-slate-800 dark:text-slate-100">{reps || 0}</span>
              )}
              <span className="text-[10px] font-normal text-slate-400">回</span>
              {forced}
            </span>
          </div>
          {/* バッジライン: PRバッジ専用の行。数値ラインとは分離し、両方同時表示もここに並ぶ */}
          {showBadges && (
            <div className="flex justify-center flex-wrap gap-1 mt-1">
              {setObj.isWeightPR && <span className="text-[10px] text-amber-500 bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-900 font-bold whitespace-nowrap">🏆重量更新</span>}
              {setObj.isRepsPR && <span className="text-[10px] text-blue-500 bg-blue-50 dark:bg-blue-950/50 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-900 font-bold whitespace-nowrap">🎖️回数更新</span>}
            </div>
          )}
          {rmTextNode}
        </div>
      </div>
    );
  };

  const hasWorkoutStats = displaySets > 0 || displayVolumeCalc > 0 || displayCalories > 0;
  const hasBodyMetrics = Boolean(post.bodyWeight || post.bodyFat);
  const lbmValue = (!hideMetrics && post.bodyWeight && post.bodyFat)
    ? (Number(post.bodyWeight) * (1 - Number(post.bodyFat) / 100)).toFixed(1)
    : null;

  const volumeText = Number(displayVolumeCalc).toLocaleString();
  const caloriesText = Number(displayCalories).toLocaleString();
  const setsText = String(displaySets);
  // 桁数の多い数値はフォントを段階的に小さくする（3カラムグリッドからのはみ出し防止）
  const metricValueClass = (formatted) => {
    const len = String(formatted).length;
    if (len >= 8) return 'text-[15px] sm:text-base';
    if (len >= 7) return 'text-base sm:text-lg';
    return 'text-lg sm:text-xl';
  };

  return (
    <div id={`post-${post.id}`} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm overflow-hidden relative mb-4">
      <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: authorColor }}></div>
      <div className="flex justify-between items-start mb-4 pl-3">
        <div className="flex items-start gap-3 w-full overflow-hidden">
          {post.jointWith ? (
            <div className="relative w-12 h-10 shrink-0">
              <UserAvatar userId={post.author} accountsInfo={accountsInfo} size={32} className="absolute top-0 left-0 z-10" onClick={onUserClick} />
              <UserAvatar userId={post.jointWith} accountsInfo={accountsInfo} size={32} className="absolute bottom-0 right-0 z-0 border-white dark:border-slate-900 border-2" onClick={onUserClick} />
            </div>
          ) : (
            <UserAvatar userId={post.author} accountsInfo={accountsInfo} size={40} onClick={onUserClick} />
          )}
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              {renderUsernameWithBadge(post.author, authorInfo?.displayName, accountsInfo, undefined, onUserClick)}
              {post.jointWith && (
                <>
                  <span className="text-[10px] font-bold text-slate-400 shrink-0">&</span>
                  {renderUsernameWithBadge(post.jointWith, accountsInfo?.[post.jointWith]?.displayName, accountsInfo, undefined, onUserClick)}
                </>
              )}
            </div>
            <div className="flex flex-col gap-1.5 mt-1">
              <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-slate-400 font-bold">
                <span>{formatShortDateTime(post.timestamp)}</span>
                {post.duration && <span className="flex items-center gap-0.5"><Clock size={12}/> {formatDuration(post.duration)}</span>}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {post.gymName && <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-100 dark:border-emerald-900"><MapPin size={10}/> {post.gymName}</span>}
                {categories.map(cat => (
                  <span key={cat} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getCategoryColor(cat)}`}>
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        {isMyPost && onEdit && onDelete && (
          <div ref={postMenuRef} className="flex gap-1 shrink-0 ml-2 relative">
            <button onClick={() => onEdit(post)} className="text-slate-400 hover:text-emerald-500 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"><Edit2 size={16} /></button>
            <button onClick={() => onDelete(post.id)} className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"><Trash2 size={16} /></button>
            <button onClick={() => setShowPostMenu(!showPostMenu)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"><MoreVertical size={16} /></button>
            
            {showPostMenu && (
               <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg z-20 w-48 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                  <button onClick={handleExportText} className="w-full text-left px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2">
                     <FileText size={16} className="text-slate-400" />
                     テキストで出力してコピー
                  </button>
               </div>
            )}
          </div>
        )}
      </div>

      {/* 種目の上のサマリーダッシュボード（体組成グラフのサマリーカードと同じ見やすくスタイリッシュなUI） */}
      {(hasWorkoutStats || hasBodyMetrics) && (
        <div className="ml-3 mb-4 bg-slate-50/95 dark:bg-slate-950/75 border border-slate-200/80 dark:border-slate-800/90 rounded-2xl p-3.5 space-y-3 shadow-sm">
          {/* ワークアウト統計セクション（総負荷量・セット数・消費カロリー） */}
          {hasWorkoutStats && (
            <div>
              {/* 3カラムメトリクスグリッド */}
              <div className="grid grid-cols-3 divide-x divide-slate-200/70 dark:divide-slate-800 text-center">
                <div className="px-1 flex flex-col items-center justify-center">
                  <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-0.5 flex items-center gap-1 whitespace-nowrap">
                    <Dumbbell size={11} className="text-emerald-500 shrink-0" />
                    <span>総負荷量</span>
                  </div>
                  <div className="flex items-baseline justify-center gap-0.5 whitespace-nowrap">
                    <span className={`${metricValueClass(volumeText)} font-black tracking-tight font-mono text-emerald-600 dark:text-emerald-400 leading-tight`}>
                      {volumeText}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">kg</span>
                  </div>
                </div>

                <div className="px-1 flex flex-col items-center justify-center">
                  <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-0.5 flex items-center gap-1 whitespace-nowrap">
                    <ListPlus size={11} className="text-blue-500 shrink-0" />
                    <span>セット数</span>
                  </div>
                  <div className="flex items-baseline justify-center gap-0.5 whitespace-nowrap">
                    <span className={`${metricValueClass(setsText)} font-black tracking-tight font-mono text-slate-800 dark:text-slate-100 leading-tight`}>
                      {setsText}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">set</span>
                    {processedItems.length > 0 && (
                      <span className="text-[10px] font-bold text-slate-400 ml-0.5">({processedItems.length}種)</span>
                    )}
                  </div>
                </div>

                <div className="px-1 flex flex-col items-center justify-center">
                  <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-0.5 flex items-center gap-1 whitespace-nowrap">
                    <Flame size={11} className="text-amber-500 shrink-0" />
                    <span>消費カロリー</span>
                  </div>
                  <div className="flex items-baseline justify-center gap-0.5 whitespace-nowrap">
                    <span className={`${metricValueClass(caloriesText)} font-black tracking-tight font-mono text-amber-600 dark:text-amber-400 leading-tight`}>
                      {caloriesText}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">kcal</span>
                  </div>
                </div>
              </div>

              {/* フッター：負荷量メタファー＆構成コピーボタン（数値グリッドの下に置く） */}
              {(displayVolumeCalc > 0 || (onImport && post.items && post.items.length > 0)) && (
                <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_6px_rgba(16,185,129,0.7)]"></span>
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 truncate">
                      {displayVolumeCalc > 0 ? getVolumeMetaphor(displayVolumeCalc) : 'ワークアウトサマリー'}
                    </span>
                  </div>
                  {onImport && post.items && post.items.length > 0 && (
                    <div className="relative shrink-0 ml-auto">
                      <button
                        type="button"
                        onClick={() => onImport(post, false)}
                        className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/70 transition-colors border border-emerald-200/80 dark:border-emerald-800/80 shadow-sm"
                      >
                        <Copy size={12} /> 構成コピー
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 体組成データセクション（体重・体脂肪率・除脂肪体重LBM） */}
          {hasBodyMetrics && (
            <div className={hasWorkoutStats ? "pt-2.5 border-t border-slate-200/70 dark:border-slate-800" : ""}>
              {hideMetrics ? (
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                    <Scale size={14} /> 体組成データ
                  </span>
                  <span className="text-xs font-bold text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-800">
                    ないしょ♡
                  </span>
                </div>
              ) : (
                <div className={`grid ${lbmValue ? 'grid-cols-3' : (post.bodyWeight && post.bodyFat ? 'grid-cols-2' : 'grid-cols-1')} divide-x divide-slate-200/70 dark:divide-slate-800 text-center`}>
                  {post.bodyWeight && (
                    <div className="px-1 flex flex-col items-center justify-center">
                      <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-0.5 flex items-center gap-1 whitespace-nowrap">
                        <Scale size={11} className="text-emerald-500 shrink-0" />
                        <span>体重</span>
                      </div>
                      <div className="flex items-baseline justify-center gap-0.5 whitespace-nowrap">
                        <span className="text-base sm:text-lg font-black tracking-tight font-mono text-slate-800 dark:text-slate-100 leading-tight">
                          {Number(post.bodyWeight).toFixed(1)}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">kg</span>
                      </div>
                    </div>
                  )}
                  {post.bodyFat && (
                    <div className="px-1 flex flex-col items-center justify-center">
                      <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-0.5 flex items-center gap-1 whitespace-nowrap">
                        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0"></span>
                        <span>体脂肪率</span>
                      </div>
                      <div className="flex items-baseline justify-center gap-0.5 whitespace-nowrap">
                        <span className="text-base sm:text-lg font-black tracking-tight font-mono text-blue-600 dark:text-blue-400 leading-tight">
                          {Number(post.bodyFat).toFixed(1)}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">%</span>
                      </div>
                    </div>
                  )}
                  {lbmValue && (
                    <div className="px-1 flex flex-col items-center justify-center">
                      <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-0.5 flex items-center gap-1 whitespace-nowrap">
                        <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0"></span>
                        <span>除脂肪体重</span>
                      </div>
                      <div className="flex items-baseline justify-center gap-0.5 whitespace-nowrap">
                        <span className="text-base sm:text-lg font-black tracking-tight font-mono text-cyan-600 dark:text-cyan-400 leading-tight">
                          {lbmValue}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">kg</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <div className="pl-3 mb-4 flex overflow-x-auto snap-x snap-mandatory gap-3 pb-2 pr-3 hide-scrollbar">
        {processedItems.map((item, idx) => (
          <div key={idx} className="snap-center shrink-0 w-[85%] sm:w-[280px] bg-slate-50 dark:bg-slate-950/50 rounded-xl p-3 border border-slate-100 dark:border-slate-800 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {item.category === '有酸素' ? <Activity size={14} className="text-cyan-500 shrink-0"/> : <Dumbbell size={14} className="text-emerald-500 shrink-0" />}
                  <span className="font-bold text-slate-800 dark:text-slate-100 text-[15px] truncate">{item.exerciseName}</span>
                  {item.category && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${getCategoryColor(item.category)}`}>{item.category}</span>}
                  {item.itemVolume > 0 && <span className="text-xs font-bold text-slate-500 dark:text-slate-400 ml-auto shrink-0">{item.itemVolume.toLocaleString()}kg</span>}
                </div>
                {item.isSuperSet && item.superExerciseName && (
                  <div className="flex items-center gap-2 flex-wrap pl-5">
                    <Zap size={14} className="text-blue-400 shrink-0"/>
                    <span className="font-bold text-blue-600 dark:text-blue-400 text-sm truncate">{item.superExerciseName}</span>
                  </div>
                )}
                {item.isSuperSet && item.superExerciseName3 && (
                  <div className="flex items-center gap-2 flex-wrap pl-5">
                    <Zap size={14} className="text-blue-400 shrink-0"/>
                    <span className="font-bold text-blue-600 dark:text-blue-400 text-sm truncate">{item.superExerciseName3}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 flex-1">
              {item.sets && Array.isArray(item.sets) && item.sets.map((set, sIdx) => (
                <div key={sIdx} className="bg-white/40 dark:bg-slate-900/40 p-2 rounded-lg border border-slate-200/40 dark:border-slate-800/40">
                  {renderSetRow(set, item.weightType, 'main', false, `set ${sIdx + 1}`)}
                  
                  {item.isDropSet && set.dropSets && set.dropSets.map((ds, dsIdx) => (
                    renderSetRow(ds, item.weightType, 'main', true, '↳ drop')
                  ))}
                  
                  {item.isSuperSet && item.superExerciseName && (
                    <>
                      {renderSetRow(set, item.superWeightType || 'total', 'super2', false, '↳ Sup2')}
                      {item.isDropSet && set.dropSets && !set.superDropSets && set.dropSets.map((ds, dsIdx) => (
                        ds.superWeight !== undefined ? renderSetRow(ds, item.superWeightType || 'total', 'super2', true, '↳ drop2') : null
                      ))}
                      {item.isDropSet && set.superDropSets && set.superDropSets.map((ds, dsIdx) => (
                        renderSetRow(ds, item.superWeightType || 'total', 'super2', true, '↳ drop2')
                      ))}
                    </>
                  )}

                  {item.isSuperSet && item.superExerciseName3 && (
                    <>
                      {renderSetRow(set, item.superWeightType3 || 'total', 'super3', false, '↳ Sup3')}
                      {item.isDropSet && set.dropSets && !set.superDropSets3 && set.dropSets.map((ds, dsIdx) => (
                        ds.superWeight3 !== undefined ? renderSetRow(ds, item.superWeightType3 || 'total', 'super3', true, '↳ drop3') : null
                      ))}
                      {item.isDropSet && set.superDropSets3 && set.superDropSets3.map((ds, dsIdx) => (
                        renderSetRow(ds, item.superWeightType3 || 'total', 'super3', true, '↳ drop3')
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>

            {item.memo && (
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800">
                <AlignLeft size={12} className="inline mr-1 text-slate-400"/>{item.memo}
              </div>
            )}

            {onImportItem && item.exerciseName && (
              <button
                type="button"
                onClick={() => onImportItem(post.items?.[idx] || item, post)}
                className="mt-3 w-full py-2 px-3 rounded-lg border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/40 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus size={14} /> この種目を現在の記録に追加
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pl-3 mt-4 mb-2">
        <div className="flex items-center gap-1.5">
          <button onClick={() => !isMyPost && onToggleLike(post.id, displayLikesCount, isCurrentlyLiked, likedUsers)} disabled={isMyPost} className={`transition-transform active:scale-90 ${isCurrentlyLiked ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
            <Heart size={26} fill={isCurrentlyLiked ? "currentColor" : "none"} className={isCurrentlyLiked && !isMyPost ? "animate-pulse" : ""} />
          </button>
          {displayLikesCount > 0 ? (
            <button onClick={() => setShowLikesModal(true)} className="text-sm font-bold text-slate-800 dark:text-slate-200 hover:opacity-70">
              {displayLikesCount} ナイス!
            </button>
          )  : null}
        </div>
        <div className="flex items-center gap-1.5 pr-4">
          <button onClick={() => { if (showComments) { setShowComments(false); } else { setShowComments(true); setTimeout(() => textareaRef.current?.focus(), 100); } }} className="text-slate-800 dark:text-slate-200 transition-transform active:scale-90 hover:text-slate-500">
            <MessageCircle size={26} />
          </button>
          {localComments.length > 0 && (
            <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{localComments.length}</span>
          )}
        </div>
      </div>
      {showComments && (
        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800 animate-in fade-in duration-200">
          {(() => {
            const rootComments = localComments.filter(c => !c.parentId);
            
            const renderComment = (comment, isReply = false, rootId = null) => {
              const cInfo = accountsInfo[comment.author];
              const cLikedUsers = comment.likedUsers || [];
              const isCLiked = cLikedUsers.includes(currentUser);
              const cLikesCount = cLikedUsers.length;
              const currentRootId = rootId || comment.id;

              return (
                <div key={comment.id} className="flex gap-2.5">
                  <UserAvatar userId={comment.author} accountsInfo={accountsInfo} size={32} className="mt-1" onClick={onUserClick} />
                  <div className="flex-1 group min-w-0">
                    <div className="flex items-stretch gap-2">
                      <div className="bg-slate-50 dark:bg-slate-950/50 p-2.5 rounded-2xl rounded-tl-none border border-slate-100 dark:border-slate-800 relative inline-block max-w-[85%]">
                        <div className="flex items-baseline gap-2 mb-1">
                          {renderUsernameWithBadge(comment.author, cInfo?.displayName, accountsInfo, "font-bold text-xs text-slate-800 dark:text-slate-200", onUserClick)}
                          <span className="text-[10px] text-slate-400 shrink-0">{getRelativeTime(comment.timestamp)}</span>
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{renderCommentText(comment.text)}</p>
                      </div>
                      <div className="flex flex-col justify-between py-1 shrink-0">
                        <div>
                          {(comment.author === currentUser || post.author === currentUser) && onDeleteComment && (
                            <button onClick={() => handleDeleteLocalComment(comment.id)} className="p-1 text-slate-300 hover:text-rose-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity -mt-1">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        <div className="mt-auto">
                          <button onClick={() => handleCommentLike(comment.id)} className={`flex items-center gap-1 text-[11px] font-bold transition-colors ${isCLiked ? 'text-rose-500' : 'text-slate-400 hover:text-rose-500'}`}>
                            <Heart size={14} fill={isCLiked ? "currentColor" : "none"} className={isCLiked ? "animate-pulse" : ""} />
                            {cLikesCount > 0 && <span>{cLikesCount}</span>}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="pl-2 mt-1">
                      <button onClick={() => handleReply(comment.author, currentRootId)} className="text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                        返信
                      </button>
                    </div>
                  </div>
                </div>
              );
            };

            return rootComments.length > 0 && (
              <div ref={commentsContainerRef} className="space-y-3 mb-3 max-h-80 overflow-y-auto pr-1 relative">
                {rootComments.map(rootComment => {
                  const replies = localComments.filter(c => c.parentId === rootComment.id);
                  const isExpanded = expandedThreads[rootComment.id];
                  
                  return (
                    <div key={rootComment.id} className="space-y-3">
                      {renderComment(rootComment, false, rootComment.id)}
                      
                      {replies.length > 0 && (
                        <div id={`thread-${rootComment.id}`} className="ml-10 space-y-3 border-l-2 border-slate-100 dark:border-slate-800 pl-3">
                          {!isExpanded ? (
                            <button onClick={() => toggleThread(rootComment.id)} className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 hover:underline">
                              <ArrowDown size={12}/> {replies.length}件の返信を表示
                            </button>
                          ) : (
                            <>
                              {replies.map(reply => renderComment(reply, true, rootComment.id))}
                              <button onClick={() => toggleThread(rootComment.id)} className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1 hover:underline mt-1">
                                <ArrowUp size={12}/> 返信を閉じる
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <div className="relative flex gap-2 items-end">
            {mentionQuery !== null && mentionCandidates.length > 0 && (
              <div className="absolute bottom-full left-0 w-full mb-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg max-h-40 overflow-y-auto z-10">
                {mentionCandidates.map(([uname, data]) => (
                  <div key={uname} onClick={() => insertMention(uname)} className="px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-2">
                    <UserAvatar userId={uname} accountsInfo={accountsInfo} size={24} />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{data.displayName || uname}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex-1 flex flex-col min-w-0">
              {replyingToId && (
                <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-t-2xl text-[11px] font-bold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 border-b-0">
                  <span>{(() => {
                    const parentComment = localComments.find(c => c.id === replyingToId);
                    const pUser = parentComment ? (accountsInfo[parentComment.author]?.displayName || parentComment.author) : '';
                    return pUser ? `${pUser} に返信中...` : '返信中...';
                  })()}</span>
                  <button onClick={() => setReplyingToId(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={14}/></button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={commentText}
                onChange={handleCommentChange}
                placeholder={replyingToId ? "返信を入力..." : "コメントを追加... (@でメンション)"}
                className={`w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 py-2 px-3 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500 resize-none min-h-[40px] max-h-24 ${replyingToId ? 'rounded-b-2xl border-t-0' : 'rounded-2xl'}`}
                style={{ fontSize: '16px' }}
                rows={1}
              />
            </div>
            <button onClick={submitComment} disabled={!commentText.trim()} className={`bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white p-2 flex items-center justify-center transition-colors h-10 w-10 shrink-0 ${replyingToId ? 'rounded-xl mb-0.5' : 'rounded-xl'}`}>
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      {showLikesModal && (
        <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setShowLikesModal(false)}>
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-slate-800 dark:text-slate-100">ナイスしたユーザー</h3>
              <button onClick={() => setShowLikesModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 bg-slate-100 dark:bg-slate-800 rounded-full"><X size={20}/></button>
            </div>
            <div className="p-2 overflow-y-auto space-y-1">
              {likedUsers.length > 0 ? (
                likedUsers.map(u => {
                  const uInfo = accountsInfo && accountsInfo[u];
                  return (
                    <div key={u} className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition-colors">
                      <UserAvatar userId={u} accountsInfo={accountsInfo} size={40} onClick={(uid) => { setShowLikesModal(false); onUserClick && onUserClick(uid); }} />
                      <span className="font-bold text-slate-800 dark:text-slate-200 text-sm cursor-pointer" onClick={() => { setShowLikesModal(false); onUserClick && onUserClick(u); }}>{uInfo?.displayName || u}</span>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 text-center text-slate-500 text-sm font-bold">誰かがナイスしています</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- タイムライン画面（画面追従＆シンプル円形スピナー Pull-to-Refresh） ---
function TimelineView({ posts, onToggleLike, onImport, onImportItem, currentUser, onDelete, onEdit, accountsInfo, onAddComment, onDeleteComment, onToggleCommentLike, onUserClick, scrollToPostId, setScrollToPostId, onRefresh }) {
  const [displayLimit, setDisplayLimit] = useState(10);
  const [pullOffset, setPullOffset] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullRef = useRef({ active: false, startY: 0, startX: 0, lockedHorizontal: false, triggeredHaptic: false, currentOffset: 0 });
  const PULL_THRESHOLD = 52;

  useEffect(() => {
    if (scrollToPostId) {
       const postIndex = posts.findIndex(p => p.id === scrollToPostId);
       if (postIndex !== -1 && postIndex >= displayLimit) {
           setDisplayLimit(postIndex + 5);
       }
       setTimeout(() => {
         const postEl = document.getElementById(`post-${scrollToPostId}`);
         if (postEl) {
            const headerOffset = 80;
            const elementPosition = postEl.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
            window.scrollTo({
                 top: offsetPosition,
                 behavior: 'smooth'
            });
         }
         if (setScrollToPostId) setScrollToPostId(null);
       }, 300);
    }
  }, [scrollToPostId, posts, displayLimit, setScrollToPostId]);

  const handleTouchStart = (e) => {
    if (isRefreshing || !e.touches || e.touches.length !== 1) return;
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    if (scrollTop <= 2) {
      pullRef.current = {
        active: true,
        startY: e.touches[0].clientY,
        startX: e.touches[0].clientX,
        lockedHorizontal: false,
        triggeredHaptic: false,
        currentOffset: 0
      };
    } else {
      pullRef.current.active = false;
    }
  };

  const handleTouchMove = (e) => {
    if (!pullRef.current.active || isRefreshing || !e.touches || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - pullRef.current.startY;
    const dx = Math.abs(e.touches[0].clientX - pullRef.current.startX);

    if (!pullRef.current.lockedHorizontal && dx > 12 && dx > Math.abs(dy)) {
      pullRef.current.lockedHorizontal = true;
      pullRef.current.active = false;
      setIsPulling(false);
      setPullOffset(0);
      return;
    }

    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    if (scrollTop > 4 && pullRef.current.currentOffset === 0) {
      pullRef.current.active = false;
      return;
    }

    if (dy > 0) {
      if (e.cancelable) e.preventDefault();
      // 指の動きに滑らかに追従するラバーバンド減衰
      const damped = Math.min(92, dy * 0.48);
      pullRef.current.currentOffset = damped;
      if (!isPulling) setIsPulling(true);
      setPullOffset(damped);

      if (damped >= PULL_THRESHOLD && !pullRef.current.triggeredHaptic) {
        pullRef.current.triggeredHaptic = true;
        triggerHaptic('medium');
      } else if (damped < PULL_THRESHOLD && pullRef.current.triggeredHaptic) {
        pullRef.current.triggeredHaptic = false;
      }
    } else if (pullRef.current.currentOffset > 0) {
      pullRef.current.currentOffset = 0;
      setPullOffset(0);
    }
  };

  const handleTouchEnd = async () => {
    if (!pullRef.current.active) return;
    pullRef.current.active = false;
    setIsPulling(false);
    const finalOffset = pullRef.current.currentOffset;
    pullRef.current.currentOffset = 0;

    if (finalOffset >= PULL_THRESHOLD && onRefresh && !isRefreshing) {
      setIsRefreshing(true);
      setPullOffset(44);
      try {
        await onRefresh();
      } finally {
        setTimeout(() => {
          setIsRefreshing(false);
          setPullOffset(0);
        }, 180);
      }
    } else {
      setPullOffset(0);
    }
  };

  const displayedPosts = posts.slice(0, displayLimit);
  const progress = Math.min(1, pullOffset / PULL_THRESHOLD);

  return (
    <div
      className="relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* シンプルな円形ローディングスピナー（テキストなし・画面追従連動） */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 right-0 flex justify-center items-center z-10"
        style={{
          top: '-38px',
          height: '36px',
          transform: `translate3d(0, ${pullOffset}px, 0)`,
          opacity: isRefreshing ? 1 : Math.min(1, Math.max(0, (pullOffset - 6) / 28)),
          transition: isPulling ? 'none' : 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease'
        }}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{
            transform: isRefreshing ? 'scale(1)' : `scale(${0.65 + 0.35 * progress}) rotate(${pullOffset * 4.5}deg)`,
            transition: isPulling ? 'none' : 'transform 0.25s ease'
          }}
        >
          <svg
            className={`w-6 h-6 text-emerald-500 ${isRefreshing ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeDasharray="42 18"
            />
          </svg>
        </div>
      </div>

      {/* タイムライン本体：引っ張り量に合わせて画面全体が滑らかに追従 */}
      <div
        className="space-y-4"
        style={{
          transform: pullOffset > 0 ? `translate3d(0, ${pullOffset}px, 0)` : 'none',
          transition: isPulling ? 'none' : 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)'
        }}
      >
        {!posts || posts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center mt-10 shadow-sm">
            <Dumbbell className="mx-auto text-slate-300 dark:text-slate-600 w-12 h-12 mb-4" />
            <p className="text-slate-500 dark:text-slate-400 font-bold">まだ記録がありません。<br/>最初のトレーニングを記録しましょう！</p>
          </div>
        ) : (
          <>
            {displayedPosts.map((post, index) => (
              <React.Fragment key={post.id}>
                <WorkoutCard post={post} currentUser={currentUser} accountsInfo={accountsInfo} onEdit={onEdit} onDelete={onDelete} onToggleLike={onToggleLike} onImport={onImport} onImportItem={onImportItem} onAddComment={onAddComment} onDeleteComment={onDeleteComment} onToggleCommentLike={onToggleCommentLike} onUserClick={onUserClick} />
              </React.Fragment>
            ))}
            {posts.length > displayLimit && (
              <button onClick={() => setDisplayLimit(prev => prev + 10)} className="w-full py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors mt-4">
                もっと見る
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export {
  WorkoutCard,
  TimelineView
};
