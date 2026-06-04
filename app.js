const express  = require('express');
const mongoose = require('mongoose');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/clients',    require('./routes/clientRoutes'));
app.use('/api/contracts',  require('./routes/contractRoutes'));
app.use('/api/choices',    require('./routes/choiceRoutes'));
app.use('/api/repairs',    require('./routes/repairRoutes'));
app.use('/api/devices',    require('./routes/deviceRoutes'));
app.use('/api/logs',       require('./routes/logRoutes'));
app.use('/api/utilities',  require('./routes/utilityRoutes'));

// ── Central error handler (must be last) ────────────────────────────────────
app.use(errorHandler);

// ── DB + server ──────────────────────────────────────────────────────────────
const PORT    = process.env.PORT    || 3000;
const MONGO   = process.env.MONGODB_URI || 'mongodb://localhost:27017/kiosk';

mongoose.connect(MONGO)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

module.exports = app;
