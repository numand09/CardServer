const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const matchmakingService = require('./services/matchmakingService');

const app = express();

// CORS ve JSON ayarları
app.use(cors());
app.use(express.json());

// Auth Rotaları
app.use('/auth', authRoutes);

// HTTP Server ve WebSocket Kurulumu
const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });

// WebSocket Olaylarını Servise Yönlendir
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    // Servise yeni bağlantıyı bildir (Gerekirse)
    matchmakingService.handleConnection(ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            matchmakingService.handleMessage(ws, data);
        } catch (e) {
            console.error('❌ Mesaj JSON formatında değil:', e.message);
        }
    });

    ws.on('close', () => {
        matchmakingService.handleDisconnect(ws);
    });
    
    ws.on('error', (err) => {
        console.error('❌ WebSocket Hatası:', err.message);
    });
});

// Heartbeat: Ölü bağlantıları temizle (30 saniyede bir)
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(heartbeatInterval));

// --- SERVER BAŞLATMA (DATABASE BEKLEMELİ) ---

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI;

async function startServer() {
    try {
        // 1. Önce MongoDB'ye Bağlan
        console.log('⏳ MongoDB\'ye bağlanılıyor...');
        
        // Mongoose 7+ için strictQuery ayarı (Opsiyonel ama önerilir)
        mongoose.set('strictQuery', false);
        
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000 // 5 saniye içinde bağlanamazsa hata ver
        });
        
        console.log('✅ MongoDB Bağlantısı Başarılı');

        // 2. Bağlantı başarılıysa Sunucuyu Dinlemeye Başla
        httpServer.listen(PORT, () => {
            console.log(`🚀 Server çalışıyor: Port ${PORT}`);
            console.log(`📡 WebSocket Hazır`);
        });

    } catch (err) {
        console.error('❌ BAŞLATMA HATASI: Veritabanına bağlanılamadı.');
        console.error('Hata Detayı:', err.message);
        // Hata varsa process'i kapat (Render bunu algılayıp yeniden başlatmayı dener)
        process.exit(1);
    }
}

startServer();