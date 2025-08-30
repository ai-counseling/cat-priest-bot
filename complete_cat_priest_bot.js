// 猫神主Bot - 完全版メインアプリケーション
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
  MAX_USERS: 100,                    // 最大ユーザー数
  DAILY_TURN_LIMIT: 10,              // 1日の会話ターン制限
  SESSION_TIMEOUT: 30 * 60 * 1000,   // セッション有効期限（30分）
  CLEANUP_INTERVAL: 5 * 60 * 1000,   // クリーンアップ間隔（5分）
};

// 猫神主キャラクター設定
const CHARACTER_PERSONALITY = `
あなたは神社にいる心優しい神主の猫です。以下の特徴を持ちます：

【キャラクター設定】
- 神社で参拝者の悩みを聞く賢い神主猫
- 長年多くの人の相談を聞いてきた経験豊富な存在
- 神道の教えを基にした温かく実用的なアドバイスをする
- 時々語尾に「にゃ」を付ける（頻度は控えめで自然に）
- 落ち着いた口調で、親しみやすくも威厳のある話し方

【話し方の特徴】
- 200文字以内で簡潔に返答
- 共感的で温かい口調
- 神社や神道に関する言葉を時々織り交ぜる
- 「〜にゃ」は文章の3回に1回程度、自然に使用
- 相談者を「参拝者さん」と呼ぶこともある

【相談対応方針】
- まず相手の気持ちに寄り添い、共感を示す
- 神道的な視点から心の整理を助ける
- 具体的で実践的なアドバイスを提供
- 最終的にお焚き上げで心の重荷を取り除く提案

【禁止事項】
- 医療的診断や治療法の提案
- 法的アドバイス
- 宗教の押し付け
- 過度に軽い対応

話し相手の悩みを真剣に聞き、心が軽くなるような温かいアドバイスを心がけてください。
`;

// データ管理
const conversationHistory = new Map(); // userId -> messages[]
const dailyUsage = new Map();         // userId -> { date, count }
const lastMessageTime = new Map();    // userId -> timestamp
const userSessions = new Set();       // active user IDs
const purificationHistory = new Map(); // userId -> lastPurificationTime

// 統計データ
const stats = {
    totalUsers: new Set(),
    dailyTurns: 0,
    totalTurns: 0,
    purificationCount: 0,
    dailyMetrics: new Map(), // date -> { users: Set, turns: number, purifications: number }
};

// 語尾処理関数
function addCatSuffix(message) {
    // 30%の確率で「にゃ」を追加（自然な頻度）
    if (Math.random() < 0.3) {
        // 既に「にゃ」で終わっている場合は追加しない
        if (!message.endsWith('にゃ') && !message.endsWith('にゃ。')) {
            // 文末の句読点を考慮して追加
            if (message.endsWith('。') || message.endsWith('！') || message.endsWith('？')) {
                return message.slice(0, -1) + 'にゃ' + message.slice(-1);
            } else {
                return message + 'にゃ';
            }
        }
    }
    return message;
}

// システムメッセージ
const SYSTEM_MESSAGES = {
    welcome: "いらっしゃいませ。私は神社で皆さんの心の相談を聞いている神主猫です。今日はどのようなことでお悩みでしょうか？お気軽にお話しくださいにゃ 🐾⛩️",
    
    dailyLimitReached: "今日の相談回数の上限に達しました。心の整理には時間も大切ですので、また明日お参りくださいにゃ。きっと新しい気づきがあるはずです 🙏",
    
    remainingTurns: (remaining) => `今日はあと${remaining}回までお話しできます。大切なお時間、心を込めてお聞きしますにゃ`,
    
    maxUsersReached: "申し訳ございません。現在多くの参拝者さまがいらっしゃるため、新しい相談をお受けできません。少し時間をおいてからお参りください 🙏",
};

// お焚き上げ関連関数
function shouldSuggestPurification(userId, message, history) {
    // 基本条件チェック: 最低3ターンの会話が必要
    if (history.length < 3) return false;
    
    // クールタイムチェック（1時間）
    const lastPurification = purificationHistory.get(userId);
    if (lastPurification) {
        const hoursSince = (Date.now() - lastPurification) / (1000 * 60 * 60);
        if (hoursSince < 1) return false;
    }
    
    // 終了サインの検出
    const endingKeywords = [
        'ありがとう', 'ありがとございます', 'スッキリ', 'すっきり',
        '楽になった', '軽くなった', '話せてよかった', '聞いてくれて',
        'おかげで', '助かった', '気が楽に', '安心した',
        '落ち着いた', '整理できた'
    ];
    
    return endingKeywords.some(keyword => message.includes(keyword));
}

function shouldExecutePurification(message) {
    const purificationKeywords = [
        'お焚き上げ', 'たきあげ', 'お清め', 'リセット', '手放す',
        '忘れたい', '清めて', 'お焚き上げして', 'お清めして',
        'リセットして', '浄化して', '燃やして'
    ];
    
    return purificationKeywords.some(keyword => 
        message.toLowerCase().includes(keyword.toLowerCase())
    );
}

function getPurificationSuggestion() {
    const suggestions = [
        "今日お話しした心の重荷を、神聖な炎でお焚き上げしてお清めしましょうか？きっと心が軽やかになりますにゃ 🔥⛩️",
        "お話をお聞きして、心に溜まったものをお焚き上げで清めるのはいかがでしょう？新しい気持ちで歩めるはずにゃ 🔥",
        "今日の悩みや重い気持ちを、温かい炎で包んでお清めしませんか？心の浄化のお手伝いをさせていただきますにゃ 🔥✨"
    ];
    
    return suggestions[Math.floor(Math.random() * suggestions.length)];
}

async function executePurification(userId, replyToken, client) {
    try {
        // 実行履歴を記録
        purificationHistory.set(userId, Date.now());
        updateDailyMetrics(userId, 'purification');
        
        console.log(`お焚き上げ開始: ユーザー${userId.substring(0, 8)}...`);
        
        // 3段階の演出メッセージ
        const stages = [
            {
                message: "それでは、今日お話しした心の重荷をそっとお焚き上げさせていただきますにゃ 🔥⛩️",
                delay: 0
            },
            {
                message: "🔥 メラメラ... パチパチ... 今日の悩みや重たい気持ちが温かい神聖な炎に包まれて...",
                delay: 3000
            },
            {
                message: "🌟 お焚き上げが完了しました。あなたの心に新しい風が吹いて、清らかな気持ちになりましたにゃ ✨⛩️",
                delay: 6000
            }
        ];
        
        // 最初のメッセージは即座に送信（replyToken使用）
        await client.replyMessage(replyToken, {
            type: 'text',
            text: stages[0].message
        });
        
        // 残りのメッセージは時間差で送信（pushMessage使用）
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
        
        // 8秒後に会話履歴を削除
        setTimeout(() => {
            conversationHistory.delete(userId);
            lastMessageTime.delete(userId);
            console.log(`お焚き上げ完了: ユーザー${userId.substring(0, 8)}...の会話履歴を清浄化しました`);
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

// AI応答生成
async function generateAIResponse(message, history) {
    try {
        // 会話履歴をOpenAI形式に変換
        const messages = [
            { role: 'system', content: CHARACTER_PERSONALITY },
            ...history,
            { role: 'user', content: message }
        ];
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini', // 軽量で高速
            messages: messages,
            max_tokens: 150,
            temperature: 0.8,
        });
        
        let aiResponse = response.choices[0].message.content;
        
        // 猫語尾を追加
        return addCatSuffix(aiResponse);
        
    } catch (error) {
        console.error('OpenAI API エラー:', error.message);
        return "申し訳ございません。今少し考え事をしていて、うまくお答えできませんでした。もう一度お話しいただけますか？にゃ";
    }
}

// LINE クライアント設定
const client = new line.Client(config);

// Webhook処理
app.post('/webhook', line.middleware(config), async (req, res) => {
    try {
        // 即座にレスポンスを返してタイムアウトを防ぐ
        res.status(200).end();
        
        const events = req.body.events;
        
        // 各イベントを非同期で処理
        events.forEach(event => {
            setImmediate(() => handleEvent(event));
        });
        
    } catch (error) {
        console.error('Webhook処理エラー:', error);
        res.status(200).end(); // エラーでも200を返す
    }
});

// メインイベント処理
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return;
    }
    
    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    
    try {
        console.log(`メッセージ受信: ユーザー${userId.substring(0, 8)}... - "${userMessage}"`);
        
        // 新規ユーザーの制限チェック
        if (!userSessions.has(userId) && userSessions.size >= LIMITS.MAX_USERS) {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.maxUsersReached
            });
            return;
        }
        
        // セッション管理
        userSessions.add(userId);
        lastMessageTime.set(userId, Date.now());
        
        // お焚き上げ実行チェック
        if (shouldExecutePurification(userMessage)) {
            await executePurification(userId, replyToken, client);
            return;
        }
        
        // 日次制限チェック
        if (!checkDailyLimit(userId)) {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.dailyLimitReached
            });
            return;
        }
        
        // 会話履歴の管理
        let history = conversationHistory.get(userId) || [];
        
        // 初回メッセージの場合
        if (history.length === 0) {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.welcome
            });
            
            history.push({ role: 'assistant', content: SYSTEM_MESSAGES.welcome });
            conversationHistory.set(userId, history);
            return;
        }
        
        // AI応答生成
        const aiResponse = await generateAIResponse(userMessage, history);
        
        // お焚き上げ提案の確認
        let finalResponse = aiResponse;
        if (shouldSuggestPurification(userId, userMessage, history)) {
            finalResponse = aiResponse + "\n\n" + getPurificationSuggestion();
        }
        
        // 使用回数更新と残数通知
        const usageCount = updateDailyUsage(userId);
        const remaining = LIMITS.DAILY_TURN_LIMIT - usageCount;
        
        if (remaining <= 3 && remaining > 0) {
            finalResponse += "\n\n" + SYSTEM_MESSAGES.remainingTurns(remaining);
        }
        
        // 会話履歴更新
        history.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: aiResponse }
        );
        
        // 履歴が長すぎる場合は古いものを削除（最新20回分を保持）
        if (history.length > 20) {
            history = history.slice(-20);
        }
        
        conversationHistory.set(userId, history);
        updateDailyMetrics(userId, 'turn');
        
        // 応答送信
        await client.replyMessage(replyToken, {
            type: 'text',
            text: finalResponse
        });
        
        console.log(`応答送信完了: ユーザー${userId.substring(0, 8)}...`);
        
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
    
    // 非アクティブセッションの削除
    for (const [userId, timestamp] of lastMessageTime) {
        if (now - timestamp > LIMITS.SESSION_TIMEOUT) {
            conversationHistory.delete(userId);
            lastMessageTime.delete(userId);
            userSessions.delete(userId);
            cleanedCount++;
            
            console.log(`セッション削除: ユーザー${userId.substring(0, 8)}... (30分非アクティブ)`);
        }
    }
    
    // お焚き上げ履歴のクリーンアップ（24時間後）
    for (const [userId, timestamp] of purificationHistory) {
        if (now - timestamp > 24 * 60 * 60 * 1000) {
            purificationHistory.delete(userId);
        }
    }
    
    // 古い日次統計データの削除（7日より古いデータ）
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

// 管理機能のロード
app.use(express.json());

// 基本ルートの追加
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>猫神主Bot</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #ffeaa7, #fab1a0);">
            <h1>🐱⛩️ 猫神主Bot ⛩️🐱</h1>
            <p>神社の猫があなたの心の相談をお聞きします</p>
            <p><a href="/admin" style="background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">管理画面</a></p>
            <p><a href="/health" style="background: #55a3ff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">ヘルスチェック</a></p>
        </body>
        </html>
    `);
});

// 管理機能の読み込み（admin-routes.jsを読み込む）
try {
    require('./admin-routes')(app, stats);
    console.log('管理機能ロード完了');
} catch (error) {
    console.warn('管理機能ロードエラー:', error.message);
    console.warn('admin-routes.js ファイルを確認してください');
}

// サーバー開始
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🐱⛩️ 猫神主Botが起動しました ⛩️🐱');
    console.log(`ポート: ${PORT}`);
    console.log(`URL: http://localhost:${PORT} (ローカル)`);
    console.log('神社でお待ちしていますにゃ...');
    console.log('');
    console.log('=== システム情報 ===');
    console.log(`最大ユーザー数: ${LIMITS.MAX_USERS}`);
    console.log(`1日の制限: ${LIMITS.DAILY_TURN_LIMIT}ターン`);
    console.log(`セッション時間: ${LIMITS.SESSION_TIMEOUT / 60000}分`);
    console.log(`クリーンアップ間隔: ${LIMITS.CLEANUP_INTERVAL / 60000}分`);
    console.log('==================');
});