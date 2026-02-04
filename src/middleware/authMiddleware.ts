import { Request, Response, NextFunction } from 'express';
import { pool, isDbReady, dbError } from '../config/db.js';
import { RowDataPacket } from 'mysql2/promise';

// Extend Express Request type to include user
declare global {
    namespace Express {
        interface Request {
            user?: any;
        }
    }
}

// DB Guard Middleware
export const dbGuard = (req: Request, res: Response, next: NextFunction) => {
    if (!isDbReady) {
        return res.status(503).json({ error: "Database initializing", message: dbError || "Connecting..." });
    }
    next();
};

// Auth Middleware for Protected Routes
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = (req.headers['authorization'] as string) || '';
    const xAuthToken = (req.headers['x-auth-token'] as string) || '';
    let token = '';

    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else {
        token = xAuthToken;
    }

    if (!token) return res.status(401).json({ error: "Unauthorized: Missing Token" });

    try {
        const [rows] = await pool.execute<RowDataPacket[]>(
            "SELECT * FROM users WHERE session_token = ?",
            [token]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: "Unauthorized: Invalid or Expired Token" });
        }

        const dbUser = rows[0];
        // Normalize user object from flat columns
        const userData: any = {
            id: dbUser.id,
            email: dbUser.email,
            username: dbUser.username,
            mobile: dbUser.mobile,
            role: dbUser.role,
            status: dbUser.status,
            name: dbUser.name,
            kycStatus: dbUser.kyc_status,
            kycReason: dbUser.kyc_reason,
            kycDocuments: dbUser.kyc_documents,
            bankName: dbUser.bank_name,
            accountNumber: dbUser.account_number,
            ifscCode: dbUser.ifsc_code,
            accountHolder: dbUser.account_holder,
            leadSubmissionEnabled: !!dbUser.lead_submission_enabled,
            category: dbUser.category,
            session_token: dbUser.session_token,
            session_expiry: dbUser.session_expiry
        };
        const now = Math.floor(Date.now() / 1000);

        if (userData.session_expiry && userData.session_expiry < now) {
            return res.status(401).json({ error: "Session Expired" });
        }

        // Sliding window refresh
        const role = (userData.role || 'partner').toLowerCase();
        const timeoutSeconds = (role === 'admin') ? 3600 : 600;
        const newExpiry = now + timeoutSeconds;

        await pool.execute(
            "UPDATE users SET session_expiry = ? WHERE id = ?",
            [newExpiry, userData.id]
        );

        req.user = userData;
        req.user.session_expiry = newExpiry;
        next();
    } catch (err: any) {
        console.error('AUTH MIDDLEWARE ERROR:', err);
        res.status(500).json({ error: "Auth Error", details: err.message });
    }
};
