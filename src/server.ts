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
    log.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    log.error('UNHANDLED REJECTION:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Enhanced CORS for development and cross-origin usage
app.use(cors());

// Global Request Logger
app.use((req, res, next) => {
    res.on('finish', () => {
        if (req.method !== 'GET' || res.statusCode >= 400) {
            log.info(`${req.method} ${req.path} -> ${res.statusCode}`);
        }
    });
    next();
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || 'localhost';

// Static Files - Serve uploads
const uploadDir = path.join(process.cwd(), 'uploads');
app.use('/api/uploads', express.static(uploadDir));
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
