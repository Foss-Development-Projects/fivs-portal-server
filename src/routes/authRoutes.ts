import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/db.js';
import { dbGuard, authMiddleware } from '../middleware/authMiddleware.js';
import { log } from '../utils/logger.js';

const router = Router();

// Login
router.post('/login', dbGuard, async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email/Password required" });

    try {
        const [rows] = await pool.execute<RowDataPacket[]>(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (rows.length > 0) {
            const dbUserRecord = rows[0];
            // Normalize user object from flat columns
            const user: any = {
                id: dbUserRecord.id,
                email: dbUserRecord.email,
                username: dbUserRecord.username,
                mobile: dbUserRecord.mobile,
                role: dbUserRecord.role,
                status: dbUserRecord.status,
                name: dbUserRecord.name,
                kycStatus: dbUserRecord.kyc_status,
                kycReason: dbUserRecord.kyc_reason,
                kycDocuments: dbUserRecord.kyc_documents,
                bankName: dbUserRecord.bank_name,
                accountNumber: dbUserRecord.account_number,
                ifscCode: dbUserRecord.ifsc_code,
                accountHolder: dbUserRecord.account_holder,
                leadSubmissionEnabled: !!dbUserRecord.lead_submission_enabled,
                category: dbUserRecord.category,
                session_token: dbUserRecord.session_token,
                session_expiry: dbUserRecord.session_expiry
            };
            const hash = dbUserRecord.password_hash;

            const isMatch = hash ? await bcrypt.compare(password, hash) : (user.password === password);

            if (isMatch) {
                if (!hash) {
                    const newHash = await bcrypt.hash(password, 10);
                    delete user.password;
                    await pool.execute(
                        "UPDATE users SET password_hash = ? WHERE id = ?",
                        [newHash, user.id]
                    );
                }

                const status = (user.status || '').toLowerCase();
                const role = (user.role || '').toLowerCase();

                if (status === 'suspended' || status === 'frozen') {
                    return res.status(403).json({ error: "Account Suspended. Contact Support." });
                }

                if (role === 'partner' && status === 'pending') {
                    return res.status(403).json({ error: "Your account is waiting for Admin approval." });
                }

                const token = crypto.randomBytes(32).toString('hex');
                const timeoutSeconds = (role === 'admin') ? 3600 : 600;
                const expiry = Math.floor(Date.now() / 1000) + timeoutSeconds;

                user.session_token = token;
                user.session_expiry = expiry;

                await pool.execute(
                    "UPDATE users SET session_token = ?, session_expiry = ? WHERE id = ?",
                    [token, expiry, user.id]
                );

                delete user.password;
                res.json({ token, user });
            } else {
                res.status(401).json({ error: "Invalid Credentials" });
            }
        } else {
            res.status(401).json({ error: "User Not Found" });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Register
router.post('/register', dbGuard, async (req: Request, res: Response) => {
    const newUser = req.body;
    if (!newUser || !newUser.email) return res.status(400).json({ error: "Invalid Data" });

    try {
        const [rows] = await pool.execute<RowDataPacket[]>(
            "SELECT id FROM users WHERE email = ?",
            [newUser.email]
        );

        if (rows.length > 0) {
            return res.status(409).json({ error: "Email already exists" });
        }

        const passwordHash = await bcrypt.hash(newUser.password, 10);
        delete newUser.password;

        await pool.execute(
            `INSERT INTO users (
                id, email, username, mobile, password_hash, role, status, name, 
                kyc_status, kyc_reason, kyc_documents, 
                bank_name, account_number, ifsc_code, account_holder, 
                lead_submission_enabled, category
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                newUser.id, newUser.email, newUser.username || null, newUser.mobile || newUser.phone || null, passwordHash,
                newUser.role || 'partner', newUser.status || 'pending', newUser.name,
                newUser.kycStatus || 'not_submitted', newUser.kycReason || null, newUser.kycDocuments ? JSON.stringify(newUser.kycDocuments) : null,
                newUser.bankName || null, newUser.accountNumber || null, newUser.ifscCode || null, newUser.accountHolder || null,
                newUser.leadSubmissionEnabled || false, newUser.category || null
            ]
        );
        res.json(newUser);
    } catch (err: any) {
        log.error("Registration Failed:", err);
        res.status(500).json({ error: err.message });
    }
});

// Auth Status (Heartbeat)
router.get('/status', authMiddleware, (req: Request, res: Response) => {
    res.json({
        status: "active",
        expiry: req.user.session_expiry,
        server_time: Math.floor(Date.now() / 1000)
    });
});

export default router;
