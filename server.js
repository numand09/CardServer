const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB bağlantısı
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB bağlandı'))
  .catch(err => console.log('MongoDB bağlantı hatası:', err));

// User Schema
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

// Matchmaking ve maç yönetimi
let matchmakingQueue = [];
let activeMatches = new Map(); // matchId -> {player1, player2, createdAt}
let playerMatches = new Map(); // userId -> matchId

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server çalışıyor!',
    endpoints: ['/register', '/login', '/find-match', '/check-match', '/cancel-matchmaking', '/leave-match', '/check-match-status'],
    queueLength: matchmakingQueue.length,
    activeMatches: activeMatches.size,
    activePlayers: playerMatches.size
  });
});

// Kayıt endpoint
app.post('/register', async (req, res) => {
  console.log('Register isteği alındı:', req.body);
  try {
    const { username, password } = req.body;
    
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.json({ success: false, message: 'Kullanıcı zaten mevcut' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = new User({
      username,
      password: hashedPassword
    });
    
    await newUser.save();
    res.json({ success: true, message: 'Kayıt başarılı' });
  } catch (error) {
    console.error('Register hatası:', error);
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  console.log('Login isteği alındı:', req.body);
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.json({ success: false, message: 'Kullanıcı bulunamadı' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.json({ success: false, message: 'Hatalı şifre' });
    }
    
    // Login olurken eski matchmaking verilerini temizle
    cleanupUserData(user._id.toString());
    
    res.json({ success: true, message: 'Giriş başarılı', userId: user._id });
  } catch (error) {
    console.error('Login hatası:', error);
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Kullanıcının tüm verilerini temizle
function cleanupUserData(userId) {
  // Kuyruktan çıkar
  const queueIndex = matchmakingQueue.findIndex(p => p.userId === userId);
  if (queueIndex !== -1) {
    matchmakingQueue.splice(queueIndex, 1);
    console.log(`Kullanıcı kuyruktan temizlendi: ${userId}`);
  }
  
  // Aktif maçtan çıkar
  if (playerMatches.has(userId)) {
    const matchId = playerMatches.get(userId);
    removePlayerFromMatch(matchId, userId);
  }
}

// Maç bulma endpoint
app.post('/find-match', async (req, res) => {
  console.log('Find-match isteği alındı:', req.body);
  try {
    const { userId, username } = req.body;
    
    if (!userId || !username) {
      return res.json({ success: false, message: 'UserId ve username gerekli' });
    }
    
    // Kullanıcı zaten bir maçta mı kontrol et
    if (playerMatches.has(userId)) {
      const existingMatchId = playerMatches.get(userId);
      const matchData = activeMatches.get(existingMatchId);
      
      if (matchData) {
        const opponent = matchData.player1.userId === userId ? matchData.player2 : matchData.player1;
        console.log(`${username} zaten bir maçta: ${existingMatchId}`);
        
        return res.json({
          success: true,
          matchFound: true,
          matchId: existingMatchId,
          opponent: opponent.username,
          opponentId: opponent.userId,
          message: 'Zaten bir maçtasınız'
        });
      } else {
        // Maç verisi yoksa temizle
        playerMatches.delete(userId);
      }
    }
    
    // Kullanıcı zaten kuyrukta mı kontrol et
    const existingIndex = matchmakingQueue.findIndex(p => p.userId === userId);
    if (existingIndex !== -1) {
      console.log(`${username} zaten kuyrukta`);
      return res.json({ success: true, matchFound: false, message: 'Zaten maç bekliyorsunuz' });
    }
    
    // Kuyrukta başka biri var mı kontrol et
    if (matchmakingQueue.length > 0) {
      const opponent = matchmakingQueue.shift();
      
      // Kendisiyle eşleşmeyi engelle
      if (opponent.userId === userId) {
        console.log('Kullanıcı kendisiyle eşleşemez, kuyruğa geri ekleniyor');
        matchmakingQueue.push(opponent);
        matchmakingQueue.push({
          userId: userId,
          username: username,
          timestamp: Date.now()
        });
        return res.json({ success: true, matchFound: false, message: 'Rakip bekleniyor...' });
      }
      
      const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`✅ MAÇ OLUŞTURULDU: ${matchId}`);
      console.log(`   Oyuncu 1: ${opponent.username} (${opponent.userId})`);
      console.log(`   Oyuncu 2: ${username} (${userId})`);
      
      // Maç verisini sakla
      const matchData = {
        matchId: matchId,
        player1: {
          userId: opponent.userId,
          username: opponent.username
        },
        player2: {
          userId: userId,
          username: username
        },
        createdAt: Date.now(),
        lastHeartbeat: {
          [opponent.userId]: Date.now(),
          [userId]: Date.now()
        }
      };
      
      activeMatches.set(matchId, matchData);
      playerMatches.set(opponent.userId, matchId);
      playerMatches.set(userId, matchId);
      
      res.json({
        success: true,
        matchFound: true,
        matchId: matchId,
        opponent: opponent.username,
        opponentId: opponent.userId,
        message: 'Maç bulundu!'
      });
      
    } else {
      // Kuyruğa ekle
      matchmakingQueue.push({
        userId: userId,
        username: username,
        timestamp: Date.now()
      });
      
      console.log(`${username} kuyruğa eklendi. Kuyruk: ${matchmakingQueue.length}`);
      
      res.json({
        success: true,
        matchFound: false,
        message: 'Rakip bekleniyor...'
      });
    }
    
  } catch (error) {
    console.error('Maç bulma hatası:', error);
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Maç durumunu kontrol et (polling için)
app.post('/check-match', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.json({ success: false, message: 'UserId gerekli' });
    }
    
    // Kullanıcının aktif maçı var mı kontrol et
    if (playerMatches.has(userId)) {
      const matchId = playerMatches.get(userId);
      const matchData = activeMatches.get(matchId);
      
      if (matchData) {
        const opponent = matchData.player1.userId === userId ? matchData.player2 : matchData.player1;
        
        return res.json({
          success: true,
          matchFound: true,
          matchId: matchId,
          opponent: opponent.username,
          opponentId: opponent.userId
        });
      }
    }
    
    // Kuyrukta kullanıcıyı bul
    const userIndex = matchmakingQueue.findIndex(p => p.userId === userId);
    
    if (userIndex === -1) {
      return res.json({ success: false, inQueue: false, message: 'Kuyrukta değilsiniz' });
    }
    
    res.json({
      success: true,
      inQueue: true,
      matchFound: false,
      message: 'Rakip bekleniyor...',
      queuePosition: userIndex + 1
    });
    
  } catch (error) {
    console.error('Maç kontrol hatası:', error);
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Matchmaking iptal
app.post('/cancel-matchmaking', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.json({ success: false, message: 'UserId gerekli' });
    }
    
    cleanupUserData(userId);
    
    res.json({ success: true, message: 'Maç araması iptal edildi' });
    
  } catch (error) {
    console.error('Cancel matchmaking hatası:', error);
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Maç durumunu kontrol et (heartbeat ve opponent check için)
app.post('/check-match-status', async (req, res) => {
  try {
    const { matchId, userId, reason } = req.body;
    
    if (!matchId || !userId) {
      return res.json({ success: false, message: 'MatchId ve userId gerekli' });
    }
    
    const matchData = activeMatches.get(matchId);
    
    if (!matchData) {
      return res.json({ 
        success: false, 
        bothPlayersLeft: true,
        message: 'Maç bulunamadı' 
      });
    }
    
    // Heartbeat güncelle
    if (reason === 'heartbeat') {
      matchData.lastHeartbeat[userId] = Date.now();
    }
    
    // Her iki oyuncu da hala aktif mi kontrol et
    const now = Date.now();
    const heartbeatTimeout = 15000; // 15 saniye
    
    const player1Active = (now - matchData.lastHeartbeat[matchData.player1.userId]) < heartbeatTimeout;
    const player2Active = (now - matchData.lastHeartbeat[matchData.player2.userId]) < heartbeatTimeout;
    
    if (!player1Active || !player2Active) {
      console.log(`⚠️ Maç ${matchId} - Bir oyuncu bağlantısını kaybetti`);
      removeMatch(matchId);
      
      return res.json({
        success: true,
        bothPlayersLeft: true,
        message: 'Rakip bağlantıyı kaybetti'
      });
    }
    
    res.json({
      success: true,
      bothPlayersLeft: false,
      message: 'Maç devam ediyor'
    });
    
  } catch (error) {
    console.error('Check match status hatası:', error);
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Maçtan ayrıl
app.post('/leave-match', async (req, res) => {
  try {
    const { matchId, userId, reason } = req.body;
    
    if (!matchId || !userId) {
      return res.json({ success: false, message: 'MatchId ve userId gerekli' });
    }
    
    console.log(`🚪 Oyuncu maçtan ayrılıyor: ${userId} - Sebep: ${reason}`);
    
    const bothLeft = removePlayerFromMatch(matchId, userId);
    
    res.json({
      success: true,
      bothPlayersLeft: bothLeft,
      message: 'Maçtan ayrıldınız'
    });
    
  } catch (error) {
    console.error('Leave match hatası:', error);
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Yardımcı fonksiyon: Oyuncuyu maçtan çıkar
function removePlayerFromMatch(matchId, userId) {
  const matchData = activeMatches.get(matchId);
  
  if (!matchData) {
    playerMatches.delete(userId);
    return true;
  }
  
  // Oyuncuyu maçtan çıkar
  playerMatches.delete(userId);
  
  // Diğer oyuncu hala maçta mı kontrol et
  const otherPlayerId = matchData.player1.userId === userId 
    ? matchData.player2.userId 
    : matchData.player1.userId;
  
  const otherPlayerStillInMatch = playerMatches.has(otherPlayerId);
  
  if (!otherPlayerStillInMatch) {
    // Her iki oyuncu da ayrıldı, maçı tamamen sil
    removeMatch(matchId);
    console.log(`❌ Maç tamamen silindi: ${matchId}`);
    return true;
  }
  
  console.log(`⚠️ Bir oyuncu ayrıldı, diğeri hala maçta: ${matchId}`);
  return false;
}

// Yardımcı fonksiyon: Maçı tamamen sil
function removeMatch(matchId) {
  const matchData = activeMatches.get(matchId);
  
  if (matchData) {
    playerMatches.delete(matchData.player1.userId);
    playerMatches.delete(matchData.player2.userId);
    activeMatches.delete(matchId);
  }
}

// Kuyruk ve maç temizleme (periyodik)
setInterval(() => {
  const now = Date.now();
  const queueTimeout = 5 * 60 * 1000; // 5 dakika
  const matchTimeout = 10 * 60 * 1000; // 10 dakika
  
  // Eski kuyruk girişlerini temizle
  const oldQueueLength = matchmakingQueue.length;
  matchmakingQueue = matchmakingQueue.filter(player => {
    return (now - player.timestamp) < queueTimeout;
  });
  
  if (oldQueueLength !== matchmakingQueue.length) {
    console.log(`🧹 Kuyruk temizlendi: ${oldQueueLength} -> ${matchmakingQueue.length}`);
  }
  
  // Eski maçları temizle
  const oldMatchCount = activeMatches.size;
  for (const [matchId, matchData] of activeMatches.entries()) {
    if ((now - matchData.createdAt) > matchTimeout) {
      console.log(`🧹 Eski maç temizleniyor: ${matchId}`);
      removeMatch(matchId);
    }
  }
  
  if (oldMatchCount !== activeMatches.size) {
    console.log(`🧹 Maçlar temizlendi: ${oldMatchCount} -> ${activeMatches.size}`);
  }
  
}, 60000); // Her dakika

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda çalışıyor`);
  console.log(`📊 Endpoints hazır: /register, /login, /find-match, /check-match, /cancel-matchmaking, /leave-match, /check-match-status`);
});