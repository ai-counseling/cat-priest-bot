// admin-routes.js - 管理機能ルーティング
module.exports = function(app, stats) {
    
    // 基本統計エンドポイント
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
        
        const statsHtml = `
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
                    color: #8b4513;
                    margin-bottom: 40px;
                    background: linear-gradient(45deg, #ff9a9e, #fecfef);
                    padding: 20px;
                    border-radius: 10px;
                    color: white;
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
                .cat-emoji {
                    font-size: 1.8em;
                    margin: 0 10px;
                    animation: bounce 2s infinite;
                }
                @keyframes bounce {
                    0%, 20%, 50%, 80%, 100% {
                        transform: translateY(0);
                    }
                    40% {
                        transform: translateY(-10px);
                    }
                    60% {
                        transform: translateY(-5px);
                    }
                }
                .footer {
                    text-align: center; 
                    margin-top: 40px; 
                    color: #636e72;
                    background: #f1f2f6;
                    padding: 20px;
                    border-radius: 10px;
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
                    <p>
                        <span class="cat-emoji">🐾</span>
                        神主猫が皆さんの心を清めるお手伝いをしています
                        <span class="cat-emoji">🐾</span>
                    </p>
                    <p style="font-size: 0.9em; margin-top: 15px;">
                        システム稼働時間: ${Math.floor(process.uptime() / 3600)}時間${Math.floor((process.uptime() % 3600) / 60)}分
                    </p>
                </div>
            </div>
        </body>
        </html>
        `;
        
        res.send(statsHtml);
    });

    // ヘルスチェック
    app.get('/health', (req, res) => {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: '猫神主Bot',
            version: '1.0.0',
            uptime: process.uptime(),
            stats: {
                totalUsers: stats.totalUsers.size,
                totalTurns: stats.totalTurns,
                purificationCount: stats.purificationCount,
                purificationRate: stats.totalTurns > 0 ? (stats.purificationCount / stats.totalTurns * 100).toFixed(1) : 0
            }
        };
        
        res.json(health);
    });

    // 管理メニュー
    app.get('/admin', (req, res) => {
        const adminHtml = `
        <!DOCTYPE html>
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
                .header {
                    text-align: center;
                    margin-bottom: 40px;
                }
                .header h1 {
                    color: #2d3436;
                    margin-bottom: 10px;
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
                .cat-decoration {
                    font-size: 3em;
                    margin: 20px 0;
                    animation: sway 3s ease-in-out infinite alternate;
                }
                @keyframes sway {
                    0% { transform: rotate(-5deg); }
                    100% { transform: rotate(5deg); }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="cat-decoration">🐱⛩️</div>
                    <h1>猫神主Bot 管理メニュー</h1>
                    <p style="color: #636e72;">システム管理・監視ツール</p>
                </div>
                
                <a href="/admin/stats" class="menu-item">
                    📊 統計情報を見る
                </a>
                
                <a href="/health" class="menu-item">
                    ❤️ ヘルスチェック (JSON)
                </a>
                
                <a href="#" onclick="cleanup()" class="menu-item">
                    🧹 手動クリーンアップ
                </a>

                <a href="#" onclick="testMessage()" class="menu-item">
                    🧪 テストメッセージ送信
                </a>
            </div>
            
            <script>
                async function cleanup() {
                    if (confirm('非アクティブセッションをクリーンアップしますか？')) {
                        try {
                            const response = await fetch('/admin/cleanup', { method: 'POST' });
                            const result = await response.json();
                            alert('クリーンアップ完了にゃ\\n削除セッション数: ' + result.cleaned);
                        } catch (error) {
                            alert('エラーが発生しました: ' + error.message);
                        }
                    }
                }
                
                async function testMessage() {
                    const message = prompt('テスト用のメッセージを入力してください:');
                    if (message) {
                        alert('テスト機能は開発中ですにゃ\\n入力されたメッセージ: ' + message);
                    }
                }
            </script>
        </body>
        </html>
        `;
        
        res.send(adminHtml);
    });

    // 手動クリーンアップエンドポイント
    app.post('/admin/cleanup', (req, res) => {
        // この部分は実際のメインファイルのクリーンアップ関数を呼び出す
        res.json({
            message: 'クリーンアップ実行中ですにゃ',
            timestamp: new Date().toISOString(),
            cleaned: 0 // 