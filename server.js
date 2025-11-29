const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const matchmakingRoutes = require('./routes/matchmakingRoutes');
const MatchmakingService = require('./services/matchmakingService');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

app.use('/auth', authRoutes);
app.use('/match', matchmakingRoutes);

setInterval(() => MatchmakingService.cleanupQueues(), 60000);

app.listen(process.env.PORT || 3000, () => console.log('Server çalışıyor'));
