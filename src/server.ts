import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { log } from './utils/logger.js';
import { initDb, getPool } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import crudRoutes from './routes/crudRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const port = process.env.PORT || 8080;
const host = process.env.HOST || 'localhost';

// Static Files - Serve uploads
app.use('/api/uploads', express.static(path.join(__dirname, '../uploads')));

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

// Export for Testing
export { app, initDb, getPool };

// Start Server - Only if run directly (not during tests)
const isMain = process.argv[1] && (
    process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/') ||
    process.argv[1].replace(/\\/g, '/').endsWith('/tsx')
);

if (isMain) {
    app.listen(port, () => {
        log.success(`NodeJS Backend running on port ${host}:${port}`);
        initDb();
    });
}
