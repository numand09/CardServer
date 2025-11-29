let matchmakingQueue = [];
const activeMatches = new Map();
const playerMatches = new Map();

class MatchmakingService {
  static addToQueue(user) {
    if (playerMatches.has(user.userId)) return null;
    if (matchmakingQueue.some(p => p.userId === user.userId)) return null;

    matchmakingQueue.push({ ...user, timestamp: Date.now() });
    return this.tryMatch(user);
  }

  static tryMatch(user) {
    if (!matchmakingQueue.length) return null;
    const opponent = matchmakingQueue.shift();
    if (opponent.userId === user.userId) return null;

    const matchId = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    const matchData = {
      matchId,
      player1: opponent,
      player2: user,
      createdAt: Date.now(),
      lastHeartbeat: { [opponent.userId]: Date.now(), [user.userId]: Date.now() }
    };

    activeMatches.set(matchId, matchData);
    playerMatches.set(opponent.userId, matchId);
    playerMatches.set(user.userId, matchId);
    return matchData;
  }

  static removePlayer(userId) {
    const matchId = playerMatches.get(userId);
    if (!matchId) return;

    playerMatches.delete(userId);
    const m = activeMatches.get(matchId);
    if (!m) return;

    const other = m.player1.userId === userId ? m.player2.userId : m.player1.userId;
    if (!playerMatches.has(other)) activeMatches.delete(matchId);
  }

  static cleanupQueues() {
    const now = Date.now();
    matchmakingQueue = matchmakingQueue.filter(p => now - p.timestamp < 300000);
    for (const [id, m] of activeMatches)
      if (now - m.createdAt > 600000) activeMatches.delete(id);
  }
}

module.exports = MatchmakingService;
