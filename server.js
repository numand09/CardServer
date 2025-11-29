const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const matchmakingRoutes = require('./routes/matchmakingRoutes');

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });

// MongoDB Bağlantısı
mongoose.connect(process.env.MONGODB_URI, { 
    useNewUrlParser: true, 
    useUnifiedTopology: true 
})
.then(() => console.log('MongoDB Bağlandı'))
.catch(err => console.error('MongoDB Hatası:', err));

// Routes
app.use('/auth', authRoutes);
app.use('/matchmaking', matchmakingRoutes);

// --- MATCHMAKING & MATCH MANAGEMENT ---
let matchmakingQueue = [];
const clients = new Map(); // ws -> userId
const userSockets = new Map(); // userId -> ws
const activeMatches = new Map(); // matchId -> { player1, player2, createdAt }
const playerMatches = new Map(); // userId -> matchId

// WebSocket Bağlantı Yönetimi
wss.on('connection', (ws) => {
    console.log('Yeni oyuncu bağlandı.');

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('Mesaj formatı hatası:', e);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket hatası:', error);
        handleDisconnect(ws);
    });
});

// Heartbeat - Her 30 saniyede bir kontrol et
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            handleDisconnect(ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

function handleMessage(ws, data) {
    const { type, payload } = data;

    if (type === 'findMatch') {
        const { userId, username } = payload;
        
        // Kullanıcıyı kaydet
        clients.set(ws, userId);
        userSockets.set(userId, ws);

        // Zaten aktif maçta mı?
        if (playerMatches.has(userId)) {
            sendJson(ws, 'error', { message: 'Zaten bir maçtasınız!' });
            return;
        }

        console.log(`Eşleşme aranıyor: ${username} (${userId})`);

        const existingIndex = matchmakingQueue.findIndex(p => p.userId === userId);
        if (existingIndex !== -1) {
            matchmakingQueue[existingIndex].ws = ws; // WebSocket'i güncelle
            return;
        }

        // Kuyrukta başka biri var mı?
        if (matchmakingQueue.length > 0) {
            const opponent = matchmakingQueue.shift();

            // Kendisiyle eşleşme kontrolü
            if (opponent.userId === userId) {
                matchmakingQueue.push({ ws, userId, username });
                return;
            }

            // Maç oluştur
            const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

            const matchData = {
                matchId,
                player1: { userId: opponent.userId, username: opponent.username },
                player2: { userId, username },
                createdAt: Date.now()
            };

            activeMatches.set(matchId, matchData);
            playerMatches.set(opponent.userId, matchId);
            playerMatches.set(userId, matchId);

            // Oyunculara bildir
            sendJson(opponent.ws, 'matchFound', {
                matchId,
                opponent: username,
                opponentId: userId,
                role: 'host'
            });

            sendJson(ws, 'matchFound', {
                matchId,
                opponent: opponent.username,
                opponentId: opponent.userId,
                role: 'client'
            });

            console.log(`✅ MAÇ KURULDU: ${opponent.username} vs ${username}`);

        } else {
            // Kuyruğa ekle
            matchmakingQueue.push({ ws, userId, username });
            sendJson(ws, 'waitingForMatch', { message: 'Rakip bekleniyor...' });
        }
    }
    
    else if (type === 'cancelMatch') {
        const userId = clients.get(ws);
        removeFromQueue(userId);
        sendJson(ws, 'matchCancelled', { success: true });
    }

    else if (type === 'leaveMatch') {
        const userId = clients.get(ws);
        endMatch(userId, 'player_quit');
    }
}

function handleDisconnect(ws) {
    const userId = clients.get(ws);
    
    if (userId) {
        console.log(`❌ Bağlantı koptu: ${userId}`);
        
        // Kuyruktan çıkar
        removeFromQueue(userId);
        
        // Aktif maçtan çıkar ve rakibe bildir
        endMatch(userId, 'disconnect');
        
        // Haritalardan temizle
        clients.delete(ws);
        userSockets.delete(userId);
    }
}

function removeFromQueue(userId) {
    const index = matchmakingQueue.findIndex(p => p.userId === userId);
    if (index !== -1) {
        const removed = matchmakingQueue.splice(index, 1)[0];
        console.log(`🚪 Kuyruktan çıktı: ${removed.username}`);
    }
}

function endMatch(userId, reason) {
    const matchId = playerMatches.get(userId);
    if (!matchId) return;

    const matchData = activeMatches.get(matchId);
    if (!matchData) return;

    // Rakibi bul
    const isPlayer1 = matchData.player1.userId === userId;
    const opponent = isPlayer1 ? matchData.player2 : matchData.player1;

    console.log(`⚠️ Maç sona erdi (${reason}): ${matchId}`);

    // Rakibe bildir
    const opponentWs = userSockets.get(opponent.userId);
    if (opponentWs && opponentWs.readyState === WebSocket.OPEN) {
        sendJson(opponentWs, 'opponentLeft', {
            reason,
            message: reason === 'disconnect' 
                ? 'Rakibinizin bağlantısı koptu!' 
                : 'Rakibiniz oyundan ayrıldı!'
        });
    }

    // Maç verilerini temizle
    playerMatches.delete(matchData.player1.userId);
    playerMatches.delete(matchData.player2.userId);
    activeMatches.delete(matchId);
}

function sendJson(ws, type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

// HTTP Endpoints (Oyun sahnesinden kullanılacak)

// Maç durumu kontrolü (heartbeat)
app.post('/matchmaking/check-match-status', (req, res) => {
    const { matchId, userId } = req.body;
    
    const matchData = activeMatches.get(matchId);
    
    if (!matchData) {
        return res.json({ 
            success: true, 
            bothPlayersLeft: true,
            message: 'Maç bulunamadı' 
        });
    }

    // Her iki oyuncu da hala bağlı mı kontrol et
    const player1Connected = userSockets.has(matchData.player1.userId);
    const player2Connected = userSockets.has(matchData.player2.userId);

    if (!player1Connected || !player2Connected) {
        // Biri kopmuşsa maçı sonlandır
        endMatch(userId, 'opponent_disconnect');
        return res.json({ 
            success: true, 
            bothPlayersLeft: true,
            message: 'Rakip bağlantısı koptu' 
        });
    }

    res.json({ 
        success: true, 
        bothPlayersLeft: false,
        message: 'Maç devam ediyor' 
    });
});

// Oyuncu maçtan ayrılıyor
app.post('/matchmaking/leave-match', (req, res) => {
    const { matchId, userId, reason } = req.body;
    
    endMatch(userId, reason || 'quit');
    
    res.json({ success: true, message: 'Maçtan ayrıldınız' });
});

// Temizlik görevi - Her 5 dakikada bir eski verileri temizle
setInterval(() => {
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;
    const TEN_MINUTES = 10 * 60 * 1000;

    // Eski kuyruk girişlerini temizle
    matchmakingQueue = matchmakingQueue.filter(p => now - (p.timestamp || now) < FIVE_MINUTES);

    // Eski maçları temizle
    for (const [matchId, matchData] of activeMatches) {
        if (now - matchData.createdAt > TEN_MINUTES) {
            console.log(`🧹 Eski maç temizlendi: ${matchId}`);
            playerMatches.delete(matchData.player1.userId);
            playerMatches.delete(matchData.player2.userId);
            activeMatches.delete(matchId);
        }
    }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🚀 Server çalışıyor: Port ${PORT}`));