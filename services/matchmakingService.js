// CardServer/services/matchmakingService.js

class MatchmakingService {
    constructor() {
        this.queue = []; // Bekleyen oyuncular
        this.activeMatches = new Map(); // matchId -> MatchData
        this.playerMatches = new Map(); // userId -> matchId
        this.userSockets = new Map(); // userId -> WebSocket
        this.socketUsers = new Map(); // WebSocket -> userId
    }

    handleConnection(ws) {
        // Bağlantı anında özel bir işlem gerekmiyor, 
        // kullanıcı "findMatch" gönderince kaydedeceğiz.
    }

    handleMessage(ws, data) {
        const { type, payload } = data;

        if (type === 'findMatch') {
            this.findMatch(ws, payload);
        } else if (type === 'cancelMatch') {
            this.removeFromQueue(ws);
        }
    }

    findMatch(ws, userPayload) {
        const { userId, username } = userPayload;

        // Kullanıcıyı socket haritasına ekle
        this.userSockets.set(userId, ws);
        this.socketUsers.set(ws, userId);

        // Zaten maçta mı?
        if (this.playerMatches.has(userId)) {
            this.send(ws, 'error', { message: 'Zaten maçtasınız.' });
            return;
        }

        // Kuyrukta biri var mı?
        if (this.queue.length > 0) {
            const opponent = this.queue.shift();

            // Kendisiyle eşleşmeyi önle (Nadiren olur ama olsun)
            if (opponent.userId === userId) {
                this.queue.push({ ws, userId, username });
                return;
            }

            // --- MAÇI BAŞLAT ---
            const matchId = `match_${Date.now()}`;
            const matchData = {
                matchId,
                player1: opponent,
                player2: { ws, userId, username },
                createdAt: Date.now()
            };

            // Kayıtlar
            this.activeMatches.set(matchId, matchData);
            this.playerMatches.set(userId, matchId);
            this.playerMatches.set(opponent.userId, matchId);

            console.log(`✅ Maç Kuruldu: ${opponent.username} vs ${username}`);

            // Bildirimler
            this.send(opponent.ws, 'matchFound', { 
                matchId, opponent: username, opponentId: userId, role: 'host' 
            });
            this.send(ws, 'matchFound', { 
                matchId, opponent: opponent.username, opponentId: opponent.userId, role: 'client' 
            });

        } else {
            // Kimse yok, kuyruğa ekle
            this.queue.push({ ws, userId, username });
            this.send(ws, 'waitingForMatch', {});
            console.log(`🔍 Kuyruğa eklendi: ${username}`);
        }
    }

    handleDisconnect(ws) {
        const userId = this.socketUsers.get(ws);
        if (!userId) return;

        console.log(`⚠️ Bağlantı koptu: ${userId}`);

        // 1. Kuyruktaysa sil
        this.removeFromQueue(ws);

        // 2. Aktif maçta mı?
        const matchId = this.playerMatches.get(userId);
        if (matchId) {
            const match = this.activeMatches.get(matchId);
            
            // 🔥 KRİTİK NOKTA: SAHNE YÜKLEME KORUMASI 🔥
            // Eğer maç son 20 saniye içinde kurulduysa, bu kopmayı "sahne değişimi" say ve maçı bitirme.
            if (match && (Date.now() - match.createdAt < 20000)) {
                console.log(`🔄 Sahne geçişi algılandı (${userId}). Maç korunuyor.`);
                // Sadece socket referanslarını temizle, maçı silme
                this.userSockets.delete(userId);
                this.socketUsers.delete(ws);
                return;
            }

            // Süre geçmişse maçı bitir (Rakip gerçekten kaçtı)
            this.endMatch(matchId, 'opponent_disconnect');
        }

        // Temizlik
        this.userSockets.delete(userId);
        this.socketUsers.delete(ws);
    }

    removeFromQueue(ws) {
        const index = this.queue.findIndex(p => p.ws === ws);
        if (index !== -1) {
            this.queue.splice(index, 1);
        }
    }

    endMatch(matchId, reason) {
        const match = this.activeMatches.get(matchId);
        if (!match) return;

        // Oyunculara bildir
        [match.player1, match.player2].forEach(p => {
            const socket = this.userSockets.get(p.userId); // Güncel socketi al
            if (socket) {
                this.send(socket, 'matchEnded', { reason });
            }
            this.playerMatches.delete(p.userId);
        });

        this.activeMatches.delete(matchId);
        console.log(`🗑️ Maç sonlandırıldı: ${matchId}`);
    }

    send(ws, type, payload) {
        if (ws && ws.readyState === 1) { // 1 = OPEN
            ws.send(JSON.stringify({ type, payload }));
        }
    }
}

module.exports = new MatchmakingService();