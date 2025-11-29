const MatchmakingService = require('../services/matchmakingService');

const findMatch = (req, res) => {
  const { userId, username } = req.body;
  const match = MatchmakingService.addToQueue({ userId, username });
  if (match) res.json({ success: true, matchFound: true, matchId: match.matchId });
  else res.json({ success: true, matchFound: false });
};

const leaveMatch = (req, res) => {
  const { userId } = req.body;
  MatchmakingService.removePlayer(userId);
  res.json({ success: true });
};

module.exports = { findMatch, leaveMatch };
