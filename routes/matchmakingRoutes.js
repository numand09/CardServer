const router = require('express').Router();
const { findMatch, leaveMatch } = require('../controllers/matchmakingController');

router.post('/find-match', findMatch);
router.post('/leave-match', leaveMatch);

module.exports = router;
