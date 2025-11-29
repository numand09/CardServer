const router = require('express').Router();


router.post('/check-match-status', (req, res) => {
    // Bu endpoint server.js içinde tanımlanmıştır
    res.status(404).json({ error: 'Bu route server.js içinde tanımlanmalı' });
});

router.post('/leave-match', (req, res) => {
    // Bu endpoint server.js içinde tanımlanmıştır
    res.status(404).json({ error: 'Bu route server.js içinde tanımlanmalı' });
});

module.exports = router;