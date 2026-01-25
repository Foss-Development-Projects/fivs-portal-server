import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/db.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Multer Config for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Store uploads in src/uploads (relative to current directory)
        const dir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = 'doc_' + crypto.randomBytes(8).toString('hex') + ext;
        cb(null, filename);
    }
});
const upload = multer({ storage });

const allowedTables: string[] = [
    'users', 'leads', 'transactions', 'tickets', 'banners',
    'notifications', 'autofetch_records', 'admin_payout_records',
    'payout_reports', 'profit_reports'
];

const isValidTable = (table: string | undefined): table is string => {
    return !!table && allowedTables.some(t => t === table);
};

// GET List
router.get('/:table', authMiddleware, async (req: Request, res: Response) => {
    const table = req.params.table as string;
    if (!isValidTable(table)) return res.status(404).json({ error: "Not Found" });

    try {
        const [rows] = await pool.execute<RowDataPacket[]>(`SELECT data FROM \`${table}\` ORDER BY updated_at DESC`);
        res.json(rows.map(r => JSON.parse(r.data)));
    } catch (err: any) {
        res.status(500).json({ error: "Storage Error", details: err.message });
    }
});

// GET Single
router.get('/:table/:id', authMiddleware, async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const { id } = req.params;
    if (!isValidTable(table)) return res.status(404).json({ error: "Not Found" });

    try {
        if (id) {
            const [rows] = await pool.execute<RowDataPacket[]>(`SELECT data FROM \`${table}\` WHERE id = ?`, [id]);
            if (rows.length > 0) res.json(JSON.parse(rows[0].data));
            else res.status(404).json({ error: "Not Found" });
        } else {
            const [rows] = await pool.execute<RowDataPacket[]>(`SELECT data FROM \`${table}\` ORDER BY updated_at DESC`);
            res.json(rows.map(r => JSON.parse(r.data)));
        }
    } catch (err: any) {
        res.status(500).json({ error: "Storage Error", details: err.message });
    }
});

// POST (Create or Update with Merge)
router.post('/:table', authMiddleware, upload.any(), async (req: Request, res: Response) => {
    const table = req.params.table as string;
    if (!isValidTable(table)) return res.status(404).json({ error: "Not Found" });

    try {
        let newItem: any = {};

        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
            newItem = JSON.parse(req.body.data || '{}');
            if (!newItem.documents) newItem.documents = {};

            (req.files as Express.Multer.File[]).forEach(file => {
                const docField = file.fieldname.replace('doc_', '');
                newItem.documents[docField] = `/api/uploads/${file.filename}`;
            });
        } else {
            newItem = req.body;
        }

        if (!newItem.id) return res.status(400).json({ error: "Missing Record ID" });

        let passwordHash: string | null = null;
        if (table === 'users' && newItem.password) {
            passwordHash = await bcrypt.hash(newItem.password, 10);
            delete newItem.password;
        }

        const conn = await pool.getConnection();
        await conn.beginTransaction();

        try {
            const hasPasswordHash = (table === 'users');
            const selectQuery = hasPasswordHash
                ? `SELECT data, password_hash FROM \`${table}\` WHERE id = ? FOR UPDATE`
                : `SELECT data FROM \`${table}\` WHERE id = ? FOR UPDATE`;

            const [rows] = await conn.execute<RowDataPacket[]>(selectQuery, [newItem.id]);

            let finalData;
            if (rows.length > 0) {
                const existing = JSON.parse(rows[0].data);
                finalData = { ...existing, ...newItem };

                if (hasPasswordHash) {
                    const currentHash = passwordHash || rows[0].password_hash;
                    await conn.execute(
                        `UPDATE \`${table}\` SET data = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [JSON.stringify(finalData), currentHash, newItem.id]
                    );
                } else {
                    await conn.execute(
                        `UPDATE \`${table}\` SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [JSON.stringify(finalData), newItem.id]
                    );
                }
            } else {
                finalData = newItem;
                if (hasPasswordHash) {
                    await conn.execute(
                        `INSERT INTO \`${table}\` (id, data, password_hash) VALUES (?, ?, ?)`,
                        [newItem.id, JSON.stringify(finalData), passwordHash]
                    );
                } else {
                    await conn.execute(
                        `INSERT INTO \`${table}\` (id, data) VALUES (?, ?)`,
                        [newItem.id, JSON.stringify(finalData)]
                    );
                }
            }

            await conn.commit();
            res.json(finalData);
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } catch (err: any) {
        res.status(500).json({ error: "Storage Error", details: err.message });
    }
});

// DELETE
router.delete('/:table/:id', authMiddleware, async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const { id } = req.params;
    if (!isValidTable(table)) return res.status(404).json({ error: "Not Found" });

    try {
        await pool.execute(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: "Delete Error", details: err.message });
    }
});

export default router;
