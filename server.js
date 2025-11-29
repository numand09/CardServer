const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config(); // .env dosyasını kullanıyorsan gerekli

const authRoutes = require('./routes/authRoutes');

const app = express();
app.use(cors());
app.use(express.json());

// --- HTTP Server ve WebSocket Kurulumu ---
const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });

// Veritabanı Bağlantısı
mongoose.connect(process.env.MONGODB_URI, { 
    useNewUrlParser: true, 
    useUnifiedTopology: true 
})
.then(() => console.log('MongoDB Bağlandı'))
.catch(err => console.error('MongoDB Hatası:', err));

// Auth (Giriş/Kayıt) işlemleri HTTP üzerinden devam eder
app.use('/auth', authRoutes);

// --- MATCHMAKING LOGIC (RAM Üzerinde Hızlı Eşleşme) ---
let matchmakingQueue = [];
let clients = new Map(); // Hangi WebSocket'in hangi userId'ye ait olduğunu tutar

wss.on('connection', (ws) => {
    console.log('Yeni oyuncu bağlandı.');

    ws.on('message', (message) => {
        try {
            // Unity'den gelen mesajı JSON'a çevir
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
    });
});

function handleMessage(ws, data) {
    const { type, payload } = data;

    if (type === 'findMatch') {
        const { userId, username } = payload;
        
        // Bu soketi kullanıcının ID'si ile eşleştir
        clients.set(ws, userId);

        console.log(`Eşleşme aranıyor: ${username} (${userId})`);

        // Kullanıcı zaten kuyrukta mı? (Kopup tekrar bağlandıysa güncelle)
        const existingPlayer = matchmakingQueue.find(p => p.userId === userId);
        if (existingPlayer) {
            existingPlayer.ws = ws;
            return;
        }

        // Kuyrukta biri var mı kontrol et
        if (matchmakingQueue.length > 0) {
            // Kuyruktan ilk kişiyi al (FIFO)
            const opponent = matchmakingQueue.shift();

            // Kendisiyle eşleşmesini engelle (nadiren olur ama güvenlik olsun)
            if (opponent.userId === userId) {
                matchmakingQueue.push(opponent);
                return;
            }

            // Eşleşme ID'si oluştur
            const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

            // 1. Oyuncuya (Host) Haber ver
            sendJson(opponent.ws, 'matchFound', {
                matchId: matchId,
                opponent: username,
                opponentId: userId,
                role: 'host'
            });

            // 2. Oyuncuya (Client) Haber ver
            sendJson(ws, 'matchFound', {
                matchId: matchId,
                opponent: opponent.username,
                opponentId: opponent.userId,
                role: 'client'
            });

            console.log(`MAÇ KURULDU: ${opponent.username} vs ${username}`);

        } else {
            // Kuyruk boşsa, bu kişiyi kuyruğa ekle
            matchmakingQueue.push({ ws, userId, username });
            sendJson(ws, 'waitingForMatch', { message: 'Rakip bekleniyor...' });
        }
    }
    
    else if (type === 'cancelMatch') {
        handleDisconnect(ws);
        sendJson(ws, 'matchCancelled', { success: true });
    }
}

function handleDisconnect(ws) {
    // Kullanıcıyı kuyruktan çıkar
    const index = matchmakingQueue.findIndex(p => p.ws === ws);
    if (index !== -1) {
        const removedPlayer = matchmakingQueue[index];
        matchmakingQueue.splice(index, 1);
        console.log(`Kuyruktan çıktı: ${removedPlayer.username}`);
    }
    clients.delete(ws);
}

// Yardımcı Fonksiyon: Güvenli JSON gönderme
function sendJson(ws, type, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server çalışıyor (HTTP + WebSocket): Port ${PORT}`));