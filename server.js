// CardServer/server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
require('dotenv').config();

// Servisimizi çağırıyoruz
const matchmakingService = require('./services/matchmakingService');
const authRoutes = require('./routes/authRoutes'); // Auth rotaların varsa

const app = express();
app.use(cors());
app.use(express.json());

// Auth Rotaları
app.use('/auth', authRoutes);

const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
    // Ping/Pong (Bağlantıyı canlı tutmak için)
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

// Heartbeat (Her 30sn'de bir ölü bağlantıları temizle)
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(interval));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Server çalışıyor: Port ${PORT}`);
});