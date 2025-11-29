class MatchmakingService {
    constructor() {
        this.queue = []; 
        this.activeMatches = new Map(); 
        this.playerMatches = new Map(); 
        this.userSockets = new Map(); 
        this.socketUsers = new Map(); 
    }

    handleConnection(ws) {}

    handleMessage(ws, data) {
        const { type, payload } = data;
        if (type === 'findMatch') this.findMatch(ws, payload);
        else if (type === 'cancelMatch') this.removeFromQueue(ws);
    }

    // --- YENİ EKLENEN HTTP YARDIMCISI ---
    checkMatchStatus(matchId, userId) {
        // 1. Maç var mı?
        const match = this.activeMatches.get(matchId);
        
        if (!match) {
            // Maç yoksa bitmiş demektir
            return { 
                success: true, 
                matchActive: false, 
                message: 'Maç bulunamadı veya sona erdi.' 
            };
        }

        // 2. Rakip bağlı mı?
        const isPlayer1 = match.player1.userId === userId;
        const opponent = isPlayer1 ? match.player2 : match.player1;
        
        const opponentSocket = this.userSockets.get(opponent.userId);
        
        if (!opponentSocket || opponentSocket.readyState !== 1) { // 1 = OPEN
            // Rakibin socketi yok veya kapalı
            // Ancak Grace Period (Sahne geçişi) kontrolü yapalım
            if (Date.now() - match.createdAt < 20000) {
                return { success: true, matchActive: true, message: 'Sahne yükleniyor...' };
            }

            return { 
                success: true, 
                matchActive: false, 
                message: 'Rakip bağlantısı koptu.' 
            };
        }

        // Her şey yolunda
        return { success: true, matchActive: true };
    }

    removePlayer(userId) {
        const ws = this.userSockets.get(userId);
        if (ws) this.handleDisconnect(ws);
    }
    // -------------------------------------

    findMatch(ws, userPayload) {
        const { userId, username } = userPayload;
        if (!userId) return;

        this.userSockets.set(userId, ws);
        this.socketUsers.set(ws, userId);

        if (this.playerMatches.has(userId)) {
            this.send(ws, 'error', { message: 'Zaten maçtasınız.' });
            return;
        }

        this.queue = this.queue.filter(p => p.ws.readyState === 1);

        if (this.queue.length > 0) {
            const opponent = this.queue.shift();
            if (opponent.userId === userId) {
                this.queue.push({ ws, userId, username });
                return;
            }

            const matchId = `match_${Date.now()}`;
            const matchData = {
                matchId,
                player1: opponent,
                player2: { ws, userId, username },
                createdAt: Date.now()
            };

            this.activeMatches.set(matchId, matchData);
            this.playerMatches.set(userId, matchId);
            this.playerMatches.set(opponent.userId, matchId);

            console.log(`✅ Maç: ${opponent.username} vs ${username}`);

            this.send(opponent.ws, 'matchFound', { matchId, opponent: username, opponentId: userId, role: 'host' });
            this.send(ws, 'matchFound', { matchId, opponent: opponent.username, opponentId: opponent.userId, role: 'client' });

        } else {
            this.queue.push({ ws, userId, username });
            this.send(ws, 'waitingForMatch', {});
        }
    }

    handleDisconnect(ws) {
        const userId = this.socketUsers.get(ws);
        if (!userId) return;

        this.removeFromQueue(ws);

        const matchId = this.playerMatches.get(userId);
        if (matchId) {
            const match = this.activeMatches.get(matchId);
            
            // Sahne geçişi koruması (20sn)
            if (match && (Date.now() - match.createdAt < 20000)) {
                this.userSockets.delete(userId);
                this.socketUsers.delete(ws);
                return;
            }

            this.endMatch(matchId, 'opponent_disconnect');
        }

        this.userSockets.delete(userId);
        this.socketUsers.delete(ws);
    }

    removeFromQueue(ws) {
        const index = this.queue.findIndex(p => p.ws === ws);
        if (index !== -1) this.queue.splice(index, 1);
    }

    endMatch(matchId, reason) {
        const match = this.activeMatches.get(matchId);
        if (!match) return;

        [match.player1, match.player2].forEach(p => {
            const socket = this.userSockets.get(p.userId);
            if (socket) this.send(socket, 'matchEnded', { reason });
            this.playerMatches.delete(p.userId);
        });

        this.activeMatches.delete(matchId);
        console.log(`🗑️ Maç Bitti: ${matchId}`);
    }

    send(ws, type, payload) {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, payload }));
    }
}

module.exports = new MatchmakingService();