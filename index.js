// 猫神主Bot - Webhook修正版
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

// テスト用エンドポイント（Webhook動作確認）
app.get('/test', (req, res) => {
    res.json({
        message: '猫神主Botは元気ですにゃ！',
        timestamp: new Date().toISOString(),
        webhook_url: req.get('host') + '/webhook',
        environment_check: {
            line_secret: !!process.env.LINE_CHANNEL_SECRET,
            line_token: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
            openai_key: !!process.env.OPENAI_API_KEY
        }
    });
});

// Webhook動作テスト用（POST）
app.post('/test-webhook', express.json(), (req, res) => {
    console.log('🧪 テストWebhook受信:', JSON.stringify(req.body, null, 2));
    res.json({ message: 'テストWebhook受信成功にゃ', received: req.body });
});

// 制限設定
const LIMITS = {
  MAX_USERS: 100,
  DAILY_TURN_LIMIT: 10,
  SESSION_TIMEOUT: 30 * 60 * 1000,
  CLEANUP_INTERVAL: 5 * 60 * 1000,
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

話し相手の悩みを真剣に聞き、心が軽くなるような温かいアドバイスを心がけてください。
`;

// データ管理
const conversationHistory = new Map();
const dailyUsage = new Map();
const lastMessageTime = new Map();
const userSessions = new Set();
const purificationHistory = new Map();

// 統計データ
const stats = {
    totalUsers: new Set(),
    dailyTurns: 0,
    totalTurns: 0,
    purificationCount: 0,
    dailyMetrics: new Map(),
};

// 語尾処理関数
function addCatSuffix(message) {
    if (Math.random() < 0.3) {
        if (!message.endsWith('にゃ') && !message.endsWith('にゃ。')) {
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
        purificationHistory.set(userId, Date.now());
        updateDailyMetrics(userId, 'purification');
        
        console.log(`お焚き上げ開始: ユーザー${userId.substring(0, 8)}...`);
        
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

// AI応答生成
async function generateAIResponse(message, history) {
    try {
        const messages = [
            { role: 'system', content: CHARACTER_PERSONALITY },
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
        res.status(200).end();
    }
});

// =================================
// 管理機能エンドポイント（統合版）
// =================================

// トップページ
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>猫神主Bot</title>
            <meta charset="UTF-8">
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #ffeaa7, #fab1a0);">
            <h1>🐱⛩️ 猫神主Bot ⛩️🐱</h1>
            <p>神社の猫があなたの心の相談をお聞きします</p>
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
        service: '猫神主Bot',
        version: '1.0.0',
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
            purificationRate: stats.totalTurns > 0 ? (stats.purificationCount / stats.totalTurns * 100).toFixed(1) + '%' : '0%'
        },
        limits: {
            maxUsers: LIMITS.MAX_USERS,
            dailyTurnLimit: LIMITS.DAILY_TURN_LIMIT,
            sessionTimeout: LIMITS.SESSION_TIMEOUT / 60000 + '分',
            cleanupInterval: LIMITS.CLEANUP_INTERVAL / 60000 + '分'
        },
        message: "神社の猫が元気に稼働中ですにゃ ✨"
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
            <title>猫神主Bot 管理メニュー</title>
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
                    <h1>🐱⛩️ 猫神主Bot 管理メニュー</h1>
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
            </div>
            
            <script>
                async function cleanup() {
                    if (confirm('非アクティブセッションをクリーンアップしますか？')) {
                        try {
                            const response = await fetch('/admin/cleanup', { method: 'POST' });
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
            <title>猫神主Bot 統計情報</title>
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
                    <h1>🐱⛩️ 猫神主Bot 統計情報 ⛩️🐱</h1>
                    <p>最終更新: ${new Date().toLocaleString('ja-JP')}</p>
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
                        <div class="stat-number">${(stats.totalTurns / Math.max(stats.totalUsers.size, 1)).toFixed(1)}</div>
                        <div class="stat-label">📈 平均相談数/人</div>
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
                    <p>🐾 神主猫が皆さんの心を清めるお手伝いをしています 🐾</p>
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

// =================================
// LINE Webhook処理
// =================================

// Webhook処理
app.post('/webhook', line.middleware(config), async (req, res) => {
    try {
        console.log('📨 Webhook受信:', req.body);
        res.status(200).end();
        
        const events = req.body.events;
        console.log(`📨 イベント数: ${events.length}`);
        
        events.forEach(event => {
            setImmediate(() => handleEvent(event));
        });
        
    } catch (error) {
        console.error('❌ Webhook処理エラー:', error);
        res.status(200).end();
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
            updateDailyMetrics(userId, 'turn');
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
        
        if (history.length > 20) {
            history = history.slice(-20);
        }
        
        conversationHistory.set(userId, history);
        updateDailyMetrics(userId, 'turn');
        
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

// サーバー開始
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🐱⛩️ 猫神主Botが起動しました ⛩️🐱');
    console.log(`ポート: ${PORT}`);
    console.log(`環境: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('=== 🏛️ システム情報 ===');
    console.log(`最大ユーザー数: ${LIMITS.MAX_USERS}名`);
    console.log(`1日の制限: ${LIMITS.DAILY_TURN_LIMIT}ターン`);
    console.log(`セッション時間: ${LIMITS.SESSION_TIMEOUT / 60000}分`);
    console.log(`クリーンアップ間隔: ${LIMITS.CLEANUP_INTERVAL / 60000}分`);
    console.log('');
    console.log('=== 🎯 PMF検証項目 ===');
    console.log('• お焚き上げ利用率: 目標30%以上');
    console.log('• 平均相談ターン数: 目標+2-3ターン');
    console.log('• ユーザー継続率: 翌日再利用率');
    console.log('========================');
    console.log('');
    console.log('神社でお待ちしていますにゃ... 🐾');
    
    // 起動時の環境変数チェック
    const requiredEnvs = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'OPENAI_API_KEY'];
    const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
    
    if (missingEnvs.length > 0) {
        console.error('❌ 不足している環境変数:', missingEnvs.join(', '));
        console.error('Renderの環境変数設定を確認してください');
    } else {
        console.log('✅ 環境変数設定完了');
    }
});
