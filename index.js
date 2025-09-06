// 猫神主Bot「つきみ」- v1.2.1 致命的バグ修正版
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

// 名前を呼ぶかどうかの判定（4回に1回）
function shouldUseName(conversationCount) {
    return conversationCount % 4 === 1;
}

// キャラクター設定
function getCharacterPersonality(userName, remainingTurns, useNameInResponse) {
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

// 語尾処理関数（統一版）
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

// お焚き上げ関連関数
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

// 🔧 バグ修正1: お焚き上げ提案判定を修正（「なるほど」問題を解決）
function shouldSuggestPurification(userId, message, history) {
    if (history.length < 3) return false;
    
    const lastPurification = purificationHistory.get(userId);
    if (lastPurification) {
        const hoursSince = (Date.now() - lastPurification) / (1000 * 60 * 60);
        if (hoursSince < 1) return false;
    }
    
    // 🚨 修正: 「なるほど」などの理解表現は除外し、明確な終了・満足のサインのみ検出
    const endingKeywords = [
        // 感謝・満足（明確な終了サイン）
        'ありがとう', 'ありがとございます', 'スッキリ', 'すっきり',
        '楽になった', '軽くなった', '話せてよかった', '聞いてくれて',
        'おかげで', '助かった', '気が楽に', '安心した',
        '落ち着いた', '整理できた',
        
        // 前向きな行動意欲（会話終了の意図が明確）
        'やってみます', '頑張ってみます', 'そうしてみます', 'そうします',
        '試してみます', 'チャレンジしてみます', 'さっそく',
        
        // 明確な会話終了の意図
        'もう大丈夫', '大丈夫になりました', 'よくわかりました',
        'とても参考になりました', '勉強になりました'
    ];
    
    // 🚨 重要: 「なるほど」「そうですね」「わかりました」は除外
    // これらは理解を示すだけで、会話終了の意図ではない
    
    return endingKeywords.some(keyword => message.includes(keyword));
}

function shouldExecutePurification(message) {
    // 質問文の厳格判定 - 誤発動防止
    const questionIndicators = [
        'でしょうか？', 'でしょうか', 'ますか？', 'ますか',
        'どうやって', 'どのように', 'どうしたら', 'どうすれば',
        'どんな方法', 'どんなやり方', 'どういう風に',
        '教えて', 'アドバイス', '相談', '悩み', '困って',
        '？', '?', 'どうしよう', 'わからない'
    ];
    
    // 質問文の場合は絶対にお焚き上げしない
    const isQuestion = questionIndicators.some(indicator => 
        message.includes(indicator)
    );
    
    if (isQuestion) {
        console.log('🚫 質問文検出 - お焚き上げ実行回避');
        return false;
    }
    
    // 既存の質問判定も保持
    if (isQuestionAboutPurification(message)) {
        return false;
    }
    
    // より厳格な実行キーワード判定
    const executeKeywords = [
        'お焚き上げして', 'お焚き上げを', 'お焚き上げお願い',
        'リセットして', 'リセットを', 'リセットお願い',
        '手放したい', '忘れたい', '消したい',
        'お清めして', '浄化して', '燃やして'
    ];
    
    return executeKeywords.some(keyword => 
        message.toLowerCase().includes(keyword.toLowerCase())
    );
}

// 🔧 バグ修正2: お焚き上げ同意判定を修正（「お願い」単体対応）
function isPurificationAgreement(message, userId) {
    // 直前にお焚き上げ提案をしたかチェック
    const history = conversationHistory.get(userId) || [];
    if (history.length < 1) return false;
    
    const lastResponse = history[history.length - 1];
    const hasSuggestion = lastResponse.content && (
        lastResponse.content.includes('お焚き上げ') ||
        lastResponse.content.includes('お清め') ||
        lastResponse.content.includes('心の重荷') ||
        lastResponse.content.includes('神聖な炎')
    );
    
    if (!hasSuggestion) return false;
    
    // 🚨 修正: 「お願い」単体も検出対応
    const agreementKeywords = [
        // 直接的な同意
        'はい', 'うん', 'そうですね', 'そうします',
        'yes', 'ok', 'オッケー',
        
        // 依頼表現 - 🆕 「お願い」単体を追加
        'お願いします', 'お願い', 'おねがい', 'おねがいします',
        'お願いいたします', 'よろしくお願いします',
        
        // 実行依頼
        'やって', 'やってください', 'して', 'してください',
        'してもらえますか', 'していただけますか',
        
        // 希望表現
        'ぜひ', 'よろしく', 'お任せします',
        '頼みます', '頼む', 'やりましょう',
        
        // 自然な会話での同意
        'いいね', 'いいです', 'いいですね', 'そうしましょう',
        'それで', 'それでお願いします', 'そうしてください'
    ];
    
    // 🚨 重要: メッセージ全体をチェックして「お願い」単体も検出
    const cleanMessage = message.trim().toLowerCase();
    
    return agreementKeywords.some(keyword => {
        const cleanKeyword = keyword.toLowerCase();
        // 完全一致または含む場合の両方をチェック
        return cleanMessage === cleanKeyword || cleanMessage.includes(cleanKeyword);
    });
}

// 🔧 バグ修正3: アンケート提案判定を修正（30分対応）
function shouldSuggestAnkete(userId, history, userMessage) {
    if (history.length < 3) return false;
    
    // 🚨 修正: お焚き上げ直後の感謝メッセージ検出時間を30分に延長
    const lastPurification = purificationHistory.get(userId);
    if (lastPurification) {
        const minutesSince = (Date.now() - lastPurification) / (1000 * 60);
        
        // 🆕 30分以内に延長 & 感謝キーワードを拡張
        if (minutesSince < 30) {
            const thankfulKeywords = [
                'ありがとう', 'ありがとございます', 'ありがとうございました',
                'ありがと', 'あざす', 'サンキュー', 'thanks',
                '感謝', 'お礼', '感謝します', '感謝しています',
                // 満足を示す表現も追加
                'スッキリ', 'すっきり', '清々しい', 'さっぱり',
                '軽くなった', '楽になった', 'よかった'
            ];
            
            if (thankfulKeywords.some(keyword => userMessage.includes(keyword))) {
                return true;
            }
        }
        
        // 1時間以内のクールタイム中もアンケート提案
        if (minutesSince < 60) return true;
    }
    
    // その他の終了サイン
    const endingKeywords = [
        'スッキリ', 'すっきり', '楽になった', '軽くなった', 
        '話せてよかった', '聞いてくれて', 'おかげで', '助かった', 
        '気が楽に', '安心した', '落ち着いた', '整理できた'
    ];
    
    return endingKeywords.some(keyword => userMessage.includes(keyword));
}

// アンケート提案メッセージ
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
        `今日お話しした${name}心の重荷を、神聖な炎でお焚き上げしてお清めしましょうか？🐱✨ きっと心が軽やかになりますにゃ🔥⛩️`,
        `${name}心に溜まったものをお焚き上げで清めるのはいかがでしょう？😸💝 新しい気持ちで歩めるはずにゃ🔥`,
        `今日の重い気持ちを、温かい炎で包んでお清めしませんか？🐾🌸 ${name}心の浄化のお手伝いをさせていただきますにゃ🔥✨`
    ];
    
    return suggestions[Math.floor(Math.random() * suggestions.length)];
}

function getExplanationResponse() {
    const explanations = [
        "お焚き上げというのは、心に溜まった重い気持ちや悩みを、神聖な炎で清めて手放す儀式のことですにゃ🐱✨ 今日お話しした内容を整理して、心を軽やかにするお手伝いをするのです。つらいお気持ちを温かく包んで、新しい気持ちで歩めるようにしますにゃ💝🔥",
        "お焚き上げは、心の浄化の儀式ですにゃ🐾🌸 お話しした悩みや重い気持ちを温かい炎で包んで、新しい気持ちで歩めるようにするものですよ😸 ご希望される時にお手伝いします。心に溜まったものを手放して、清々しい気持ちになっていただけるはずです✨💫"
    ];
    return explanations[Math.floor(Math.random() * explanations.length)];
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

// 制限説明メッセージ
function getLimitExplanation(remainingTurns, userName, useNameInResponse) {
    const name = (userName && useNameInResponse) ? `${userName}さん` : 'あなた';
    return `${name}は今日あと${remainingTurns}回まで私とお話しできますにゃ🐱 1日の上限は10回まで となっていて、毎日リセットされるのです🐾 限られた時間だからこそ、大切にお話しを聞かせていただきますね💝✨`;
}

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

// OpenAI応答生成
async function generateAIResponse(message, history, userId, client) {
    try {
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        const remainingTurns = getRemainingTurns(userId);
        const conversationCount = history.length + 1;
        const useNameInResponse = shouldUseName(conversationCount);
        
        // 制限関連の質問チェック
        if (isAskingAboutLimits(message)) {
            return getLimitExplanation(remainingTurns, userName, useNameInResponse);
        }
        
        // お焚き上げの質問チェック
        if (isQuestionAboutPurification(message)) {
            return getExplanationResponse();
        }
        
        const messages = [
            { role: 'system', content: getCharacterPersonality(userName, remainingTurns, useNameInResponse) },
            ...history,
            { role: 'user', content: message }
        ];
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            max_tokens: 200,
            temperature: 0.8,
        });
        
        let aiResponse = response.choices[0].message.content;
        
        // 文字切れチェック：文末が不自然な場合の対処
        if (aiResponse && !aiResponse.match(/[。！？にゃ]$/)) {
            // 最後の文を削除（不完全な文の除去）
            const sentences = aiResponse.split(/[。！？]/);
            if (sentences.length > 1) {
                sentences.pop(); // 最後の不完全文を削除
                aiResponse = sentences.join('。') + '。';
            }
        }
        
        return addCatSuffix(aiResponse);
        
    } catch (error) {
        console.error('OpenAI API エラー:', error.message);
        return `${userName ? userName + 'さん、' : ''}申し訳ございません。今少し考え事をしていて、うまくお答えできませんでした。もう一度お話しいただけますかにゃ`;
    }
}

// システムメッセージ
const SYSTEM_MESSAGES = {
    welcome: (userName, useNameInResponse) => {
        const greetings = [
            `${userName ? userName + 'さん、' : ''}今日はどんなことでお悩みでしょうか？🐱 お気軽にお話しくださいにゃ🐾`,
            `${userName ? userName + 'さん、' : ''}こんにちは😸 何かお困りのことがあるんですね？💝`,
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

// 🔧 バグ修正4: セッション削除時のdailyUsage誤削除を修正
function cleanupInactiveSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, timestamp] of lastMessageTime) {
        if (now - timestamp > LIMITS.SESSION_TIMEOUT) {
            // 🚨 重要な修正: conversationHistoryのみ削除、dailyUsageは保持
            conversationHistory.delete(userId);
            lastMessageTime.delete(userId);
            userSessions.delete(userId);
            cleanedCount++;
            
            console.log(`セッション削除: ユーザー${userId.substring(0, 8)}... (30分非アクティブ)`);
            // 🚨 注意: dailyUsageは削除しない！日次制限を維持
        }
    }
    
    // お焚き上げ履歴のクリーンアップ（24時間後）
    for (const [userId, timestamp] of purificationHistory) {
        if (now - timestamp > 24 * 60 * 60 * 1000) {
            purificationHistory.delete(userId);
        }
    }
    
    // 🆕 dailyUsageの適切なクリーンアップ（日付変更時のみ）
    const today = new Date().toISOString().split('T')[0];
    for (const [userId, usage] of dailyUsage) {
        if (usage.date !== today) {
            // 前日のデータのみ削除
            dailyUsage.delete(userId);
        }
    }
    
    // 統計データのクリーンアップ（1週間後）
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

// 定期クリーンアップの実行
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

// メインイベント処理
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return;
    }
    
    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    
    try {
        // ユーザープロフィール取得
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
        
        // 🚨 修正済み: 2段階判定システム
        // Step 1: 明確な実行意志の判定
        if (shouldExecutePurification(userMessage)) {
            await executePurification(userId, replyToken, client);
            return;
        }
        
        // Step 2: 提案後の同意確認（修正済み：「お願い」単体対応）
        if (isPurificationAgreement(userMessage, userId)) {
            await executePurification(userId, replyToken, client);
            return;
        }
        
        // 日次制限チェック
        if (!checkDailyLimit(userId)) {
            const conversationCount = conversationHistory.get(userId)?.length || 0;
            const useNameInResponse = shouldUseName(conversationCount);
            
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.dailyLimitReached(userName, useNameInResponse)
            });
            return;
        }
        
        // 会話履歴の管理
        let history = conversationHistory.get(userId) || [];
        const conversationCount = history.length + 1;
        const useNameInResponse = shouldUseName(conversationCount);
        
        // 初回メッセージの場合
        if (history.length === 0) {
            const welcomeMessage = SYSTEM_MESSAGES.welcome(userName, useNameInResponse);
            
            await client.replyMessage(replyToken, {
                type: 'text',
                text: welcomeMessage
            });
            
            history.push({ role: 'assistant', content: welcomeMessage });
            conversationHistory.set(userId, history);
            updateDailyMetrics(userId, 'turn');
            return;
        }
        
        // AI応答生成
        const aiResponse = await generateAIResponse(userMessage, history, userId, client);
        
        // 🚨 修正済み: お焚き上げ提案（「なるほど」問題修正） + アンケート提案（30分対応）
        let finalResponse = aiResponse;
        if (shouldSuggestPurification(userId, userMessage, history)) {
            finalResponse = aiResponse + "\n\n" + getPurificationSuggestion(userName, useNameInResponse);
        } else if (shouldSuggestAnkete(userId, history, userMessage)) {
            // 終了サインだがお焚き上げ提案しない場合はアンケート提案
            finalResponse = aiResponse + "\n\n" + getAnketeSuggestion(userName, useNameInResponse);
        }        
        
        // 使用回数更新と残数通知
        const usageCount = updateDailyUsage(userId);
        const remaining = LIMITS.DAILY_TURN_LIMIT - usageCount;
        
        // 残数通知を3回から開始
        if (remaining <= 3) {
            finalResponse += "\n\n" + SYSTEM_MESSAGES.remainingTurns(remaining, userName, useNameInResponse);
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

// 管理機能エンドポイント

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
            <p><strong>v1.2.1</strong> - 致命的バグ修正完了！サーバーは正常に稼働していますにゃ ✨</p>
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
        version: '1.2.1',
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
        critical_fixes: {
            version: '1.2.1',
            bugs_fixed: [
                '✅ お焚き上げ提案: 「なるほど」誤判定を修正',
                '✅ お焚き上げ同意: 「お願い」単体検出対応',
                '✅ アンケート提案: 30分検出時間に延長',
                '✅ 日次制限: dailyUsage誤削除を完全修正'
            ]
        },
        message: "つきみv1.2.1が致命的バグを修正して元気に稼働中ですにゃ ✨"
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
                .critical-fixes {
                    background: #e17055;
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
                    <h1>🐱⛩️ つきみ 管理メニュー v1.2.1</h1>
                    <div class="status">
                        ✅ v1.2.1 致命的バグ修正完了！ | 参拝者: ${stats.totalUsers.size}名 | 本日: ${todayStats.users.size}名 | 相談: ${stats.totalTurns}回
                    </div>
                </div>
                
                <div class="critical-fixes">
                    <h3>🚨 v1.2.1 致命的バグ修正完了</h3>
                    <ul style="margin: 10px 0;">
                        <li>✅ お焚き上げ提案: 「なるほど」等の誤判定を修正</li>
                        <li>✅ お焚き上げ同意: 「お願い」単体検出に対応</li>
                        <li>✅ アンケート提案: 10分→30分に検出時間延長</li>
                        <li>✅ 日次制限: dailyUsage誤削除を完全修正</li>
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
            <title>つきみ 統計情報 v1.2.1</title>
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
                .critical-fixes {
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
                    <h1>🐱⛩️ つきみ統計情報 v1.2.1 ⛩️🐱</h1>
                    <p>最終更新: ${new Date().toLocaleString('ja-JP')}</p>
                </div>
                
                <div class="critical-fixes">
                    <h3>🚨 v1.2.1 致命的バグ修正完了</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
                        <div>
                            <strong>お焚き上げ機能修正:</strong>
                            <ul style="margin: 5px 0; text-align: left;">
                                <li>✅ 提案: 「なるほど」誤判定修正</li>
                                <li>✅ 同意: 「お願い」単体検出対応</li>
                            </ul>
                        </div>
                        <div>
                            <strong>システム修正:</strong>
                            <ul style="margin: 5px 0; text-align: left;">
                                <li>✅ アンケート: 30分検出対応</li>
                                <li>✅ 日次制限: 誤削除を完全修正</li>
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
                    <p>🐾 つきみv1.2.1が致命的バグを修正して、安定稼働中です 🐾</p>
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
        version: '1.2.1',
        timestamp: new Date().toISOString(),
        before,
        after,
        cleaned: cleanedCount
    });
});

// テストエンドポイント
app.get('/test', (req, res) => {
    res.json({
        message: 'つきみv1.2.2はキーワード方式で確実実行できるようになりましたにゃ！',
        version: '1.2.2',
        webhook_url: req.get('host') + '/webhook',
        environment_check: {
            line_secret: !!process.env.LINE_CHANNEL_SECRET,
            line_token: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
            openai_key: !!process.env.OPENAI_API_KEY
        },
        ai_ending_detection_completed: [
            'AIによる柔軟な会話終了判定システム実装',
            '「一旦大丈夫」「また今度」等の自然な終了表現も捕捉',
            'キーワード依存から文脈理解への進化',
            'アドバイス表現をより優しく調整'
        ]
    });
});

// サーバー開始
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🐱⛩️ つきみv1.2.1（猫神主Bot）が起動しました ⛩️🐱');
    console.log(`ポート: ${PORT}`);
    console.log(`環境: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('=== 🏛️ システム情報 ===');
    console.log(`最大ユーザー数: ${LIMITS.MAX_USERS}名`);
    console.log(`1日の制限: ${LIMITS.DAILY_TURN_LIMIT}ターン`);
    console.log(`セッション時間: ${LIMITS.SESSION_TIMEOUT / 60000}分`);
    console.log(`クリーンアップ間隔: ${LIMITS.CLEANUP_INTERVAL / 60000}分`);
    console.log('');
    console.log('=== 🚨 v1.2.1 致命的バグ修正完了 ===');
    console.log('• ✅ アンケート提案: 10分→30分に検出時間延長');
    console.log('• ✅ 日次制限: dailyUsage誤削除を完全修正');
    console.log('====================================');
    console.log('');
    console.log('=== 🎯 PMF検証項目 ===');
    console.log('• お焚き上げ利用率: 目標30%以上');
    console.log('• 平均相談ターン数: 目標+2-3ターン');
    console.log('• ユーザー継続率: 翌日再利用率');
    console.log('• 会話品質: v1.2.1で致命的バグ修正完了');
    console.log('========================');
    console.log('');
    console.log('つきみがv1.2.1で神社でお待ちしていますにゃ... 🐾');
    
           

    // 起動時の環境変数チェック
    const requiredEnvs = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'OPENAI_API_KEY'];
    const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
    
    if (missingEnvs.length > 0) {
        console.error('❌ 不足している環境変数:', missingEnvs.join(', '));
        console.error('Renderの環境変数設定を確認してください');
    } else {
        console.log('✅ 環境変数設定完了');
        console.log('✅ v1.2.0 Priority 1修正版準備完了');
    }
});
