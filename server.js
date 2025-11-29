const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const matchmakingService = require('./services/matchmakingService');

const app = express();

app.use(cors());
app.use(express.json());

// Auth Rotaları
app.use('/auth', authRoutes);

// --- HTTP ENDPOINTS (Unity MatchSceneManager için gerekli) ---

// 1. Maç Durumu Kontrolü (Unity buradan soruyor: "Rakip hala oyunda mı?")
app.post('/matchmaking/check-match-status', (req, res) => {
    const { matchId, userId } = req.body;
    
    // Servis üzerinden kontrol et
    const status = matchmakingService.checkMatchStatus(matchId, userId);
    
    res.json(status);
});

// 2. Maçtan Ayrılma (Unity buradan "Ben çıkıyorum" diyor)
app.post('/matchmaking/leave-match', (req, res) => {
    const { userId } = req.body;
    matchmakingService.removePlayer(userId); // WebSocket kopmasını beklemeden sil
    res.json({ success: true });
});

// -----------------------------------------------------------

const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    matchmakingService.handleConnection(ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            matchmakingService.handleMessage(ws, data);
        } catch (e) {
            console.error('JSON Hatası:', e);
        }
    });

    ws.on('close', () => {
        matchmakingService.handleDisconnect(ws);
    });
});

// Heartbeat
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(interval));

// --- SERVER BAŞLATMA ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI;

async function startServer() {
    try {
        console.log('⏳ MongoDB\'ye bağlanılıyor...');
        mongoose.set('strictQuery', false);
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        });
        console.log('✅ MongoDB Bağlantısı Başarılı');

        httpServer.listen(PORT, () => {
            console.log(`🚀 Server çalışıyor: Port ${PORT}`);
        });

    } catch (err) {
        console.error('❌ Veritabanı Hatası:', err.message);
        process.exit(1);
    }
}

startServer();