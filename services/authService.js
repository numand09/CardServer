const bcrypt = require('bcryptjs');
const User = require('../models/User');

class AuthService {
  static async register(username, password) {
    if (await User.findOne({ username })) return { success: false, message: 'Kullanıcı mevcut' };
    const hashed = await bcrypt.hash(password, 10);
    await new User({ username, password: hashed }).save();
    return { success: true, message: 'Kayıt başarılı' };
  }

  static async login(username, password) {
    const user = await User.findOne({ username });
    if (!user) return { success: false, message: 'Kullanıcı yok' };
    if (!(await bcrypt.compare(password, user.password))) return { success: false, message: 'Hatalı şifre' };
    return { success: true, userId: user._id, message: 'Giriş başarılı' };
  }
}

module.exports = AuthService;
