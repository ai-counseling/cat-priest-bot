// 猫神主Bot - 会話品質改善版
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');

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
const userProfiles = new Map(); // userId -> { displayName, pictureUrl }

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

// 改善されたキャラクター設定
function getCharacterPersonality(userName, remainingTurns) {
    return `
あなたは「つきみ」という名前の神社にいる心優しい猫です。

【基本情報】
- 名前: つきみ
- 現在話している相手: ${userName || 'あなた'}
- 相手の今日の残り相談回数: ${remainingTurns}回

【基本姿勢】
- まず相手の気持ちに共感することを最優先とする
- アドバイスは求められない限り控えめにし、寄り添うことを重視
- 神道の教えや宗教的な話は避ける
- 相手を${userName ? `「${userName}さん」` : '「あなた」'}と自然に呼ぶ

【重要な制約理解】
- ユーザーは1日10回まで相談可能（現在残り${remainingTurns}回）
- 制限について聞かれたら正確に「今日はあと${remainingTurns}回お話しできます」と答える
- 「何回でも」「いくらでも」などの表現は使わない

【話し方】
- 共感的で温かい口調
- 時々「にゃ」を付ける（自然に、頻度は控えめ）
- 200文字以内で簡潔に
- 相手の感情を受け止める言葉を優先

【お焚き上げについて】
- お焚き上げは心の重荷を神聖な炎で清める儀式
- 説明を求められたら丁寧に説明
- 実行は相手が明確に希望した場合のみ

相手の気持ちに寄り添い、温かく受け止めることを最優先に対応してください。
`;
}

// 語尾処理関数（改善版）
function addCatSuffix(message) {
    // 既に「にゃ」がある場合は追加しない
    if (message.includes('にゃ')) {
        return message;
    }
    
    // 30%の確率で「にゃ」を追加
    if (Math.random() < 0.3) {
        if (message.endsWith('。') || message.endsWith('！') || message.endsWith('？')) {
            return message.slice(0, -1) + 'にゃ' + message.slice(-1);
        } else {
            return message + 'にゃ';
        }
    }
    return message;
}

// システムメッセージ（改善版）
const SYSTEM_MESSAGES = {
    welcome: (userName) => `いらっしゃいませ${userName ? `、${userName}さん` : ''}。私は神社にいる「つきみ」という猫です。今日はどのようなことでお心を痛めていらっしゃいますか？お気軽にお話しくださいにゃ 🐾⛩️`,
    
    dailyLimitReached: (userName) => `${userName ? `${userName}さん、` : ''}今日の相談回数の上限に達しました。心の整理には時間も大切ですので、また明日お参りくださいにゃ。きっと新しい気づきがあるはずです 🙏`,
    
    remainingTurns: (remaining, userName) => `${userName ? `${userName}さん、` : ''}今日はあと${remaining}回までお話しできます。大切なお時間、心を込めてお聞きしますにゃ`,
    
    maxUsersReached: "申し訳ございません。現在多くの方がいらっしゃるため、新しい相談をお受けできません。少し時間をおいてからお参りください 🙏",
};

// お焚き上げ関連関数（改善版）
function isQuestionAboutPurification(message) {
    const questionPatterns = [
        'って何', 'とは', 'について教えて', 'どんなもの', 'なんですか',
        '？', '何ですか', 'わからない', '知らない', 'どういう意味',
        'って何ですか', 'とは何ですか', 'どういうこと'
    ];
    
    const hasPurificationWord = message.includes('お焚き上げ') || message.includes('たきあげ');
    const hasQuestionPattern = questionPatterns.some(pattern => message.includes(pattern));
    
    return hasPurificationWord && hasQuestionPattern;
}

function shouldSuggestPurification(userId, message, history) {
    if (history.length < 3) return false;
    
    const lastPurification = purificationHistory.get(userId);
    if (lastPurification) {
        const hoursSince = (Date.now() - lastPurification) / (1000 * 60 * 60);
        if (hoursSince < 1) return false;
    }
    
    const endingKeywords = [
        'ありがとう', 'ありがとございます', 'スッキリ', 'すっきり',
        '楽になった', '軽くなった', '話せてよかった', '聞いてくれて',
        'おかげで', '助かった', '気が楽に', '安心した',
        '落ち着いた', '整理できた'
    ];
    
    return endingKeywords.some(keyword => message.includes(keyword));
}

function shouldExecutePurification(message) {
    // 質問文の場合は実行しない
    if (isQuestionAboutPurification(message)) {
        return false;
    }
    
    // 明確な実行意志を示すキーワードのみ
    const executeKeywords = [
        'お焚き上げして', 'お焚き上げをお願い', 'お焚き上げお願いします',
        'リセットして', '手放したい', '忘れたい', 'お清めして',
        '浄化して', '燃やして', 'リセットお願い'
    ];
    
    return executeKeywords.some(keyword => 
        message.toLowerCase().includes(keyword.toLowerCase())
    );
}

function getPurificationSuggestion(userName) {
    const name = userName ? `${userName}さんの` : 'あなたの';
    const suggestions = [
        `今日お話しした${name}心の重荷を、神聖な炎でお焚き上げしてお清めしましょうか？きっと心が軽やかになりますにゃ 🔥⛩️`,
        `${name}心に溜まったものをお焚き上げで清めるのはいかがでしょう？新しい気持ちで歩めるはずにゃ 🔥`,
        `今日の重い気持ちを、温かい炎で包んでお清めしませんか？${name}心の浄化のお手伝いをさせていただきますにゃ 🔥✨`
    ];
    
    return suggestions[Math.floor(Math.random() * suggestions.length)];
}

function getExplanationResponse() {
    const explanations = [
        "お焚き上げというのは、心に溜まった重い気持ちや悩みを、神聖な炎で清めて手放す儀式のことですにゃ。今日お話しした内容を整理して、心を軽やかにするお手伝いをするのです ✨",
        "お焚き上げは、心の浄化の儀式にゃ。お話しした悩みや重い気持ちを温かい炎で包んで、新しい気持ちで歩めるようにするものですよ 🔥 希望されるときにお手伝いします"
    ];
    return explanations[Math.floor(Math.random() * explanations.length)];
}

async function executePurification(userId, replyToken, client) {
    try {
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        
        purificationHistory.set(userId, Date.now());
        updateDailyMetrics(userId, 'purification');
        
        console.log(`お焚き上げ開始: ${userName || 'Unknown'} (${userId.substring(0, 8)}...)`);
        
        const stages = [
            {
                message: `それでは、今日お話しした${userName ? `${userName}さんの` : ''}心の重荷をそっとお焚き上げさせていただきますにゃ 🔥⛩️`,
                delay: 0
            },
            {
                message: "🔥 メラメラ... パチパチ... 今日の悩みや重たい気持ちが温かい神聖な炎に包まれて...",
                delay: 3000
            },
            {
                message: `🌟 お焚き上げが完了しました。${userName ? `${userName}さんの` : 'あなたの'}心に新しい風が吹いて、清らかな気持ちになりましたにゃ ✨⛩️`,
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

// 統計更新関数
function updateDailyMetrics(userId, action) {
    const today = new Date().toISOString().split('T')[0];
    
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
            break;
    }
}

// 利用制限チェック
function checkDailyLimit(userId) {
    const today = new Date().toISOString().split('T')[0];
    const usage = dailyUsage.get(userId) || { date: '', count: 0 };
    
    if (usage.date !== today) {
        usage.date = today;
        usage.count = 0;
        dailyUsage.set(userId, usage);
    }
    
    return usage.count < LIMITS.DAILY_TURN_LIMIT;
}

function updateDailyUsage(userId) {
    const today = new Date().toISOString().split('T')[0];
    const usage = dailyUsage.get(userId) || { date: today, count: 0 };
    usage.count++;
    dailyUsage.set(userId, usage);
    return usage.count;
}

function getRemainingTurns(userId) {
    const today = new Date().toISOString().split('T')[0];
    const usage = dailyUsage.get(userId) || { date: today, count: 0 };
    return LIMITS.DAILY_TURN_LIMIT - usage.count;
}

// 制限関連質問の判定
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

function getLimitExplanation(remainingTurns, userName) {
    const name = userName ? `${userName}さん` : 'あなた';
    return `${name}は今日あと${remainingTurns}回まで私とお話しできますにゃ。1日の上限は10回までとなっていて、毎日リセットされるのです 🐾`;
}

// AI応答生成（改善版）
async function generateAIResponse(message, history, userId, client) {
    try {
        // ユーザープロフィール取得
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        const remainingTurns = getRemainingTurns(userId);
        
        // 制限関連の質問チェック
        if (isAskingAboutLimits(message)) {
            return getLimitExplanation(remainingTurns, userName);
        }
        
        // お焚き上げの質問チェック
        if (isQuestionAboutPurification(message)) {
            return getExplanationResponse();
        }
        
        // 会話履歴をOpenAI形式に変換
        const messages = [
            { role: 'system', content: getCharacterPersonality(userName, remainingTurns) },
            ...history,
            { role: 'user', content: message }
        ];
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            max_tokens: 150,
            temperature: 0.8,
        });
        
        let aiResponse = response.choices[0].message.content;
        return addCatSuffix(aiResponse);
        
    } catch (error) {
        console.error('OpenAI API エラー:', error.message);
        return "申し訳ございません。今少し考え事をしていて、うまくお答えできませんでした。もう一度お話しいただけますか？にゃ";
    }
}

// LINE クライアント設定
const client = new line.Client(config);

// =================================
// Webhookエンドポイント（最優先設定）
// =================================

// Webhook処理（LINE middleware使用）
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
        res.status(500).json({ error: 'Webhook処理エラー' });
    }
});

// メインイベント処理（改善版）
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return;
    }
    
    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    
    try {
        // ユーザープロフィール取得（キャッシュ済みの場合は取得しない）
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        
        console.log(`メッセージ受信: ${userName || 'Unknown'} (${userId.substring(0, 8)}...) - "${userMessage}"`);
        
        // 新規ユーザーの制限チェック
        if (!userSessions.has(userId) && userSessions.size >= LIMITS.MAX_USERS) {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.maxUsersReached
            });
            return;
        }
        
        userSessions.add(userId);
        lastMessageTime.set(userId, Date.now());
        
        // お焚き上げ実行チェック（改善版）
        if (shouldExecutePurification(userMessage)) {
            await executePurification(userId, replyToken, client);
            return;
        }
        
        // 日次制限チェック
        if (!checkDailyLimit(userId)) {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.dailyLimitReached(userName)
            });
            return;
        }
        
        // 会話履歴の管理
        let history = conversationHistory.get(userId) || [];
        
        // 初回メッセージの場合（改善版）
        if (history.length === 0) {
            const welcomeMessage = SYSTEM_MESSAGES.welcome(userName);
            
            await client.replyMessage(replyToken, {
                type: 'text',
                text: welcomeMessage
            });
            
            history.push({ role: 'assistant', content: welcomeMessage });
            conversationHistory.set(userId, history);
            updateDailyMetrics(userId, 'turn');
            return;
        }
        
        // AI応答生成（改善版）
        const aiResponse = await generateAIResponse(userMessage, history, userId, client);
        
        // お焚き上げ提案の確認
        let finalResponse = aiResponse;
        if (shouldSuggestPurification(userId, userMessage, history)) {
            finalResponse = aiResponse + "\n\n" + getPurificationSuggestion(userName);
        }
        
        // 使用回数更新と残数通知
        const usageCount = updateDailyUsage(userId);
        const remaining = LIMITS.DAILY_TURN_LIMIT - usageCount;
        
        if (remaining <= 3 && remaining > 0) {
            finalResponse += "\n\n" + SYSTEM_MESSAGES.remainingTurns(remaining, userName);
        }
        
        // 会話履歴更新
        history.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: aiResponse }
        );
        
        if (history.length > 20) {
            history = history.slice(-20);
        }
        
        conversationHistory.set(userId, history);
        updateDailyMetrics(userId, 'turn');
        
        await client.replyMessage(replyToken, {
            type: 'text',
            text: finalResponse
        });
        
        console.log(`応答送信完了: ${userName || 'Unknown'} (${userId.substring(0, 8)}...)`);
        
    } catch (error) {
        console.error('メッセージ処理エラー:', error);
        try {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: "申し訳ございません。お話を聞く準備ができませんでした。少し時間をおいてからもう一度お参りくださいにゃ 🙏"
            });
        } catch (replyError) {
            console.error('エラー応答送信失敗:', replyError);
        }
    }
}

// 自動クリーンアップ関数
function cleanupInactiveSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, timestamp] of lastMessageTime) {
        if (now - timestamp > LIMITS.SESSION_TIMEOUT) {
            conversationHistory.delete(userId);
            lastMessageTime.delete(userId);
            userSessions.delete(userId);
            // プロフィールは保持（再取得コスト削減）
            cleanedCount++;
            
            console.log(`セッション削除: ユーザー${userId.substring(0, 8)}... (30分非アクティブ)`);
        }
    }
    
    for (const [userId, timestamp] of purificationHistory) {
        if (now - timestamp > 24 * 60 * 60 * 1000) {
            purificationHistory.delete(userId);
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
        console.log(`自動クリーンアップ実行: ${cleanedCount}セッション削除`);
    }
}

// 定期クリーンアップの実行
setInterval(cleanupInactiveSessions, LIMITS.CLEANUP_INTERVAL);

// =================================
// 管理機能エンドポイント（統合版）
// =================================

// トップページ
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
            <p>サーバーは正常に稼働していますにゃ ✨</p>
            <div style="margin-top: 30px;">
                <a href="/health" style="background: #55a3ff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 0 10px;">ヘルスチェック</a>
                <a href="/admin" style="background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 0 10px;">管理画面</a>
            </div>
        </body>
        </html>
    `);
});

// ヘルスチェックエンドポイント
app.get('/health', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyMetrics.get(today) || { users: new Set(), turns: 0, purifications: 0 };
    
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'つきみ（猫神主Bot）',
        version: '1.1.0',
        uptime: Math.floor(process.uptime()),
        environment: {
            node_version: process.version,
            platform: process.platform,
            memory_usage: {
                rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
            }
        },
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
            dailyTurnLimit: LIMITS.DAILY_TURN_LIMIT,
            sessionTimeout: LIMITS.SESSION_TIMEOUT / 60000 + '分',
            cleanupInterval: LIMITS.CLEANUP_INTERVAL / 60000 + '分'
        },
        improvements: {
            version: '1.1.0',
            features: [
                'ユーザー名での呼び掛け対応',
                'お焚き上げ誤発動防止',
                '制限回数の正確な回答',
                '共感重視のキャラクター調整'
            ]
        },
        message: "つきみが元気に稼働中ですにゃ ✨"
    };
    
    res.json(health);
});

// 管理メニュー
app.get('/admin', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyMetrics.get(today) || { users: new Set(), turns: 0, purifications: 0 };
    
    res.send(`
        <html>
        <head>
            <title>つきみ 管理メニュー</title>
            <meta charset="UTF-8">
            <style>
                body { 
                    font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif; 
                    margin: 20px 0;
                    text-align: center;
                    font-weight: bold;
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
                .version {
                    background: #e17055;
                    color: white;
                    padding: 5px 10px;
                    border-radius: 15px;
                    font-size: 0.8em;
                    margin-left: 10px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🐱⛩️ つきみ 管理メニュー <span class="version">v1.1.0</span></h1>
                    <div class="status">
                        ✅ サーバー稼働中 | 総参拝者: ${stats.totalUsers.size}名 | 本日: ${todayStats.users.size}名 | 総相談: ${stats.totalTurns}回
                    </div>
                </div>
                
                <a href="/health" class="menu-item">
                    ❤️ ヘルスチェック (JSON形式)
                </a>
                
                <a href="/admin/stats" class="menu-item">
                    📊 統計ダッシュボード
                </a>
                
                <a href="#" onclick="cleanup()" class="menu-item">
                    🧹 手動クリーンアップ
                </a>
                
                <a href="/test" class="menu-item">
                    🧪 システムテスト
                </a>
            </div>
            
            <script>
                async function cleanup() {
                    if (confirm('非アクティブセッションをクリーンアップしますか？')) {
                        try {
                            const response = await fetch('/admin/cleanup', { 
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' }
                            });
                            const result = await response.json();
                            alert('クリーンアップ完了にゃ\\n削除セッション数: ' + result.cleaned);
                            location.reload();
                        } catch (error) {
                            alert('エラーが発生しました: ' + error.message);
                        }
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// 統計ダッシュボード
app.get('/admin/stats', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyMetrics.get(today) || { users: new Set(), turns: 0, purifications: 0 };
    
    // 過去7日間のデータ
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
            <title>つきみ 統計情報</title>
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
                .improvements {
                    background: #00b894;
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
                    <h1>🐱⛩️ つきみ統計情報 ⛩️🐱</h1>
                    <p>最終更新: ${new Date().toLocaleString('ja-JP')}</p>
                </div>
                
                <div class="improvements">
                    <h3>🆕 v1.1.0 改善内容</h3>
                    <ul style="text-align: left; margin: 10px 0;">
                        <li>✅ ユーザー名での呼び掛け対応</li>
                        <li>✅ お焚き上げ誤発動防止</li>
                        <li>✅ 制限回数の正確な回答</li>
                        <li>✅ 共感重視のキャラクター調整</li>
                        <li>✅ キャラクター名「つきみ」設定</li>
                    </ul>
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
                    <p>🐾 つきみが皆さんの心に寄り添っています 🐾</p>
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

// 手動クリーンアップ
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
        timestamp: new Date().toISOString(),
        before,
        after,
        cleaned: cleanedCount
    });
});

// テストエンドポイント
app.get('/test', (req, res) => {
    res.json({
        message: 'つきみは元気ですにゃ！',
        timestamp: new Date().toISOString(),
        version: '1.1.0',
        webhook_url: req.get('host') + '/webhook',
        environment_check: {
            line_secret: !!process.env.LINE_CHANNEL_SECRET,
            line_token: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
            openai_key: !!process.env.OPENAI_API_KEY
        },
        improvements: [
            'ユーザー名での呼び掛け',
            'お焚き上げ誤発動防止',
            '制限回数の正確回答',
            '共感重視キャラクター'
        ]
    });
});

// サーバー開始
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🐱⛩️ つきみ（猫神主Bot）が起動しました ⛩️🐱');
    console.log(`ポート: ${PORT}`);
    console.log(`環境: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('=== 🏛️ システム情報 ===');
    console.log(`最大ユーザー数: ${LIMITS.MAX_USERS}名`);
    console.log(`1日の制限: ${LIMITS.DAILY_TURN_LIMIT}ターン`);
    console.log(`セッション時間: ${LIMITS.SESSION_TIMEOUT / 60000}分`);
    console.log(`クリーンアップ間隔: ${LIMITS.CLEANUP_INTERVAL / 60000}分`);
    console.log('');
    console.log('=== 🆕 v1.1.0 改善内容 ===');
    console.log('• ユーザー名での呼び掛け対応');
    console.log('• お焚き上げ誤発動防止');
    console.log('• 制限回数の正確な回答');
    console.log('• 共感重視のキャラクター調整');
    console.log('• キャラクター名「つきみ」設定');
    console.log('===========================');
    console.log('');
    console.log('=== 🎯 PMF検証項目 ===');
    console.log('• お焚き上げ利用率: 目標30%以上');
    console.log('• 平均相談ターン数: 目標+2-3ターン');
    console.log('• ユーザー継続率: 翌日再利用率');
    console.log('• 会話品質: 誤動作・混乱の削減');
    console.log('========================');
    console.log('');
    console.log('つきみが神社でお待ちしていますにゃ... 🐾');
    
    // 起動時の環境変数チェック
    const requiredEnvs = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'OPENAI_API_KEY'];
    const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
    
    if (missingEnvs.length > 0) {
        console.error('❌ 不足している環境変数:', missingEnvs.join(', '));
        console.error('Renderの環境変数設定を確認してください');
    } else {
        console.log('✅ 環境変数設定完了');
        console.log('✅ 会話品質改善版(v1.1.0)準備完了');
    }
});: 20px; 
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
                    margin
