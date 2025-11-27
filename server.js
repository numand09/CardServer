const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB bağlantısı - MONGODB_URI'yi Render.com environment variables'a ekleyin
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

// Kayıt endpoint
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
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
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
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
    res.json({ success: false, message: 'Hata: ' + error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('Server çalışıyor!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});