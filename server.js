const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();

// CORS ve JSON middleware - SIRALAMA ÖNEMLİ!
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check - İLK SIRADA OLMALI
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server çalışıyor!',
    endpoints: ['/register', '/login', '/find-match', '/check-match', '/cancel-matchmaking'],
    queueLength: matchmakingQueue.length,
    activeMatches: activeMatches.size
  });
});

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

// Maç bekleyen kullanıcılar için kuyruk
let matchmakingQueue = [];
// Bulunan maçları sakla (her iki kullanıcı da bilgiyi alabilsin)
let activeMatches = new Map();

// Maç bulma endpoint'i
app.post('/find-match', async (req, res) => {
  console.log('Find-match isteği alındı:', req.body);
  try {
    const { userId, username } = req.body;
    
    if (!userId || !username) {
      return res.json({ success: false, message: 'UserId ve username gerekli' });
    }
    
    // Kullanıcı için zaten aktif bir maç var mı kontrol et
    if (activeMatches.has(userId)) {
      const matchData = activeMatches.get(userId);
      console.log(`${username} için aktif maç bulundu:`, matchData);
      return res.json({
        success: true,
        matchFound: true,
        matchId: matchData.matchId,
        opponent: matchData.opponent,
        opponentId: matchData.opponentId,
        message: 'Maç bulundu!'
      });
    }
    
    // Kullanıcı zaten kuyrukta mı kontrol et
    const existingIndex = matchmakingQueue.findIndex(p => p.userId === userId);
    if (existingIndex !== -1) {
      return res.json({ success: false, message: 'Zaten maç bekliyorsunuz' });
    }
    
    // Kuyrukta başka biri var mı kontrol et
    if (matchmakingQueue.length > 0) {
      // İlk bekleyen kullanıcıyı al
      const opponent = matchmakingQueue.shift();
      
      // Maç ID'si oluştur
      const matchId = Date.now().toString();
      
      console.log(`Maç bulundu! ${username} vs ${opponent.username} - Match ID: ${matchId}`);
      
      // Her iki kullanıcı için maç verilerini sakla
      const player1Data = {
        matchId: matchId,
        opponent: opponent.username,
        opponentId: opponent.userId
      };
      
      const player2Data = {
        matchId: matchId,
        opponent: username,
        opponentId: userId
      };
      
      activeMatches.set(userId, player1Data);
      activeMatches.set(opponent.userId, player2Data);
      
      // 30 saniye sonra maç verilerini temizle (her iki kullanıcı da bilgiyi almış olmalı)
      setTimeout(() => {
        activeMatches.delete(userId);
        activeMatches.delete(opponent.userId);
        console.log(`Maç ${matchId} verileri temizlendi`);
      }, 30000);
      
      // İkinci kullanıcıya yanıt gönder
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
      
      console.log(`${username} maç kuyruğuna eklendi. Kuyruk uzunluğu: ${matchmakingQueue.length}`);
      
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
    
    // Önce aktif maçları kontrol et
    if (activeMatches.has(userId)) {
      const matchData = activeMatches.get(userId);
      console.log(`Check-match: ${userId} için maç bulundu:`, matchData);
      
      return res.json({
        success: true,
        matchFound: true,
        matchId: matchData.matchId,
        opponent: matchData.opponent,
        opponentId: matchData.opponentId
      });
    }
    
    // Kuyrukta kullanıcıyı bul
    const userIndex = matchmakingQueue.findIndex(p => p.userId === userId);
    
    if (userIndex === -1) {
      return res.json({ success: false, inQueue: false, message: 'Kuyrukta değilsiniz' });
    }
    
    // Hala bekliyor
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

// Kuyruktan çık
app.post('/cancel-matchmaking', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.json({ success: false, message: 'UserId gerekli' });
    }
    
    // Kuyruktan çıkar
    const index = matchmakingQueue.findIndex(p => p.userId === userId);
    if (index !== -1) {
      matchmakingQueue.splice(index, 1);
      console.log(`Kullanıcı kuyruktan çıktı. Kalan: ${matchmakingQueue.length}`);
    }
    
    // Aktif maçtan çıkar
    if (activeMatches.has(userId)) {
      activeMatches.delete(userId);
      console.log(`Kullanıcı aktif maçtan çıkarıldı: ${userId}`);
    }
    
    res.json({ success: true, message: 'Maç araması iptal edildi' });
    
  } catch (error) {
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
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
    
    res.json({ success: true, message: 'Giriş başarılı', userId: user._id });
  } catch (error) {
    console.error('Login hatası:', error);
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('Server çalışıyor!');
});

// Kuyruk temizleme (eski bağlantıları temizle)
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000; // 5 dakika
  
  matchmakingQueue = matchmakingQueue.filter(player => {
    return (now - player.timestamp) < timeout;
  });
}, 60000); // Her dakika kontrol et

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});