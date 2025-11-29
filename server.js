const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

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

// Maç bulma endpoint'i
app.post('/find-match', async (req, res) => {
  try {
    const { userId, username } = req.body;
    
    if (!userId || !username) {
      return res.json({ success: false, message: 'UserId ve username gerekli' });
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
      
      // Her iki kullanıcıya da maç bilgisi gönder
      res.json({
        success: true,
        matchFound: true,
        matchId: matchId,
        opponent: opponent.username,
        opponentId: opponent.userId,
        message: 'Maç bulundu!'
      });
      
      // Rakip kullanıcıya bilgi gönderilecek (polling ile alınacak)
      opponent.matchData = {
        matchId: matchId,
        opponent: username,
        opponentId: userId
      };
      
    } else {
      // Kuyruğa ekle
      matchmakingQueue.push({
        userId: userId,
        username: username,
        timestamp: Date.now(),
        matchData: null
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
    
    // Kuyrukta kullanıcıyı bul
    const userIndex = matchmakingQueue.findIndex(p => p.userId === userId);
    
    if (userIndex === -1) {
      return res.json({ success: false, inQueue: false, message: 'Kuyrukta değilsiniz' });
    }
    
    const user = matchmakingQueue[userIndex];
    
    // Maç bulundu mu kontrol et
    if (user.matchData) {
      // Kullanıcıyı kuyruktan çıkar
      matchmakingQueue.splice(userIndex, 1);
      
      res.json({
        success: true,
        matchFound: true,
        matchId: user.matchData.matchId,
        opponent: user.matchData.opponent,
        opponentId: user.matchData.opponentId
      });
    } else {
      res.json({
        success: true,
        inQueue: true,
        matchFound: false,
        message: 'Rakip bekleniyor...'
      });
    }
    
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
    
    const index = matchmakingQueue.findIndex(p => p.userId === userId);
    if (index !== -1) {
      matchmakingQueue.splice(index, 1);
      console.log(`Kullanıcı kuyruktan çıktı. Kalan: ${matchmakingQueue.length}`);
    }
    
    res.json({ success: true, message: 'Maç araması iptal edildi' });
    
  } catch (error) {
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Kayıt endpoint
app.post('/register', async (req, res) => {
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
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
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