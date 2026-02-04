import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { log } from './utils/logger.js';
import { initDb, getPool } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import crudRoutes from './routes/crudRoutes.js';

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Request Logger
app.use((req, res, next) => {
    log.info(`${req.method} ${req.path}`);
    next();
});

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || 'localhost';

// Static Files - Serve uploads
app.use('/api/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api/uploads', (req: Request, res: Response) => {
    res.status(404).json({ error: "File Not Found" });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', crudRoutes);

// Serve Frontend (Vite Build)
app.use(express.static(path.join(__dirname, '../../client/dist')));
app.get(/(.*)/, (req: Request, res: Response) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: "API Route Not Found" });
    const indexPath = path.join(__dirname, '../../client/dist', 'index.html');
    res.sendFile(indexPath);
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: any) => {
    log.error(`Unhandled Error [${req.method} ${req.path}]:`, err.message);
    res.status(500).json({
        error: "Internal Server Error",
        details: err.message || "An unexpected error occurred",
        path: req.path
    });
});

// Start Server
app.listen(port, () => {
    log.success(`NodeJS Backend running on port ${host}:${port}`);
    initDb();
});

export { app, initDb, getPool };
