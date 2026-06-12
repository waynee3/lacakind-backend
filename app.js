import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler.js';

import authRoutes     from './routes/authRoutes.js';
import clientRoutes   from './routes/clientRoutes.js';
import contractRoutes from './routes/contractRoutes.js';
import choiceRoutes   from './routes/choiceRoutes.js';
import repairRoutes   from './routes/repairRoutes.js';
import deviceRoutes   from './routes/deviceRoutes.js';
import logRoutes      from './routes/logRoutes.js';
import utilityRoutes  from './routes/utilityRoutes.js';
import dashboardRouter from './routes/dashboardRoutes.js';

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

app.use('/api/auth',      authRoutes);
app.use('/api/clients',   clientRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/choices',   choiceRoutes);
app.use('/api/repairs',   repairRoutes);
app.use('/api/devices',   deviceRoutes);
app.use('/api/logs',      logRoutes);
app.use('/api/utilities', utilityRoutes);
app.use('/api/dashboard', dashboardRouter);

app.use(errorHandler);

const PORT  = process.env.PORT        || 3000;
const MONGO = process.env.MONGODB_URI || 'mongodb://localhost:27017/device';

mongoose.connect(MONGO)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

export default app;