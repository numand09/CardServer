const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB bağlantısı - Geliştirilmiş yapılandırma
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000, // 30 saniye timeout
      socketTimeoutMS: 45000,
    });
    console.log('MongoDB başarıyla bağlandı');
  } catch (error) {
    console.error('MongoDB bağlantı hatası:', error);
    process.exit(1);
  }
};

connectDB();

// Bağlantı olaylarını dinle
mongoose.connection.on('connected', () => {
  console.log('Mongoose MongoDB\'ye bağlandı');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose bağlantı hatası:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose bağlantısı kesildi');
});

// User Schema
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

// Kayıt endpoint
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.json({ success: false, message: 'Kullanıcı adı ve şifre gerekli' });
    }
    
    // Kullanıcı var mı kontrol et
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.json({ success: false, message: 'Kullanıcı zaten mevcut' });
    }
    
    // Şifreyi hashle
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Yeni kullanıcı oluştur
    const newUser = new User({
      username,
      password: hashedPassword
    });
    
    await newUser.save();
    res.json({ success: true, message: 'Kayıt başarılı' });
  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.json({ success: false, message: 'Kullanıcı adı ve şifre gerekli' });
    }
    
    // Kullanıcıyı bul
    const user = await User.findOne({ username });
    if (!user) {
      return res.json({ success: false, message: 'Kullanıcı bulunamadı' });
    }
    
    // Şifre kontrolü
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

// Database durumu kontrol endpoint
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    server: 'çalışıyor',
    database: states[dbState],
    timestamp: new Date()
  });
});

// Ana endpoint
app.get('/', (req, res) => {
  res.send('Server çalışıyor! /health endpoint ile database durumunu kontrol edebilirsiniz.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});