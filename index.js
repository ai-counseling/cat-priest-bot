// 猫神主Bot「つきみ」- v1.3.0 AI終了度判定システム - 完全版
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

// キャラクター設定（終了度判定機能付き）
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

【アドバイスの提案方法】
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
- 間違い: 「大切ですねにゃ」「そうですねにゃ」「よね にゃ」
- 「ね」の後に「にゃ」は付けない

【アドバイス表現の具体例】
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

【重要】応答の最後に、この会話の終了度を以下の形式で必ず記載してください：
- [ENDING_LEVEL: 0] = 会話が継続中、相談や質問が続いている
- [ENDING_LEVEL: 1] = やや終了に向かっている、話題が一段落している  
- [ENDING_LEVEL: 2] = 明確に終了のサイン、区切りの意図が感じられる

【終了度判定の基準】
- ユーザーが納得・理解・満足を示している
- 感謝の表現がある
- 「また」「今度」「一旦」「とりあえず」など区切りの言葉
- 前向きな行動意欲を示している（「やってみます」など）
- 話題の自然な収束感がある
- 挨拶や締めくくりの言葉

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
    const questionPatterns = [
        'って何', 'とは', 'について教えて', 'どんなもの', 'なんですか',
        '？', '何ですか', 'わからない', '知らない', 'どういう意味',
        'って何ですか', 'とは何ですか', 'どういうこと'
    ];
    
    const hasPurificationWord = message.includes('お焚き上げ') || message.includes('たきあげ');
    const hasQuestionPattern = questionPatterns.some(pattern => message.includes(pattern));
    
    return hasPurificationWord && hasQuestionPattern;
}

// 終了度抽出関数
function extractEndingLevel(aiResponse) {
    const match = aiResponse.match(/\[ENDING_LEVEL:\s*(\d+)\]/);
    return match ? parseInt(match[1]) : 0;
}

// 応答から終了度表記を除去
function removeEndingLevelFromResponse(aiResponse) {
    return aiResponse.replace(/\s*\[ENDING_LEVEL:\s*\d+\]\s*/g, '').trim();
}

// AI終了度判定によるお焚き上げ提案
async function shouldSuggestPurificationByAI(userId, endingLevel, history, userMessage) {
    if (history.length < 3) return false;
    
    const lastPurification = purificationHistory.get(userId);
    if (lastPurification) {
        const hoursSince = (Date.now() - lastPurification) / (1000 * 60 * 60);
        if (hoursSince < 1) return false;
    }
    
    // ENDING_LEVEL: 2なら無条件で提案
    if (endingLevel >= 2) return true;
    
    // ENDING_LEVEL: 1の場合はAIで継続意図をチェック
    if (endingLevel >= 1) {
        const hasContinuation = await checkContinuationIntent(userMessage);
        return !hasContinuation; // 継続意図がない場合のみ提案
    }
    
    return false;
}

// 継続意図をAIで判定する関数（新規追加）
async function checkContinuationIntent(userMessage) {
    try {
        const messages = [
            {
                role: 'system',
                content: `ユーザーのメッセージを分析して、会話を続ける意図があるかを判定してください。

【判定基準】
- 質問がある場合: YES
- アドバイスや追加情報を求めている場合: YES  
- 感謝のみで話を終えようとしている場合: NO

最後に必ず以下の形式で記載してください：
[CONTINUATION: YES] または [CONTINUATION: NO]`
            },
            {
                role: 'user', 
                content: userMessage
            }
        ];
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            max_tokens: 100,
            temperature: 0.3,
        });
        
        const result = response.choices[0].message.content;
        const match = result.match(/\[CONTINUATION:\s*(YES|NO)\]/);
        const hasContinuation = match ? match[1] === 'YES' : false;
        
        console.log(`継続意図判定: ${hasContinuation ? 'YES' : 'NO'} - "${userMessage}"`);
        return hasContinuation;
        
    } catch (error) {
        console.error('継続意図判定エラー:', error.message);
        return true; // エラー時は安全側に倒してお焚き上げしない
    }
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

// アンケート提案判定
function shouldSuggestAnkete(userId, history, userMessage) {
    if (history.length < 3) return false;
    
    const lastPurification = purificationHistory.get(userId);
    if (lastPurification) {
        const minutesSince = (Date.now() - lastPurification) / (1000 * 60);
        
        if (minutesSince < 30) {
            const thankfulKeywords = [
                'ありがとう', 'ありがとございます', 'ありがとうございました',
                'ありがと', 'あざす', 'サンキュー', 'thanks',
                '感謝', 'お礼', '感謝します', '感謝しています',
                'スッキリ', 'すっきり', '清々しい', 'さっぱり',
                '軽くなった', '楽になった', 'よかった'
            ];
            
            if (thankfulKeywords.some(keyword => userMessage.includes(keyword))) {
                return true;
            }
        }
        
        if (minutesSince < 60) return true;
    }
    
    const endingKeywords = [
        'スッキリ', 'すっきり', '楽になった', '軽くなった', 
        '話せてよかった', '聞いてくれて', 'おかげで', '助かった', 
        '気が楽に', '安心した', '落ち着いた', '整理できた'
    ];
    
    return endingKeywords.some(keyword => userMessage.includes(keyword));
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

function getLimitExplanation(remainingTurns, userName, useNameInResponse) {
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

// OpenAI応答生成（終了度判定付き）
async function generateAIResponseWithEndingAnalysis(message, history, userId, client) {
    try {
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        const remainingTurns = getRemainingTurns(userId);
        const conversationCount = history.length + 1;
        const useNameInResponse = shouldUseName(conversationCount);
        
        if (isAskingAboutLimits(message)) {
            return {
                response: getLimitExplanation(remainingTurns, userName, useNameInResponse),
                endingLevel: 0
            };
        }
        
        if (isQuestionAboutPurification(message)) {
            return {
                response: getExplanationResponse(),
                endingLevel: 0
            };
        }
        
        const messages = [
            { role: 'system', content: getCharacterPersonality(userName, remainingTurns, useNameInResponse) },
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
        
        const endingLevel = extractEndingLevel(aiResponse);
        aiResponse = removeEndingLevelFromResponse(aiResponse);
        
        if (aiResponse && !aiResponse.match(/[。！？にゃ]$/)) {
            const sentences = aiResponse.split(/[。！？]/);
            if (sentences.length > 1) {
                sentences.pop();
                aiResponse = sentences.join('。') + '。';
            }
        }
        
        const finalResponse = addCatSuffix(aiResponse);
        
        console.log(`AI応答生成完了: 終了度=${endingLevel}, レスポンス長=${finalResponse.length}文字`);
        
        return {
            response: finalResponse,
            endingLevel: endingLevel
        };
        
    } catch (error) {
        console.error('OpenAI API エラー:', error.message);
        return {
            response: `${userName ? userName + 'さん、' : ''}申し訳ございません。今少し考え事をしていて、うまくお答えできませんでした。もう一度お話しいただけますかにゃ`,
            endingLevel: 0
        };
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

// メインイベント処理
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return;
    }
    
    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    
    try {
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        
        console.log(`メッセージ受信: ${userName || 'Unknown'} (${userId.substring(0, 8)}...) - "${userMessage}"`);
        
        if (!userSessions.has(userId) && userSessions.size >= LIMITS.MAX_USERS) {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.maxUsersReached
            });
            return;
        }
        
        userSessions.add(userId);
        lastMessageTime.set(userId, Date.now());
        
        if (shouldExecutePurificationByKeyword(userMessage)) {
            console.log('🔥 指定キーワード検出 - お焚き上げ実行');
            await executePurification(userId, replyToken, client);
            return;
        }
        
        if (!checkDailyLimit(userId)) {
            const conversationCount = conversationHistory.get(userId)?.length || 0;
            const useNameInResponse = shouldUseName(conversationCount);
            
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.dailyLimitReached(userName, useNameInResponse)
            });
            return;
        }
        
        let history = conversationHistory.get(userId) || [];
        const conversationCount = history.length + 1;
        const useNameInResponse = shouldUseName(conversationCount);
        
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
        
        const aiResult = await generateAIResponseWithEndingAnalysis(userMessage, history, userId, client);
        const aiResponse = aiResult.response;
        const endingLevel = aiResult.endingLevel;
        
        console.log(`会話終了度: ${endingLevel} (0=継続中, 1=やや終了, 2=明確な終了)`);
        
        let finalResponse = aiResponse;
        if (await shouldSuggestPurificationByAI(userId, endingLevel, history)) {
            console.log('🔥 AI終了度判定でお焚き上げ提案');
            finalResponse = aiResponse + "\n\n" + getPurificationSuggestion(userName, useNameInResponse);
        } else if (shouldSuggestAnkete(userId, history, userMessage)) {
            finalResponse = aiResponse + "\n\n" + getAnketeSuggestion(userName, useNameInResponse);
        }        
        
        const usageCount = updateDailyUsage(userId);
        const remaining = LIMITS.DAILY_TURN_LIMIT - usageCount;
        
        if (remaining <= 3) {
            finalResponse += "\n\n" + SYSTEM_MESSAGES.remainingTurns(remaining, userName, useNameInResponse);
        }
        
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
            <p><strong>v1.3.0</strong> - AI終了度判定システム搭載！サーバーは正常に稼働していますにゃ ✨</p>
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
        version: '1.3.0',
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
        ai_ending_detection: {
            version: '1.3.0',
            features: [
                'AIによる柔軟な会話終了判定',
                '「一旦大丈夫」「また今度」等も確実に捕捉',
                'キーワード依存から文脈理解へ進化',
                'アドバイス表現をより優しく調整'
            ]
        },
        message: 'つきみv1.3.0がAI終了度判定で更に賢く稼働中ですにゃ ✨'
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
                .ai-features {
                    background: #6c5ce7;
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
                    <h1>🐱⛩️ つきみ 管理メニュー v1.3.0</h1>
                    <div class="status">
                        ✅ v1.3.0 AI終了度判定システム稼働中！ | 参拝者: ${stats.totalUsers.size}名 | 本日: ${todayStats.users.size}名 | 相談: ${stats.totalTurns}回
                    </div>
                </div>
                
                <div class="ai-features">
                    <h3>🧠 v1.3.0 AI終了度判定システム</h3>
                    <ul style="margin: 10px 0;">
                        <li>✅ AIによる柔軟な会話終了判定</li>
                        <li>✅ 「一旦大丈夫」「また今度」等も確実に捕捉</li>
                        <li>✅ キーワード依存から文脈理解へ進化</li>
                        <li>✅ アドバイス表現をより優しく調整</li>
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
            <title>つきみ 統計情報 v1.3.0</title>
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
                .ai-features {
                    background: #6c5ce7;
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
                    <h1>🐱⛩️ つきみ統計情報 v1.3.0 ⛩️🐱</h1>
                    <p>最終更新: ${new Date().toLocaleString('ja-JP')}</p>
                </div>
                
                <div class="ai-features">
                    <h3>🧠 v1.3.0 AI終了度判定システム</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
                        <div>
                            <strong>AI判定システム:</strong>
                            <ul style="margin: 5px 0; text-align: left;">
                                <li>✅ 文脈理解による終了度判定</li>
                                <li>✅ 3段階レベル（0-2）で精密判定</li>
                            </ul>
                        </div>
                        <div>
                            <strong>捕捉精度向上:</strong>
                            <ul style="margin: 5px 0; text-align: left;">
                                <li>✅ 「一旦大丈夫」「また今度」対応</li>
                                <li>✅ アドバイス表現を優しく調整</li>
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
                    <p>🐾 つきみv1.3.0がAI終了度判定で更に賢く稼働中です 🐾</p>
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
        version: '1.3.0',
        timestamp: new Date().toISOString(),
        before,
        after,
        cleaned: cleanedCount
    });
});

app.get('/test', (req, res) => {
    res.json({
        message: 'つきみv1.3.0はAI終了度判定で賢く進化しましたにゃ！',
        version: '1.3.0',
        timestamp: new Date().toISOString(),
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
    console.log('🐱⛩️ つきみv1.3.0（猫神主Bot）が起動しました ⛩️🐱');
    console.log(`ポート: ${PORT}`);
    console.log(`環境: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('=== 🏛️ システム情報 ===');
    console.log(`最大ユーザー数: ${LIMITS.MAX_USERS}名`);
    console.log(`1日の制限: ${LIMITS.DAILY_TURN_LIMIT}ターン`);
    console.log(`セッション時間: ${LIMITS.SESSION_TIMEOUT / 60000}分`);
    console.log(`クリーンアップ間隔: ${LIMITS.CLEANUP_INTERVAL / 60000}分`);
    console.log('');
    console.log('=== 🧠 v1.3.0 AI終了度判定システム ===');
    console.log('• ✅ AIによる柔軟な会話終了判定');
    console.log('• ✅ キーワード依存から文脈理解へ進化');
    console.log('• ✅ 「一旦大丈夫」「また今度」等も確実に捕捉');
    console.log('• ✅ アドバイス表現をより優しく調整');
    console.log('====================================');
    console.log('');
    console.log('=== 🎯 PMF検証項目 ===');
    console.log('• お焚き上げ利用率: 目標30%以上');
    console.log('• 平均相談ターン数: 目標+2-3ターン');
    console.log('• ユーザー継続率: 翌日再利用率');
    console.log('• 会話品質: v1.3.0でAI終了度判定搭載');
    console.log('========================');
    console.log('');
    console.log('つきみがv1.3.0で神社でお待ちしていますにゃ... 🐾');
    
    // 起動時の環境変数チェック
    const requiredEnvs = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'OPENAI_API_KEY'];
    const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
    
    if (missingEnvs.length > 0) {
        console.error('❌ 不足している環境変数:', missingEnvs.join(', '));
        console.error('Renderの環境変数設定を確認してください');
    } else {
        console.log('✅ 環境変数設定完了');
        console.log('✅ v1.3.0 AI終了度判定システム準備完了');
        console.log('');
        console.log('🧠 新しいAI終了度判定システム:');
        console.log('  AIが文脈を理解して会話終了度を0-2で判定');
        console.log('  ENDING_LEVEL: 2で自動的にお焚き上げ提案');
        console.log('  「一旦大丈夫」「また今度」等も確実に捕捉');
        console.log('');
        console.log('🎉 つきみv1.3.0は人間らしい判断ができるようになりました！');
    }
});
