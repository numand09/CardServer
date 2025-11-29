const AuthService = require('../services/authService');

const register = async (req, res) => {
  const { username, password } = req.body;
  const result = await AuthService.register(username, password);
  res.json(result);
};

const login = async (req, res) => {
  const { username, password } = req.body;
  const result = await AuthService.login(username, password);
  res.json(result);
};

module.exports = { register, login };
