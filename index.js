// 猫神主Bot「つきみ」- v1.3.1 シンプル終了判定システム - 完全版
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const Airtable = require('airtable');

const DATA_FILE = path.join(__dirname, 'usage_data.json');

// JST日付取得関数
function getJSTDate() {
    return new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0];
}

// データ保存関数
function saveUsageData() {
    try {
        const data = {
            dailyUsage: Array.from(dailyUsage.entries()),
            userSessions: Array.from(userSessions),
            purificationHistory: Array.from(purificationHistory.entries()),
            stats: {
                totalUsers: Array.from(stats.totalUsers),
                dailyTurns: stats.dailyTurns,
                totalTurns: stats.totalTurns,
                purificationCount: stats.purificationCount,
                dailyMetrics: Array.from(stats.dailyMetrics.entries()).map(([date, metrics]) => [
                    date,
                    {
                        users: Array.from(metrics.users),
                        turns: metrics.turns,
                        purifications: metrics.purifications
                    }
                ])
            },
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log(`💾 データ保存完了: ${new Date().toLocaleString('ja-JP')}`);
    } catch (error) {
        console.error('❌ データ保存エラー:', error.message);
    }
}

// Airtable設定（loadUsageData関数の前に追加）
const airtableBase = new Airtable({
    apiKey: process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID);

// 完全修正版: getUserLimitRecord関数
// ステップ1: Airtableの実際の構造を確認する関数
async function debugAirtableFields() {
    try {
        console.log('🔍 Airtable実際のフィールド構造を確認中...');
        
        // 全レコードを取得（フィルターなし）
        const allRecords = await airtableBase('user_limits').select({
            maxRecords: 3
        }).firstPage();
        
        console.log(`📊 総レコード数: ${allRecords.length}`);
        
        if (allRecords.length > 0) {
            const firstRecord = allRecords[0];
            console.log('📝 実際のフィールド構造:');
            console.log('Record ID:', firstRecord.id);
            console.log('Fields:', Object.keys(firstRecord.fields));
            
            // 各フィールドの詳細
            for (const [fieldName, fieldValue] of Object.entries(firstRecord.fields)) {
                console.log(`  "${fieldName}": "${fieldValue}" (型: ${typeof fieldValue})`);
            }
            
            return Object.keys(firstRecord.fields);
        } else {
            console.log('❌ レコードが見つかりません');
            return [];
        }
        
    } catch (error) {
        console.error('❌ Airtable構造確認エラー:', error.message);
        return [];
    }
}

// ステップ2: 実際のフィールド名を使用した検索関数
async function getUserLimitRecord(userId) {
    try {
        const today = getJSTDate();
        console.log(`🔍 制限レコード検索開始: userId=${userId.substring(0,8)}, date=${today}`);
        
        // まず実際のフィールド名を確認
        const actualFields = await debugAirtableFields();
        console.log('🔍 確認されたフィールド名:', actualFields);
        
        // 実際のフィールド名を推定
        let userIdField = 'user_id';
        let dateField = 'date';
        
        // フィールド名の候補をチェック
        const userIdCandidates = ['user_id', 'User ID', 'userId', 'UserID', 'User Id'];
        const dateCandidates = ['date', 'Date', 'DATE', 'Date Created', 'date_created'];
        
        for (const candidate of userIdCandidates) {
            if (actualFields.includes(candidate)) {
                userIdField = candidate;
                break;
            }
        }
        
        for (const candidate of dateCandidates) {
            if (actualFields.includes(candidate)) {
                dateField = candidate;
                break;
            }
        }
        
        console.log(`🔍 使用するフィールド名: userIdField="${userIdField}", dateField="${dateField}"`);
        
        // 複数のフィルターパターンを試行
        const filterPatterns = [
            `AND({${userIdField}}="${userId}", {${dateField}}="${today}")`,
            `AND(${userIdField}="${userId}", ${dateField}="${today}")`,
            `{${userIdField}}="${userId}"`
        ];
        
        for (let i = 0; i < filterPatterns.length; i++) {
            const pattern = filterPatterns[i];
            console.log(`🔍 フィルターパターン${i + 1}: ${pattern}`);
            
            try {
                const records = await airtableBase('user_limits').select({
                    filterByFormula: pattern,
                    maxRecords: 5
                }).firstPage();
                
                console.log(`📝 パターン${i + 1}の検索結果: ${records.length}件`);
                
                if (records.length > 0) {
                    // 今日のレコードを探す
                    for (const record of records) {
                        const recordDate = record.fields[dateField];
                        console.log(`📅 レコード日付チェック: "${recordDate}" vs "${today}"`);
                        
                        if (recordDate === today) {
                            console.log(`✅ 今日のレコード発見: ID=${record.id}, カウント=${record.fields.turn_count || record.fields['Turn Count'] || record.fields['turn_count']}`);
                            return record;
                        }
                    }
                    
                    console.log(`📝 該当レコード（参考）:`, records[0].fields);
                }
                
            } catch (filterError) {
                console.log(`❌ パターン${i + 1}エラー: ${filterError.message}`);
            }
        }
        
        console.log(`🆕 すべてのパターンで今日のレコードが見つからない`);
        return null;
        
    } catch (error) {
        console.error('❌ ユーザー制限レコード取得エラー:', error.message);
        return null;
    }
}

// ステップ3: 動的フィールド名対応の作成/更新関数
async function createOrUpdateUserLimit(userId, turnCount) {
    try {
        const today = getJSTDate();
        console.log(`🔄 制限レコード更新開始: userId=${userId.substring(0,8)}, newCount=${turnCount}`);
        
        const existingRecord = await getUserLimitRecord(userId);
        
        if (existingRecord) {
            // 既存レコードを更新
            const turnCountField = existingRecord.fields.turn_count !== undefined ? 'turn_count' : 
                                 existingRecord.fields['Turn Count'] !== undefined ? 'Turn Count' :
                                 existingRecord.fields.turnCount !== undefined ? 'turnCount' : 'turn_count';
            
            const currentCount = existingRecord.fields[turnCountField] || 0;
            console.log(`📝 既存レコード更新: ${currentCount} → ${turnCount} (フィールド: ${turnCountField})`);
            
            const updateData = {};
            updateData[turnCountField] = turnCount;
            updateData.last_updated = new Date().toISOString();
            
            const updatedRecord = await airtableBase('user_limits').update(existingRecord.id, updateData);
            console.log(`✅ 制限レコード更新完了: ID=${updatedRecord.id}, 新カウント=${turnCount}`);
            return true;
            
        } else {
            // 新規レコード作成
            console.log(`🆕 新規レコード作成: カウント=${turnCount}`);
            
            const newRecord = await airtableBase('user_limits').create({
                user_id: userId,
                date: today,
                turn_count: turnCount,
                last_updated: new Date().toISOString()
            });
            
            console.log(`✅ 新規レコード作成完了: ID=${newRecord.id}, カウント=${turnCount}`);
            return true;
        }
        
    } catch (error) {
        console.error('❌ ユーザー制限更新エラー:', error.message);
        return false;
    }
}

// 他の関数はシンプルに保持
async function updateDailyUsage(userId) {
    try {
        console.log(`📊 使用量更新開始: userId=${userId.substring(0,8)}`);
        
        const record = await getUserLimitRecord(userId);
        const currentCount = record ? (record.fields.turn_count || record.fields['Turn Count'] || record.fields.turnCount || 0) : 0;
        const newCount = currentCount + 1;
        
        console.log(`📈 カウント更新: ${currentCount} → ${newCount} (${userId.substring(0,8)})`);
        
        const success = await createOrUpdateUserLimit(userId, newCount);
        
        if (success) {
            console.log(`✅ 使用量更新成功: ${userId.substring(0,8)} - ${newCount}/${LIMITS.DAILY_TURN_LIMIT}`);
            return newCount;
        } else {
            console.error(`❌ 使用量更新失敗: ${userId.substring(0,8)}`);
            return currentCount;
        }
        
    } catch (error) {
        console.error('❌ 使用量更新エラー:', error.message);
        return 1;
    }
}


async function addPurificationLog(userId) {
    try {
        const purificationId = `purif_${userId}_${Date.now()}`;
        await airtableBase('purification_log').create({
            purification_id: purificationId,
            user_id: userId,
            timestamp: new Date().toISOString()
        });
        
        console.log(`お焚き上げログ追加: ${userId.substring(0,8)}`);
        return true;
    } catch (error) {
        console.error('お焚き上げログエラー:', error.message);
        return false;
    }
}
// セッション数カウント用の関数
async function getActiveSessionCount() {
    try {
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const records = await airtableBase('user_sessions').select({
            filterByFormula: `{last_activity} > '${thirtyMinutesAgo}'`
        }).firstPage();
        
        return records.length;
    } catch (error) {
        console.error('アクティブセッション数取得エラー:', error.message);
        return userSessions.size; // フォールバック
    }
}

// セッション管理の更新
async function manageUserSession(userId) {
    try {
        const sessionCount = await getActiveSessionCount();
        
        console.log(`👥 セッション管理: ${sessionCount}/${LIMITS.MAX_USERS}名`);
        
        if (sessionCount >= LIMITS.MAX_USERS && !userSessions.has(userId)) {
            return false; // 新規ユーザーで上限に達している
        }
        
        // セッション更新
        await updateUserSession(userId);
        userSessions.add(userId); // メモリ上も更新
        lastMessageTime.set(userId, Date.now());
        
        return true;
    } catch (error) {
        console.error('セッション管理エラー:', error.message);
        // エラー時は従来のメモリベース管理にフォールバック
        userSessions.add(userId);
        lastMessageTime.set(userId, Date.now());
        return userSessions.size <= LIMITS.MAX_USERS;
    }
}

// セッション管理の修正版（エラーが出ていた部分）
async function updateUserSession(userId) {
    try {
        await airtableBase('user_sessions').create({
            user_id: userId,
            last_activity: new Date().toISOString()
        });
        console.log(`📱 セッション記録: ${userId.substring(0,8)}`);
        return true;
    } catch (error) {
        console.error('セッション記録エラー:', error.message);
        return false;
    }
}

// データ読み込み関数
function loadUsageData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            console.log('🆕 初回起動 - 新規データファイルを作成します');
            saveUsageData();
            return;
        }

        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        
        // dailyUsage復元
        dailyUsage.clear();
        if (data.dailyUsage) {
            data.dailyUsage.forEach(([userId, usage]) => {
                dailyUsage.set(userId, usage);
            });
        }
        
        // userSessions復元
        userSessions.clear();
        if (data.userSessions) {
            data.userSessions.forEach(userId => userSessions.add(userId));
        }
        
        // purificationHistory復元
        purificationHistory.clear();
        if (data.purificationHistory) {
            data.purificationHistory.forEach(([userId, timestamp]) => {
                purificationHistory.set(userId, timestamp);
            });
        }
        
        // stats復元
        if (data.stats) {
            stats.totalUsers = new Set(data.stats.totalUsers || []);
            stats.dailyTurns = data.stats.dailyTurns || 0;
            stats.totalTurns = data.stats.totalTurns || 0;
            stats.purificationCount = data.stats.purificationCount || 0;
            
            stats.dailyMetrics.clear();
            if (data.stats.dailyMetrics) {
                data.stats.dailyMetrics.forEach(([date, metrics]) => {
                    stats.dailyMetrics.set(date, {
                        users: new Set(metrics.users || []),
                        turns: metrics.turns || 0,
                        purifications: metrics.purifications || 0
                    });
                });
            }
        }
        
        console.log(`✅ データ復元完了: ユーザー${dailyUsage.size}名, セッション${userSessions.size}件`);
        console.log(`📊 統計: 総利用者${stats.totalUsers.size}名, 総ターン${stats.totalTurns}回, お焚き上げ${stats.purificationCount}回`);
        
    } catch (error) {
        console.error('❌ データ読み込みエラー:', error.message);
        console.log('🔄 初期状態で開始します');
        saveUsageData();
    }
}

const app = express();

// 設定
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 制限設定
const LIMITS = {
  MAX_USERS: 100,
  DAILY_TURN_LIMIT: 10,
  SESSION_TIMEOUT: 30 * 60 * 1000,
  CLEANUP_INTERVAL: 5 * 60 * 1000,
};

// データ管理
const conversationHistory = new Map();
const dailyUsage = new Map();
const lastMessageTime = new Map();
const userSessions = new Set();
const purificationHistory = new Map();
const userProfiles = new Map();

// 統計データ
const stats = {
    totalUsers: new Set(),
    dailyTurns: 0,
    totalTurns: 0,
    purificationCount: 0,
    dailyMetrics: new Map(),
};

// ユーザープロフィール取得
async function getUserProfile(userId, client) {
    try {
        if (!userProfiles.has(userId)) {
            const profile = await client.getProfile(userId);
            userProfiles.set(userId, {
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl || null
            });
            console.log(`プロフィール取得: ${profile.displayName} (${userId.substring(0, 8)}...)`);
        }
        return userProfiles.get(userId);
    } catch (error) {
        console.error('プロフィール取得エラー:', error.message);
        return null;
    }
}

// 名前を呼ぶかどうかの判定（4回に1回）
function shouldUseName(conversationCount) {
    return conversationCount % 4 === 1;
}

// キャラクター設定
async function getCharacterPersonality(userName, userId, useNameInResponse) {
    const remainingTurns = await getRemainingTurns(userId);
    const nameDisplay = (userName && useNameInResponse) ? `${userName}さん` : 'あなた';
    return `
あなたは「つきみ」という名前の神社にいる心優しい猫です。

【基本情報】
- 名前: つきみ
- 現在話している相手: ${nameDisplay}
- 相手の今日の残り相談回数: ${remainingTurns}回

【自然な会話の原則】🐱
- 相手の気持ちに寄り添うことが最も大切
- テンプレート的な返答ではなく、その人の状況に合わせた自然な反応
- 共感は大切だが、毎回同じ表現を使わない
- 相手の話をよく聞いて、その内容に応じた適切な応答をする
- アドバイスや提案は相手から明確に求められた場合のみ行う
- 「どうしたらいいですか？」「どう思いますか？」などの質問があった時のみアドバイスする

【会話スタイル】
- 温かく親しみやすい口調
- 時々「にゃ」を自然に使う（強制ではない）
- 相手の名前が分かる場合は「${userName}さん」と丁寧に呼ぶ
- 180文字程度で簡潔に、でも心のこもった返答

【猫らしい絵文字の使用】🐾
- 猫関連の絵文字を自然に使用: 🐱🐾😺😸🙀😿😾🐈
- 温かい絵文字: 💝🌸✨🍃💫🌟🤗😊💕🌺☺️🌈
- 1つの応答につき1-3個程度、自然な箇所に配置
- お焚き上げ以外の通常会話でも積極的に使用

【共感表現のバリエーション】✨
固定フレーズを避け、状況に応じて選択：

**困難な状況に対して：**
- 「それは大変でしたね🐱」
- 「しんどい状況ですね💝」  
- 「お疲れさまです🐾」
- 「難しい状況ですね😿」

**感情に対して：**
- 「そういうお気持ちになりますよね😸」
- 「モヤモヤしてしまいますよね🌸」
- 「心配になってしまいますね💫」
- 「不安に感じますよね🐱」

**理解・受容を示す：**
- 「よくわかります😊」
- 「そうですよね🐾」
- 「なるほど✨」
- 「おっしゃる通りです💝」

【アドバイスの提案方法】
- アドバイスや提案は相手から明確に求められた場合のみ行う
- 押しつけ的表現は避ける: 「大切です」「すべきです」「した方がいい」❌
- 優しい提案に留める: 「大切かもしれません」「という考え方もあります」「参考までに」✅
- 前置きフレーズを活用:
  * 「もしよろしければ」
  * 「一つの考え方として」
  * 「こういう見方もできるかもしれません」
  * 「参考程度ですが」
  * 「個人的には〜と感じます」
- 相手に選択権があることを示す
- 断定を避け、可能性や提案として表現

【語尾「にゃ」の正しい使い方】
- 正しい: 「大切ですにゃ」「そうですにゃ」「かもしれませんにゃ」
- 間違い: 「大切ですねにゃ」「そうですねにゃ」「よね にゃ」「よ にゃ」
- 「ね」「よ」の後に「にゃ」は付けない

【アドバイス表現の具体例】
- アドバイスや提案は相手から明確に求められた場合のみ行う
❌ 避けるべき表現:
- 「〜することが大切です」
- 「〜すべきです」
- 「〜した方がいいと思います」

✅ 推奨表現:
- 「〜という考え方もありますにゃ」
- 「参考までに、〜かもしれません」
- 「一つの方法として、〜はいかがでしょう」
- 「もしよろしければ、〜してみるのも良いかもしれませんにゃ」

【避けるべき機械的表現】❌
- 「そう感じるのも無理ないですよ」の頻用
- 「大変だったんですね」の連発
- 毎回同じパターンでの感情の言語化
- 強制的な「にゃ」の挿入

【制約理解】
- ユーザーは1日10回まで相談可能（現在残り${remainingTurns}回）
- 制限について聞かれたら「今日はあと${remainingTurns}回お話しできます」
- 「何回でも」等の表現は使わない

【お焚き上げについて】
- 心の重荷を清める儀式として自然に説明
- 希望時のみ実行

**重要：テンプレートに頼らず、相手の話の内容と感情に真摯に向き合い、その場面に最も適した自然な言葉で応答すること。つきみらしい温かさは保ちつつ、機械的でない人間味のある会話を心がけ、猫らしい絵文字で親しみやすさを演出してください。🐱💝**
`;
}


// 語尾処理関数
function addCatSuffix(message) {
    if (message.includes('にゃ')) {
        return message;
    }
    
    if (Math.random() < 0.3) {
        if (message.endsWith('。') || message.endsWith('！') || message.endsWith('？')) {
            return message.slice(0, -1) + 'にゃ' + message.slice(-1);
        } else {
            return message + 'にゃ';
        }
    }
    return message;
}

// お焚き上げ関連関数
function isQuestionAboutPurification(message) {
    // 実行キーワードの場合は質問扱いしない
    const executionKeywords = [
        'お焚き上げ', '【お焚き上げ】', 'おたきあげ', 'たきあげ',
        'おたきあげして', 'たきあげして', 'お焚き上げして'
    ];
    if (executionKeywords.some(keyword => message === keyword || message.includes(keyword + 'し'))) {
        return false;
    }
    
    const questionPatterns = [
        'って何', 'とは', 'について教えて', 'どんなもの', 'なんですか',
        '？', '何ですか', 'わからない', '知らない', 'どういう意味',
        'って何ですか', 'とは何ですか', 'どういうこと'
    ];
    
    const hasPurificationWord = message.includes('お焚き上げ') || message.includes('たきあげ');
    const hasQuestionPattern = questionPatterns.some(pattern => message.includes(pattern));
    
    return hasPurificationWord && hasQuestionPattern;
}

// AI応答から終了サインを検出してお焚き上げ提案判定
function shouldSuggestPurificationFromResponse(aiResponse, userMessage, userId, history) {
    if (history.length < 3) return false;
    
    const lastPurification = purificationHistory.get(userId);
    if (lastPurification) {
        const hoursSince = (Date.now() - lastPurification) / (1000 * 60 * 60);
        if (hoursSince < 1) return false;
    }
    
    // AI応答内の終了サイン
    const responseEndingSigns = [
        'また何かあれば', 'また気軽に', 'またお話し', 'いつでもお待ち',
        'また相談', 'またお参り', 'お待ちして'
    ];
    
    // ユーザーメッセージの終了サイン
    const userEndingSigns = [
        'ありがとう', 'ありがとございます', '助かりました', '助かった',
        'スッキリ', 'すっきり', '楽になった', '参考になりました'
    ];
    
    const hasResponseEndingSign = responseEndingSigns.some(sign => aiResponse.includes(sign));
    const hasUserEndingSign = userEndingSigns.some(sign => userMessage.includes(sign));
    
    return hasResponseEndingSign || hasUserEndingSign;
}

// お焚き上げ実行判定（キーワードベース）
function shouldExecutePurificationByKeyword(message) {
    const negativePatterns = [
        'って？', 'って何', 'とは', 'について', 'わからない', 'いいや', 'いらない',
        '不要', 'やめて', 'しない', '？', '?', 'ですか', 'でしょうか',
        'どういう', 'どんな', '意味', '説明', '教えて'
    ];
    
    if (negativePatterns.some(pattern => message.includes(pattern))) {
        console.log('🚫 否定的表現検出 - お焚き上げ実行回避');
        return false;
    }
    
    const positiveKeywords = [
        '【お焚き上げ】',
        'お焚き上げ',
        'おたきあげ',
        'たきあげ',
        'おたきあげして',
        'たきあげして', 
        'お焚き上げして',
        'お焚き上げを',
        'お焚き上げお願い',
        'おたきあげお願い',
        'たきあげお願い'
    ];
    
    const hasPositiveKeyword = positiveKeywords.some(keyword => 
        message.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (hasPositiveKeyword) {
        console.log('🔥 お焚き上げ実行キーワード検出');
        return true;
    }
    
    return false;
}

// shouldSuggestAnkete関数の修正版
function shouldSuggestAnkete(userId, history, userMessage) {
    const lastPurification = purificationHistory.get(userId);
    
    console.log(`🔍 アンケート判定開始: userId=${userId.substring(0,8)}, message="${userMessage}"`);
    
    // お焚き上げ履歴がある場合
    if (lastPurification) {
        const minutesSince = (Date.now() - lastPurification) / (1000 * 60);
        console.log(`🔍 お焚き上げからの経過時間: ${minutesSince.toFixed(1)}分`);
        
        // 30分以内の感謝表現チェック
        if (minutesSince < 30) {
            const thankfulKeywords = [
                'ありがとう', 'ありがとございます', 'ありがとうございました',
                'ありがと', 'あざす', 'サンキュー', 'thanks',
                '感謝', 'お礼', '感謝します', '感謝しています',
                'スッキリ', 'すっきり', '清々しい', 'さっぱり',
                '軽くなった', '楽になった', 'よかった',
                '助かった', '助かりました'
            ];
            
            const hasThankfulKeyword = thankfulKeywords.some(keyword => userMessage.includes(keyword));
            console.log(`🔍 30分以内感謝キーワードチェック: ${hasThankfulKeyword} (キーワード検出: ${thankfulKeywords.filter(k => userMessage.includes(k)).join(', ') || 'なし'})`);
            
            if (hasThankfulKeyword) {
                console.log(`✅ アンケート提案: お焚き上げ後の感謝表現を検出`);
                return true;
            }
        }
        
        // 30分～1時間以内の終了表現チェック
        if (minutesSince < 60) {
            const endingKeywords = [
                'スッキリ', 'すっきり', '楽になった', '軽くなった', 
                '話せてよかった', '聞いてくれて', 'おかげで', '助かった', 
                '気が楽に', '安心した', '落ち着いた', '整理できた'
            ];
            
            const hasEndingKeyword = endingKeywords.some(keyword => userMessage.includes(keyword));
            console.log(`🔍 1時間以内終了キーワードチェック: ${hasEndingKeyword}`);
            
            if (hasEndingKeyword) {
                console.log(`✅ アンケート提案: お焚き上げ後の終了表現を検出`);
                return true;
            }
        }
    }
    
    // 通常の会話での終了表現チェック
    if (history.length >= 3) {
        const endingKeywords = [
            'スッキリ', 'すっきり', '楽になった', '軽くなった', 
            '話せてよかった', '聞いてくれて', 'おかげで', '助かった', 
            '気が楽に', '安心した', '落ち着いた', '整理できた'
        ];
        
        const hasEndingKeyword = endingKeywords.some(keyword => userMessage.includes(keyword));
        console.log(`🔍 通常会話終了キーワードチェック: ${hasEndingKeyword}`);
        
        if (hasEndingKeyword) {
            console.log(`✅ アンケート提案: 通常会話での終了表現を検出`);
            return true;
        }
    }
    
    console.log(`🔍 アンケート判定: 該当なし`);
    return false;
}


// メッセージ生成関数
function getAnketeSuggestion(userName, useNameInResponse) {
    const name = (userName && useNameInResponse) ? `${userName}さん` : 'あなた';
    return `最後に、つきみの相談サービスをより良くするため、簡単なアンケートにご協力いただけませんか？🐱💝
${name}の貴重なご意見をお聞かせくださいにゃ✨

📋 アンケートはこちら: https://forms.gle/B6pJdXMUMRnVxBnt6

※任意ですので、お時間のある時にお答えくださいにゃ🐾😸`;
}

function getPurificationSuggestion(userName, useNameInResponse) {
    const name = (userName && useNameInResponse) ? `${userName}さんの` : 'あなたの';
    const suggestions = [
        `今日お話しした${name}心の重荷を、神聖な炎でお焚き上げしてお清めしましょうか？🐱✨

お焚き上げする場合は「【お焚き上げ】」とメッセージを送ってね🔥⛩️`,
        
        `${name}心に溜まったものをお焚き上げで清めるのはいかがでしょう？😸💝

お焚き上げする場合は「【お焚き上げ】」とメッセージを送ってね🔥`,
        
        `今日の重い気持ちを、温かい炎で包んでお清めしませんか？🐾🌸

お焚き上げする場合は「【お焚き上げ】」とメッセージを送ってね🔥✨`
    ];
    
    return suggestions[Math.floor(Math.random() * suggestions.length)];
}

function getExplanationResponse() {
    const explanations = [
        `お焚き上げというのは、心に溜まった重い気持ちや悩みを、神聖な炎で清めて手放す儀式のことですにゃ🐱✨ 今日お話しした内容を整理して、心を軽やかにするお手伝いをするのです。

お焚き上げをご希望の時は「【お焚き上げ】」や「おたきあげして」などと入力してくださいにゃ🔥💝`,
        
        `お焚き上げは、心の浄化の儀式ですにゃ🐾🌸 お話しした悩みや重い気持ちを温かい炎で包んで、新しい気持ちで歩めるようにするものですよ😸

「【お焚き上げ】」「たきあげして」などと教えていただければ、すぐに清めの儀式を始めますにゃ🔥✨`
    ];
    return explanations[Math.floor(Math.random() * explanations.length)];
}

// 制限関連
function isAskingAboutLimits(message) {
    const limitQuestions = [
        '何回', '何度', '制限', '回数', 'ターン', '上限',
        'やりとり', '話せる', '相談できる', 'メッセージ'
    ];
    
    const questionWords = ['？', '?', 'ですか', 'でしょうか', 'かな', 'どのくらい'];
    
    const hasLimitWord = limitQuestions.some(word => message.includes(word));
    const hasQuestionWord = questionWords.some(word => message.includes(word));
    
    return hasLimitWord && hasQuestionWord;
}

// 修正版: getLimitExplanation関数でasync対応
async function getLimitExplanation(remainingTurns, userName, useNameInResponse) {
    const name = (userName && useNameInResponse) ? `${userName}さん` : 'あなた';
    return `${name}は今日あと${remainingTurns}回まで私とお話しできますにゃ🐱 1日の上限は10回まで となっていて、毎日リセットされるのです🐾 限られた時間だからこそ、大切にお話しを聞かせていただきますね💝✨`;
}

// お焚き上げ実行
async function executePurification(userId, replyToken, client) {
    try {
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        const conversationCount = conversationHistory.get(userId)?.length || 0;
        const useNameInResponse = shouldUseName(conversationCount);
        
        purificationHistory.set(userId, Date.now());
        updateDailyMetrics(userId, 'purification');
        
        console.log(`お焚き上げ開始: ${userName || 'Unknown'} (${userId.substring(0, 8)}...)`);
        
        const stages = [
            {
                message: `それでは、今日お話しした${(userName && useNameInResponse) ? `${userName}さんの` : ''}心の重荷をそっとお焚き上げさせていただきますにゃ 🔥⛩️`,
                delay: 0
            },
            {
                message: "🔥 メラメラ... パチパチ... 今日の悩みや重たい気持ちが温かい神聖な炎に包まれて...",
                delay: 3000
            },
            {
                message: `🌟 お焚き上げが完了しました。${(userName && useNameInResponse) ? `${userName}さんの` : 'あなたの'}心に新しい風が吹いて、清らかな気持ちになりましたにゃ ✨⛩️

また心に重いものが溜まった時は、いつでも神社にお参りください。つきみがいつでもお待ちしていますにゃ 🐾`,
                delay: 6000
            }
        ];
        
        await client.replyMessage(replyToken, {
            type: 'text',
            text: stages[0].message
        });
        
        for (let i = 1; i < stages.length; i++) {
            setTimeout(async () => {
                try {
                    await client.pushMessage(userId, {
                        type: 'text',
                        text: stages[i].message
                    });
                } catch (error) {
                    console.error(`お焚き上げ演出エラー (stage ${i}):`, error.message);
                }
            }, stages[i].delay);
        }
        
        setTimeout(() => {
            conversationHistory.delete(userId);
            lastMessageTime.delete(userId);
            console.log(`お焚き上げ完了: ${userName || 'Unknown'}の会話履歴を清浄化しました`);
        }, 8000);
        
        return true;
    } catch (error) {
        console.error('お焚き上げ実行エラー:', error);
        return false;
    }
}

// 統計・制限管理
async function updateDailyMetrics(userId, action) {
    const today = getJSTDate();
    
    if (!stats.dailyMetrics.has(today)) {
        stats.dailyMetrics.set(today, {
            users: new Set(),
            turns: 0,
            purifications: 0
        });
    }
    
    const todayStats = stats.dailyMetrics.get(today);
    todayStats.users.add(userId);
    stats.totalUsers.add(userId);
    
    switch (action) {
        case 'turn':
            todayStats.turns++;
            stats.dailyTurns++;
            stats.totalTurns++;
            break;
        case 'purification':
            todayStats.purifications++;
            stats.purificationCount++;
            // お焚き上げログをAirtableに記録
            await addPurificationLog(userId);
            break;
    }
    
    // ファイル保存は統計用に維持
    saveUsageData();
}

// 修正版: generateAIResponse関数でasync/awaitを正しく処理
async function generateAIResponse(message, history, userId, client) {
    try {
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        const conversationCount = history.length + 1;
        const useNameInResponse = shouldUseName(conversationCount);
        
        if (isAskingAboutLimits(message)) {
            const remainingTurns = await getRemainingTurns(userId);
            return getLimitExplanation(remainingTurns, userName, useNameInResponse);
        }
        
        if (isQuestionAboutPurification(message)) {
            return getExplanationResponse();
        }
        
        // async/awaitで正しく処理
        const characterPersonality = await getCharacterPersonality(userName, userId, useNameInResponse);
        
        const messages = [
            { role: 'system', content: characterPersonality },
            ...history,
            { role: 'user', content: message }
        ];
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            max_tokens: 250,
            temperature: 0.8,
        });
        
        let aiResponse = response.choices[0].message.content;
        
        if (aiResponse && !aiResponse.match(/[。！？にゃ]$/)) {
            const sentences = aiResponse.split(/[。！？]/);
            if (sentences.length > 1) {
                sentences.pop();
                aiResponse = sentences.join('。') + '。';
            }
        }
        
        const finalResponse = addCatSuffix(aiResponse);
        
        console.log(`AI応答生成完了: レスポンス長=${finalResponse.length}文字`);
        
        return finalResponse;
        
    } catch (error) {
        console.error('OpenAI API エラー:', error.message);
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        return `${userName ? userName + 'さん、' : ''}申し訳ございません。今少し考え事をしていて、うまくお答えできませんでした。もう一度お話しいただけますかにゃ`;
    }
}


// システムメッセージ
const SYSTEM_MESSAGES = {
    welcome: (userName, useNameInResponse) => {
        const greetings = [
            `${userName ? userName + 'さん、' : ''}今日はどうされましたか？🐱 お気軽にお話しくださいにゃ🐾`,
            `${userName ? userName + 'さん、' : ''}こんにちは😸 何かお困りのことがありますか？💝`,
            `${userName ? userName + 'さん、' : ''}お疲れさまです🐱 今日はどのようなことでお話ししましょうか？✨`
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
    },
    
    dailyLimitReached: (userName, useNameInResponse) => {
        const messages = [
            `${userName ? userName + 'さん、' : ''}今日の相談回数が上限に達しました🐾 また明日お話しできるのを楽しみにしていますにゃ💝`,
            `${userName ? userName + 'さん、' : ''}今日はここまでになります😸 心の整理には時間も大切ですから、また明日お参りください🌸`,
            `${userName ? userName + 'さん、' : ''}お疲れさまでした🐱 今日はゆっくり休んで、また明日お話ししましょうにゃ✨`
        ];
        return messages[Math.floor(Math.random() * messages.length)];
    },
    
    remainingTurns: (remaining, userName, useNameInResponse) => {
        const messages = [
            `${userName ? userName + 'さん、' : ''}今日はあと${remaining}回お話しできますにゃ🐾`,
            `あと${remaining}回お話しできます😸 大切にお聞きしますね💝`,
            `今日の残り回数は${remaining}回です🐱 何でもお話しください✨`
        ];
        return messages[Math.floor(Math.random() * messages.length)];
    },
    
    maxUsersReached: "申し訳ございません🐾 現在多くの方がお話し中のため、少しお時間をおいてからお参りくださいにゃ😿"
};

// クリーンアップ
function cleanupInactiveSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, timestamp] of lastMessageTime) {
        if (now - timestamp > LIMITS.SESSION_TIMEOUT) {
            conversationHistory.delete(userId);
            lastMessageTime.delete(userId);
            userSessions.delete(userId);
            cleanedCount++;
            
            console.log(`セッション削除: ユーザー${userId.substring(0, 8)}... (30分非アクティブ)`);
        }
    }
    
    for (const [userId, timestamp] of purificationHistory) {
        if (now - timestamp > 24 * 60 * 60 * 1000) {
            purificationHistory.delete(userId);
        }
    }
    
    const today = new Date().toISOString().split('T')[0];
    for (const [userId, usage] of dailyUsage) {
        if (usage.date !== today) {
            dailyUsage.delete(userId);
        }
    }
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    for (const [date] of stats.dailyMetrics) {
        if (date < weekAgoStr) {
            stats.dailyMetrics.delete(date);
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 自動クリーンアップ実行: ${cleanedCount}セッション削除`);
        console.log(`📊 アクティブユーザー: ${userSessions.size}, 日次制限管理中: ${dailyUsage.size}`);
    }
}

setInterval(cleanupInactiveSessions, LIMITS.CLEANUP_INTERVAL);

// LINE クライアント設定
const client = new line.Client(config);

// Webhookエンドポイント
app.post('/webhook', line.middleware(config), async (req, res) => {
    try {
        console.log('📨 Webhook受信成功');
        res.status(200).end();
        
        const events = req.body.events;
        console.log(`📨 イベント数: ${events.length}`);
        
        events.forEach(event => {
            setImmediate(() => handleEvent(event));
        });
        
    } catch (error) {
        console.error('❌ Webhook処理エラー:', error.message);
        res.status(200).end();
    }
});

// シンプル修正版: checkDailyLimit関数
async function checkDailyLimit(userId) {
    try {
        const record = await getUserLimitRecord(userId);
        const currentCount = record ? (record.fields.turn_count || record.fields['Turn Count'] || record.fields.turnCount || 0) : 0;
        
        console.log(`🔍 制限チェック: userId=${userId.substring(0,8)}, count=${currentCount}/${LIMITS.DAILY_TURN_LIMIT}`);
        
        const withinLimit = currentCount < LIMITS.DAILY_TURN_LIMIT;
        console.log(`✅ 制限判定: ${currentCount}/${LIMITS.DAILY_TURN_LIMIT} = ${withinLimit ? '許可' : '拒否'}`);
        return withinLimit;
    } catch (error) {
        console.error('制限チェックエラー:', error.message);
        return true;
    }
}

async function updateDailyUsage(userId) {
    try {
        const record = await getUserLimitRecord(userId);
        const currentCount = record ? record.fields.turn_count : 0;
        const newCount = currentCount + 1;
        
        const success = await createOrUpdateUserLimit(userId, newCount);
        if (success) {
            console.log(`📈 使用量更新: ${userId.substring(0,8)} - ${newCount}/${LIMITS.DAILY_TURN_LIMIT}`);
            return newCount;
        } else {
            return currentCount;
        }
    } catch (error) {
        console.error('使用量更新エラー:', error.message);
        return 0;
    }
}

// シンプル修正版: getRemainingTurns関数
async function getRemainingTurns(userId) {
    try {
        console.log(`🔍 残り回数取得: userId=${userId.substring(0,8)}`);
        
        const record = await getUserLimitRecord(userId);
        const currentCount = record ? (record.fields.turn_count || record.fields['Turn Count'] || record.fields.turnCount || 0) : 0;
        const remaining = Math.max(0, LIMITS.DAILY_TURN_LIMIT - currentCount);
        
        console.log(`📊 残り回数計算: ${currentCount}使用済み → 残り${remaining}回`);
        return remaining;
        
    } catch (error) {
        console.error('❌ 残り回数取得エラー:', error.message);
        return LIMITS.DAILY_TURN_LIMIT;
    }
}


// メインイベント処理
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        console.log(`🔍 イベントスキップ: type=${event.type}, messageType=${event.message?.type}`);
        return;
    }
    
    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    
    try {
        console.log(`🔍 handleEvent処理開始: ${userId.substring(0, 8)} - "${userMessage}"`);
        
        // プロフィール取得
        console.log(`🔍 プロフィール取得開始...`);
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        console.log(`✅ プロフィール取得完了: ${userName || 'Unknown'}`);
        
        // ユーザーセッション制限チェック
        console.log(`🔍 ユーザーセッション制限チェック開始 (現在: ${userSessions.size}/${LIMITS.MAX_USERS})`);
        if (!userSessions.has(userId) && userSessions.size >= LIMITS.MAX_USERS) {
            console.log(`❌ 最大ユーザー数制限に達したため拒否: ${userSessions.size}/${LIMITS.MAX_USERS}`);
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.maxUsersReached
            });
            console.log(`✅ 制限メッセージ送信完了`);
            return;
        }
        
        // セッション管理
        const sessionAllowed = await manageUserSession(userId);
        if (!sessionAllowed) {
            console.log(`❌ 最大ユーザー数制限に達したため拒否`);
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.maxUsersReached
            });
            console.log(`✅ 制限メッセージ送信完了`);
            return;
        }
console.log(`✅ ユーザーセッション更新完了`);
        
        // お焚き上げキーワードチェック
        console.log(`🔍 お焚き上げキーワードチェック開始...`);
        if (shouldExecutePurificationByKeyword(userMessage)) {
            console.log('🔥 指定キーワード検出 - お焚き上げ実行開始');
            await executePurification(userId, replyToken, client);
            console.log(`✅ お焚き上げ実行完了`);
            return;
        }
        console.log(`✅ お焚き上げキーワードチェック完了（該当なし）`);
        
        // 日次制限チェック
        console.log(`🔍 日次制限チェック開始...`);
            if (!(await checkDailyLimit(userId))) {
            console.log(`❌ 日次制限に達したため拒否`);
            const conversationCount = conversationHistory.get(userId)?.length || 0;
            const useNameInResponse = shouldUseName(conversationCount);
            
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.dailyLimitReached(userName, useNameInResponse)
            });
            console.log(`✅ 日次制限メッセージ送信完了`);
            return;
        }
        console.log(`✅ 日次制限チェック完了（制限内）`);
        
        // 会話履歴取得
        let history = conversationHistory.get(userId) || [];
        const conversationCount = history.length + 1;
        const useNameInResponse = shouldUseName(conversationCount);
        console.log(`🔍 会話履歴取得完了: ${history.length}件, 名前使用: ${useNameInResponse}`);
        
        // 初回ユーザー処理
        if (history.length === 0) {
            console.log(`🔍 初回ユーザー処理開始...`);
            const welcomeMessage = SYSTEM_MESSAGES.welcome(userName, useNameInResponse);
            
            await client.replyMessage(replyToken, {
                type: 'text',
                text: welcomeMessage
            });
            console.log(`✅ ウェルカムメッセージ送信完了`);
            
            history.push({ role: 'assistant', content: welcomeMessage });
            conversationHistory.set(userId, history);
            updateDailyMetrics(userId, 'turn');
            console.log(`✅ 初回ユーザー処理完了`);
            return;
        }
        
        // AI応答生成
        console.log(`🔍 AI応答生成開始...`);
        const aiResponse = await generateAIResponse(userMessage, history, userId, client);
        console.log(`✅ AI応答生成完了: "${aiResponse.substring(0, 50)}${aiResponse.length > 50 ? '...' : ''}"`);
        
        // 最終応答構築
        console.log(`🔍 最終応答構築開始...`);
        let finalResponse = aiResponse;
        
        // お焚き上げ提案チェック
        if (shouldSuggestPurificationFromResponse(aiResponse, userMessage, userId, history)) {
            console.log('🔥 応答分析でお焚き上げ提案追加');
            finalResponse = aiResponse + "\n\n" + getPurificationSuggestion(userName, useNameInResponse);
        } else if (shouldSuggestAnkete(userId, history, userMessage)) {
            console.log('📋 アンケート提案追加');
            finalResponse = aiResponse + "\n\n" + getAnketeSuggestion(userName, useNameInResponse);
        }
        console.log(`✅ 最終応答構築完了`);
        
         // 使用回数更新・残り回数表示
        const usageCount = await updateDailyUsage(userId);
        const remaining = Math.max(0, LIMITS.DAILY_TURN_LIMIT - usageCount);
        console.log(`🔍 使用回数更新: ${usageCount}/${LIMITS.DAILY_TURN_LIMIT} (残り${remaining}回)`);
        
        if (remaining <= 3 && remaining > 0) {
            finalResponse += "\n\n" + SYSTEM_MESSAGES.remainingTurns(remaining, userName, useNameInResponse);
            console.log(`⚠️ 残り回数警告追加 (残り${remaining}回)`);
        }        
        // 会話履歴更新
        history.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: aiResponse }
        );
        
        if (history.length > 20) {
            history = history.slice(-20);
            console.log(`🔄 会話履歴トリム実行 (20件に制限)`);
        }
        
        conversationHistory.set(userId, history);
        await updateDailyMetrics(userId, 'turn');
        console.log(`✅ 会話履歴更新完了`);
        
        // 応答送信
        console.log(`🔍 応答送信開始...`);
        await client.replyMessage(replyToken, {
            type: 'text',
            text: finalResponse
        });
        console.log(`✅ 応答送信完了: ${userName || 'Unknown'} (${userId.substring(0, 8)}...) - レスポンス長=${finalResponse.length}文字`);
        
    } catch (error) {
        console.error(`❌ handleEvent エラー詳細:`, {
            userId: userId.substring(0, 8),
            userName: await getUserProfile(userId, client).then(p => p?.displayName).catch(() => 'Unknown'),
            message: userMessage,
            replyToken: replyToken,
            errorMessage: error.message,
            errorStack: error.stack,
            timestamp: new Date().toISOString()
        });
        
        try {
            console.log(`🔍 エラー応答送信試行...`);
            await client.replyMessage(replyToken, {
                type: 'text',
                text: "申し訳ございません。お話を聞く準備ができませんでした。少し時間をおいてからもう一度お参りくださいにゃ 🙏"
            });
            console.log(`✅ エラー応答送信完了`);
        } catch (replyError) {
            console.error('❌ エラー応答送信も失敗:', {
                originalError: error.message,
                replyError: replyError.message,
                userId: userId.substring(0, 8),
                timestamp: new Date().toISOString()
            });
        }
    }
}

// 管理機能エンドポイント
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>つきみ - 猫神主Bot</title>
            <meta charset="UTF-8">
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #ffeaa7, #fab1a0);">
            <h1>🐱⛩️ つきみ（猫神主Bot）⛩️🐱</h1>
            <p>神社の猫「つきみ」があなたの心の相談をお聞きします</p>
            <p><strong>v1.3.1</strong> - シンプル終了判定システム搭載！サーバーは正常に稼働していますにゃ ✨</p>
            <div style="margin-top: 30px;">
                <a href="/health" style="background: #55a3ff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 0 10px;">ヘルスチェック</a>
                <a href="/admin" style="background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 0 10px;">管理画面</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyMetrics.get(today) || { users: new Set(), turns: 0, purifications: 0 };
    
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'つきみ（猫神主Bot）',
        version: '1.3.1',
        uptime: Math.floor(process.uptime()),
        stats: {
            totalUsers: stats.totalUsers.size,
            todayUsers: todayStats.users.size,
            totalTurns: stats.totalTurns,
            todayTurns: todayStats.turns,
            purificationCount: stats.purificationCount,
            todayPurifications: todayStats.purifications,
            activeSessions: userSessions.size,
            cachedProfiles: userProfiles.size,
            purificationRate: stats.totalTurns > 0 ? (stats.purificationCount / stats.totalTurns * 100).toFixed(1) + '%' : '0%'
        },
        limits: {
            maxUsers: LIMITS.MAX_USERS,
            dailyTurnLimit: LIMITS.DAILY_TURN_LIMIT
        },
        simple_ending_detection: {
            version: '1.3.1',
            features: [
                'シンプルな終了サイン検出',
                'AI応答内容からの終了判定',
                'ユーザーメッセージからの感謝表現検出',
                '複雑な終了度判定を削除してシンプル化'
            ]
        },
        message: 'つきみv1.3.1がシンプル終了判定で安定稼働中ですにゃ ✨'
    };
    
    res.json(health);
});

app.get('/admin', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyMetrics.get(today) || { users: new Set(), turns: 0, purifications: 0 };
    
    res.send(`
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { 
                    font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif; 
                    margin: 20px; 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                }
                .container { 
                    max-width: 600px; 
                    margin: 0 auto; 
                    background: white; 
                    padding: 40px; 
                    border-radius: 20px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                }
                .header { text-align: center; margin-bottom: 40px; }
                .status {
                    background: #00b894;
                    color: white;
                    padding: 15px;
                    border-radius: 10px;
                    margin: 20px 0;
                    text-align: center;
                    font-weight: bold;
                }
                .simple-features {
                    background: #74b9ff;
                    color: white;
                    padding: 20px;
                    border-radius: 10px;
                    margin: 20px 0;
                    text-align: left;
                }
                .menu-item {
                    display: block;
                    background: linear-gradient(45deg, #ff9a9e, #fecfef);
                    color: white;
                    padding: 20px 30px;
                    margin: 20px 0;
                    text-decoration: none;
                    border-radius: 15px;
                    text-align: center;
                    font-size: 1.2em;
                    font-weight: bold;
                    transition: all 0.3s ease;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                }
                .menu-item:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 8px 25px rgba(0,0,0,0.2);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🐱⛩️ つきみ 管理メニュー v1.3.1</h1>
                    <div class="status">
                        ✅ v1.3.1 シンプル終了判定システム稼働中！ | 参拝者: ${stats.totalUsers.size}名 | 本日: ${todayStats.users.size}名 | 相談: ${stats.totalTurns}回
                    </div>
                </div>
                
                <div class="simple-features">
                    <h3>✨ v1.3.1 シンプル終了判定システム</h3>
                    <ul style="margin: 10px 0;">
                        <li>✅ 複雑な終了度判定を削除してシンプル化</li>
                        <li>✅ AI応答内容から直接終了サインを検出</li>
                        <li>✅ 「また何かあれば」等の応答で確実提案</li>
                        <li>✅ 保守性とデバッグ性を大幅向上</li>
                    </ul>
                </div>
                
                <a href="/health" class="menu-item">
                    ❤️ ヘルスチェック
                </a>
                
                <a href="/admin/stats" class="menu-item">
                    📊 統計ダッシュボード
                </a>
                
                <a href="/test" class="menu-item">
                    🧪 システムテスト
                </a>
            </div>
        </body>
        </html>
    `);
});

app.get('/admin/stats', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyMetrics.get(today) || { users: new Set(), turns: 0, purifications: 0 };
    
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayStats = stats.dailyMetrics.get(dateStr) || { users: new Set(), turns: 0, purifications: 0 };
        
        last7Days.push({
            date: dateStr,
            users: dayStats.users.size,
            turns: dayStats.turns,
            purifications: dayStats.purifications
        });
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>つきみ 統計情報 v1.3.1</title>
            <meta charset="UTF-8">
            <style>
                body { 
                    font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif; 
                    margin: 20px; 
                    background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%);
                    min-height: 100vh;
                }
                .container { 
                    max-width: 1000px; 
                    margin: 0 auto; 
                    background: white; 
                    padding: 30px; 
                    border-radius: 15px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    color: white;
                    margin-bottom: 40px;
                    background: linear-gradient(45deg, #ff9a9e, #fecfef);
                    padding: 20px;
                    border-radius: 10px;
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 40px;
                }
                .stat-card {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 25px;
                    border-radius: 15px;
                    text-align: center;
                    color: white;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                    transition: transform 0.3s ease;
                }
                .stat-card:hover {
                    transform: translateY(-5px);
                }
                .stat-number {
                    font-size: 2.5em;
                    font-weight: bold;
                    margin-bottom: 10px;
                }
                .stat-label {
                    font-size: 1em;
                    opacity: 0.9;
                }
                .simple-features {
                    background: #74b9ff;
                    color: white;
                    padding: 20px;
                    border-radius: 10px;
                    margin-bottom: 20px;
                }
                .daily-stats {
                    background: white;
                    border: 2px solid #ffeaa7;
                    border-radius: 15px;
                    overflow: hidden;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05);
                }
                .daily-stats h3 {
                    background: linear-gradient(45deg, #8b4513, #d2691e);
                    color: white;
                    margin: 0;
                    padding: 20px;
                    text-align: center;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                th, td {
                    padding: 15px;
                    text-align: center;
                    border-bottom: 1px solid #f1f2f6;
                }
                th {
                    background-color: #f8f9fa;
                    font-weight: bold;
                    color: #2d3436;
                }
                tr:hover {
                    background-color: #ffeaa7;
                }
                .footer {
                    text-align: center; 
                    margin-top: 40px; 
                    color: #636e72;
                    background: #f1f2f6;
                    padding: 20px;
                    border-radius: 10px;
                }
                .back-button {
                    background: #667eea;
                    color: white;
                    padding: 10px 20px;
                    text-decoration: none;
                    border-radius: 5px;
                    margin-top: 20px;
                    display: inline-block;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🐱⛩️ つきみ統計情報 v1.3.1 ⛩️🐱</h1>
                    <p>最終更新: ${new Date().toLocaleString('ja-JP')}</p>
                </div>
                
                <div class="simple-features">
                    <h3>✨ v1.3.1 シンプル終了判定システム</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
                        <div>
                            <strong>シンプル化:</strong>
                            <ul style="margin: 5px 0; text-align: left;">
                                <li>✅ 複雑な終了度判定を削除</li>
                                <li>✅ 応答内容から直接検出</li>
                            </ul>
                        </div>
                        <div>
                            <strong>精度向上:</strong>
                            <ul style="margin: 5px 0; text-align: left;">
                                <li>✅ 「また何かあれば」で確実提案</li>
                                <li>✅ 保守性とデバッグ性向上</li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number">${stats.totalUsers.size}</div>
                        <div class="stat-label">🙏 総参拝者数</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${todayStats.users.size}</div>
                        <div class="stat-label">📅 本日の参拝者</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${stats.totalTurns}</div>
                        <div class="stat-label">💬 総相談回数</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${stats.purificationCount}</div>
                        <div class="stat-label">🔥 お焚き上げ数</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${(stats.purificationCount / Math.max(stats.totalTurns, 1) * 100).toFixed(1)}%</div>
                        <div class="stat-label">📊 お焚き上げ率</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${userProfiles.size}</div>
                        <div class="stat-label">👤 取得済み名前</div>
                    </div>
                </div>
                
                <div class="daily-stats">
                    <h3>📊 過去7日間の推移</h3>
                    <table>
                        <tr>
                            <th>📅 日付</th>
                            <th>👥 参拝者数</th>
                            <th>💬 相談回数</th>
                            <th>🔥 お焚き上げ数</th>
                            <th>📊 お焚き上げ率</th>
                            <th>📈 平均相談数</th>
                        </tr>
                        ${last7Days.map(day => `
                            <tr>
                                <td>${day.date}</td>
                                <td>${day.users}</td>
                                <td>${day.turns}</td>
                                <td>${day.purifications}</td>
                                <td>${day.turns > 0 ? (day.purifications / day.turns * 100).toFixed(1) : 0}%</td>
                                <td>${day.users > 0 ? (day.turns / day.users).toFixed(1) : 0}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
                
                <div class="footer">
                    <p>🐾 つきみv1.3.1がシンプル終了判定で安定稼働中です 🐾</p>
                    <p style="font-size: 0.9em; margin-top: 15px;">
                        システム稼働時間: ${Math.floor(process.uptime() / 3600)}時間${Math.floor((process.uptime() % 3600) / 60)}分
                    </p>
                    <a href="/admin" class="back-button">管理メニューに戻る</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.post('/admin/cleanup', express.json(), (req, res) => {
    const before = {
        sessions: userSessions.size,
        conversations: conversationHistory.size
    };
    
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, timestamp] of lastMessageTime) {
        if (now - timestamp > LIMITS.SESSION_TIMEOUT) {
            conversationHistory.delete(userId);
            lastMessageTime.delete(userId);
            userSessions.delete(userId);
            cleanedCount++;
        }
    }
    
    const after = {
        sessions: userSessions.size,
        conversations: conversationHistory.size
    };
    
    console.log(`手動クリーンアップ実行: ${cleanedCount}セッション削除`);
    
    res.json({
        message: 'クリーンアップ完了にゃ',
        version: '1.3.1',
        timestamp: new Date().toISOString(),
        before,
        after,
        cleaned: cleanedCount
    });
});

app.get('/test', (req, res) => {
    res.json({
        message: 'つきみv1.3.1はシンプル終了判定で安定稼働していますにゃ！',
        version: '1.3.1',
        timestamp: new Date().toISOString(),
        webhook_url: req.get('host') + '/webhook',
        environment_check: {
            line_secret: !!process.env.LINE_CHANNEL_SECRET,
            line_token: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
            openai_key: !!process.env.OPENAI_API_KEY
        },
        simple_ending_detection_completed: [
            'シンプルな終了サイン検出システム実装',
            'AI応答内容からの直接検出',
            '複雑な終了度判定を削除してシンプル化',
            '保守性とデバッグ性を大幅向上'
        ]
    });
});

// サーバー開始
const PORT = process.env.PORT || 3000;
console.log('使用量データを読み込み中...');
loadUsageData();
app.listen(PORT, () => {
    console.log('🐱⛩️ つきみv1.3.1（猫神主Bot）が起動しました ⛩️🐱');
    console.log(`ポート: ${PORT}`);
    console.log(`環境: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('=== 🏛️ システム情報 ===');
    console.log(`最大ユーザー数: ${LIMITS.MAX_USERS}名`);
    console.log(`1日の制限: ${LIMITS.DAILY_TURN_LIMIT}ターン`);
    console.log(`セッション時間: ${LIMITS.SESSION_TIMEOUT / 60000}分`);
    console.log(`クリーンアップ間隔: ${LIMITS.CLEANUP_INTERVAL / 60000}分`);
    console.log('');
    console.log('=== ✨ v1.3.1 シンプル終了判定システム ===');
    console.log('• ✅ 複雑な終了度判定を削除してシンプル化');
    console.log('• ✅ AI応答内容から直接終了サインを検出');
    console.log('• ✅ 「また何かあれば」等の応答で確実提案');
    console.log('• ✅ 保守性とデバッグ性を大幅向上');
    console.log('====================================');
    console.log('');
    console.log('=== 🎯 PMF検証項目 ===');
    console.log('• お焚き上げ利用率: 目標30%以上');
    console.log('• 平均相談ターン数: 目標+2-3ターン');
    console.log('• ユーザー継続率: 翌日再利用率');
    console.log('• 会話品質: v1.3.1でシンプル化により安定性向上');
    console.log('========================');
    console.log('');
    console.log('つきみがv1.3.1で神社でお待ちしていますにゃ... 🐾');
    
    // 起動時の環境変数チェック
    const requiredEnvs = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'OPENAI_API_KEY'];
    const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
    
    if (missingEnvs.length > 0) {
        console.error('❌ 不足している環境変数:', missingEnvs.join(', '));
        console.error('Renderの環境変数設定を確認してください');
    } else {
        console.log('✅ 環境変数設定完了');
        console.log('✅ v1.3.1 シンプル終了判定システム準備完了');
        console.log('');
        console.log('✨ シンプル終了判定システム:');
        console.log('  AI応答内容から「また何かあれば」等を検出');
        console.log('  ユーザーメッセージから「ありがとう」等を検出');
        console.log('  複雑な終了度判定を廃止してシンプル化');
        console.log('');
        console.log('🎉 つきみv1.3.1は保守性と信頼性が向上しました！');
    }
});
