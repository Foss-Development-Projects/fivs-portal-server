import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { compressImages } from '../middleware/imageCompression.js';
import { fileURLToPath } from 'url';
import * as crudController from '../controllers/crudController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Multer Config for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Use absolute path for reliability across environments
        const rootDir = process.cwd();
        const ext = path.extname(file.originalname).toLowerCase();
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'];

        // Define destination subfolder
        let subFolder = 'uploads';
        if (ext === '.pdf') {
            subFolder = path.join('uploads', 'docs');
        } else if (imageExtensions.includes(ext)) {
            subFolder = path.join('uploads', 'img');
        }

        const uploadDir = path.join(rootDir, subFolder);

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const uniqueSuffix = crypto.randomBytes(8).toString('hex');
        const filename = `doc_${Date.now()}_${uniqueSuffix}${ext}`;
        cb(null, filename);
    }
});
const upload = multer({ storage });

// GET List
router.get('/:table', authMiddleware, crudController.getList);

// GET Single
router.get('/:table/:id', authMiddleware, crudController.getSingle);

const logDebug = (msg: string) => {
    try {
        const logFile = path.join(process.cwd(), 'logs', 'debug_routes.log');
        // Ensure logs dir exists
        const logsDir = path.dirname(logFile);
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

        fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) {
        console.error('Logging failed', e);
    }
};

// POST (Create or Update with Merge)
router.post('/:table', (req, res, next) => {
    logDebug(`POST Route hit for table: ${req.params.table}`);
    next();
}, authMiddleware, (req, res, next) => {
    logDebug(`Auth passed for table: ${req.params.table}`);
    upload.any()(req, res, (err) => {
        if (err) {
            logDebug(`Multer error: ${err.message}`);
            console.error(`[MULTER ERROR] ${err.message}`);
            return res.status(400).json({ error: "File Upload Error", details: err.message });
        }
        logDebug(`Multer success. Files: ${req.files?.length}`);
        next();
    });
}, compressImages, crudController.createOrUpdate);

// DELETE
router.delete('/:table/:id', authMiddleware, crudController.deleteItem);

export default router;

