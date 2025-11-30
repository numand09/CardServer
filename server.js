const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now }
}));

let matchmakingQueue = [];
let activeMatches = new Map();
let playerMatches = new Map();

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (await User.findOne({ username }))
      return res.json({ success: false, message: 'Kullanıcı mevcut' });

    await new User({ username, password: await bcrypt.hash(password, 10) }).save();
    res.json({ success: true, message: 'Kayıt başarılı' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.json({ success: false, message: 'Kullanıcı yok' });

    if (!(await bcrypt.compare(password, user.password)))
      return res.json({ success: false, message: 'Hatalı şifre' });

    cleanupUserData(user._id.toString());
    res.json({ success: true, userId: user._id, message: 'Giriş başarılı' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

function cleanupUserData(userId) {
  matchmakingQueue = matchmakingQueue.filter(p => p.userId !== userId);
  if (playerMatches.has(userId)) removePlayerFromMatch(playerMatches.get(userId), userId);
}

app.post('/find-match', (req, res) => {
  const { userId, username } = req.body;
  if (!userId || !username) return res.json({ success: false, message: 'Eksik veri' });

  if (playerMatches.has(userId)) {
    const matchId = playerMatches.get(userId);
    const m = activeMatches.get(matchId);
    const opp = m.player1.userId === userId ? m.player2 : m.player1;
    return res.json({ success: true, matchFound: true, matchId, opponent: opp.username, opponentId: opp.userId });
  }

  if (matchmakingQueue.some(p => p.userId === userId))
    return res.json({ success: true, matchFound: false, message: 'Bekleniyor' });

  if (matchmakingQueue.length > 0) {
    const opp = matchmakingQueue.shift();
    if (opp.userId === userId) {
      matchmakingQueue.push(opp, { userId, username, timestamp: Date.now() });
      return res.json({ success: true, matchFound: false });
    }

    const matchId = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    const matchData = {
      matchId,
      player1: opp,
      player2: { userId, username },
      createdAt: Date.now(),
      lastHeartbeat: { [opp.userId]: Date.now(), [userId]: Date.now() }
    };

    activeMatches.set(matchId, matchData);
    playerMatches.set(opp.userId, matchId);
    playerMatches.set(userId, matchId);

    return res.json({
      success: true,
      matchFound: true,
      matchId,
      opponent: opp.username,
      opponentId: opp.userId
    });
  }

  matchmakingQueue.push({ userId, username, timestamp: Date.now() });
  res.json({ success: true, matchFound: false});
});

app.post('/check-match', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.json({ success: false });

  if (playerMatches.has(userId)) {
    const matchId = playerMatches.get(userId);
    const m = activeMatches.get(matchId);
    if (m) {
      const opp = m.player1.userId === userId ? m.player2 : m.player1;
      return res.json({ success: true, matchFound: true, matchId, opponent: opp.username, opponentId: opp.userId });
    }
  }

  const idx = matchmakingQueue.findIndex(p => p.userId === userId);
  if (idx === -1) return res.json({ success: false, inQueue: false });

  res.json({ success: true, inQueue: true, matchFound: false, queuePosition: idx + 1 });
});

app.post('/cancel-matchmaking', (req, res) => {
  cleanupUserData(req.body.userId);
  res.json({ success: true });
});

app.post('/check-match-status', (req, res) => {
  const { matchId, userId, reason } = req.body;
  const m = activeMatches.get(matchId);
  if (!m) return res.json({ success: false, bothPlayersLeft: true });

  if (reason === 'heartbeat') m.lastHeartbeat[userId] = Date.now();

  const now = Date.now();
  const timeout = 15000;

  const p1 = now - m.lastHeartbeat[m.player1.userId] < timeout;
  const p2 = now - m.lastHeartbeat[m.player2.userId] < timeout;

  if (!p1 || !p2) {
    removeMatch(matchId);
    return res.json({ success: true, bothPlayersLeft: true });
  }

  res.json({ success: true, bothPlayersLeft: false });
});

app.post('/leave-match', (req, res) => {
  const { matchId, userId } = req.body;
  const done = removePlayerFromMatch(matchId, userId);
  res.json({ success: true, bothPlayersLeft: done });
});

function removePlayerFromMatch(matchId, userId) {
  const m = activeMatches.get(matchId);
  if (!m) {
    playerMatches.delete(userId);
    return true;
  }

  playerMatches.delete(userId);
  const other = m.player1.userId === userId ? m.player2.userId : m.player1.userId;

  if (!playerMatches.has(other)) {
    removeMatch(matchId);
    return true;
  }
  return false;
}

function removeMatch(matchId) {
  const m = activeMatches.get(matchId);
  if (!m) return;
  playerMatches.delete(m.player1.userId);
  playerMatches.delete(m.player2.userId);
  activeMatches.delete(matchId);
}

setInterval(() => {
  const now = Date.now();
  matchmakingQueue = matchmakingQueue.filter(p => now - p.timestamp < 300000);

  for (const [id, m] of activeMatches)
    if (now - m.createdAt > 600000) removeMatch(id);
}, 60000);

app.listen(process.env.PORT || 3000);
