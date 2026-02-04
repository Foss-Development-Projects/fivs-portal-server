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
        // Store uploads in src/uploads (relative to current directory)
        const dir = path.join(__dirname, '../../uploads');
        const debugLogPath = path.join(__dirname, '../../upload_debug.log');

        try {
            fs.appendFileSync(debugLogPath, `[Multer] Processing file: ${file.originalname}\n`);
            fs.appendFileSync(debugLogPath, `[Multer] Target Dir: ${dir}\n`);

            if (!fs.existsSync(dir)) {
                fs.appendFileSync(debugLogPath, `[Multer] Directory does not exist, creating...\n`);
                fs.mkdirSync(dir, { recursive: true });
            } else {
                fs.appendFileSync(debugLogPath, `[Multer] Directory exists.\n`);
            }
            cb(null, dir);
        } catch (err: any) {
            if (fs.existsSync(debugLogPath)) fs.appendFileSync(debugLogPath, `[Multer] Error: ${err.message}\n`);
            cb(err, dir);
        }
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = 'doc_' + crypto.randomBytes(8).toString('hex') + ext;
        const debugLogPath = path.join(__dirname, '../../upload_debug.log');
        fs.appendFileSync(debugLogPath, `[Multer] Generated Filename: ${filename}\n`);
        cb(null, filename);
    }
});
const upload = multer({ storage });

// GET List
router.get('/:table', authMiddleware, crudController.getList);

// GET Single
router.get('/:table/:id', authMiddleware, crudController.getSingle);

// POST (Create or Update with Merge)
router.post('/:table', authMiddleware, upload.any(), crudController.createOrUpdate);

// DELETE
router.delete('/:table/:id', authMiddleware, crudController.deleteItem);

export default router;

