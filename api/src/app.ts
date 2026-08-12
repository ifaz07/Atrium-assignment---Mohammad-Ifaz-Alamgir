import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { login, logout, me, requireSession } from './auth';
import sessionRoutes from './routes/sessions';
import roomRoutes from './routes/rooms';
import peopleRoutes from './routes/people';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.WEB_BASE_URL || 'http://localhost:3000',
      credentials: true
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.post('/api/login', login);
  app.post('/api/logout', logout);
  app.get('/api/me', requireSession, me);

  app.use('/api/sessions', sessionRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/people', peopleRoutes);

  return app;
}
