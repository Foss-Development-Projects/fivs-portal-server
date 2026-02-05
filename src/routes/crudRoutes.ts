import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/authMiddleware.js';
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
        const uploadDir = path.join(rootDir, 'uploads');

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

// POST (Create or Update with Merge)
router.post('/:table', authMiddleware, (req, res, next) => {
    upload.any()(req, res, (err) => {
        if (err) {
            console.error(`[MULTER ERROR] ${err.message}`);
            return res.status(400).json({ error: "File Upload Error", details: err.message });
        }
        next();
    });
}, crudController.createOrUpdate);

// DELETE
router.delete('/:table/:id', authMiddleware, crudController.deleteItem);

export default router;

