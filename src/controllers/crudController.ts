import { Request, Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/db.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const allowedTables: string[] = [
    'users', 'leads', 'transactions', 'tickets', 'banners',
    'notifications', 'autofetch_records', 'admin_payout_records',
    'payout_reports', 'profit_reports'
];

const isValidTable = (table: string | undefined): table is string => {
    return !!table && allowedTables.some(t => t === table);
};

const safeParse = (str: string, fallback: any = {}) => {
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
};

const deleteFileByUrl = async (url: string) => {
    if (!url || typeof url !== 'string') return;

    if (url.startsWith('/api/uploads/')) {
        // Resolve relative path to absolute filesystem path
        const relativePath = url.replace('/api/uploads/', '');
        const fullPath = path.join(process.cwd(), 'uploads', relativePath);

        console.log(`[Cleanup] Attempting to delete: ${url}`);
        console.log(`[Cleanup] Resolved full path: ${fullPath}`);

        if (fs.existsSync(fullPath)) {
            fs.unlink(fullPath, (err) => {
                if (err) {
                    console.error(`[Cleanup] Failed to delete file: ${fullPath}`, err.message);
                } else {
                    console.log(`[Cleanup] Successfully deleted local: ${relativePath}`);
                }
            });
        } else {
            console.warn(`[Cleanup] File not found at path: ${fullPath}`);
        }
    }
};

/**
 * Recursively find all strings matching the upload URL pattern in any object/array
 */
const findAllUploadUrls = (obj: any, urls: Set<string> = new Set()): string[] => {
    if (!obj) return Array.from(urls);

    if (typeof obj === 'string') {
        if (obj.startsWith('/api/uploads/')) {
            urls.add(obj);
        }
    } else if (Array.isArray(obj)) {
        obj.forEach(item => findAllUploadUrls(item, urls));
    } else if (typeof obj === 'object') {
        Object.values(obj).forEach(val => findAllUploadUrls(val, urls));
    }

    return Array.from(urls);
};

// GET List
export const getList = async (req: Request, res: Response) => {
    const table = req.params.table as string;
    if (!isValidTable(table)) return res.status(404).json({ error: "Not Found" });

    try {
        const selectSql = (table === 'users') ? `SELECT * FROM \`${table}\` ORDER BY updated_at DESC` : `SELECT data FROM \`${table}\` ORDER BY updated_at DESC`;
        const [rows] = await pool.execute<RowDataPacket[]>(selectSql);

        if (table === 'users') {
            res.json(rows.map(r => {
                const user: any = {
                    id: r.id, email: r.email, username: r.username, mobile: r.mobile, role: r.role, status: r.status, name: r.name,
                    kycStatus: r.kyc_status, kycReason: r.kyc_reason, kycDocuments: r.kyc_documents,
                    bankName: r.bank_name, accountNumber: r.account_number, ifscCode: r.ifsc_code, accountHolder: r.account_holder,
                    leadSubmissionEnabled: !!r.lead_submission_enabled, category: r.category,
                    session_token: r.session_token, session_expiry: r.session_expiry
                };
                return user;
            }));
        } else {
            res.json(rows.map(r => safeParse(r.data)));
        }
    } catch (err: any) {
        res.status(500).json({ error: "Storage Error", details: err.message });
    }
};

// GET Single
export const getSingle = async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const { id } = req.params;
    if (!isValidTable(table)) return res.status(404).json({ error: "Not Found" });

    try {
        if (table === 'users') {
            const query = id ? `SELECT * FROM users WHERE id = ?` : `SELECT * FROM users ORDER BY updated_at DESC`;
            const params = id ? [id] : [];
            const [rows] = await pool.execute<RowDataPacket[]>(query, params);

            if (id && rows.length === 0) return res.status(404).json({ error: "Not Found" });

            const mapUser = (r: any) => ({
                id: r.id, email: r.email, username: r.username, mobile: r.mobile, role: r.role, status: r.status, name: r.name,
                kycStatus: r.kyc_status, kycReason: r.kyc_reason, kycDocuments: r.kyc_documents,
                bankName: r.bank_name, accountNumber: r.account_number, ifscCode: r.ifsc_code, accountHolder: r.account_holder,
                leadSubmissionEnabled: !!r.lead_submission_enabled, category: r.category,
                session_token: r.session_token, session_expiry: r.session_expiry
            });

            if (id) res.json(mapUser(rows[0]));
            else res.json(rows.map(mapUser));
        } else {
            // General Table Logic (JSON Data)
            if (id) {
                const [rows] = await pool.execute<RowDataPacket[]>(`SELECT * FROM \`${table}\` WHERE id = ?`, [id]);
                if (rows.length > 0) {
                    const r = rows[0];
                    const item = { ...safeParse(r.data), ...r };
                    delete item.data;
                    res.json(item);
                }
                else res.status(404).json({ error: "Not Found" });
            } else {
                const [rows] = await pool.execute<RowDataPacket[]>(`SELECT * FROM \`${table}\` ORDER BY updated_at DESC`);
                res.json(rows.map(r => {
                    const item = { ...safeParse(r.data), ...r };
                    delete item.data;
                    return item;
                }));
            }
        }
    } catch (err: any) {
        res.status(500).json({ error: "Storage Error", details: err.message });
    }
};

// POST (Create or Update with Merge)
export const createOrUpdate = async (req: Request, res: Response) => {
    const table = req.params.table as string;
    if (!isValidTable(table)) return res.status(404).json({ error: "Not Found" });

    try {
        console.log(`[CRUD] POST to ${table}`);
        console.log(`[CRUD] Body keys:`, Object.keys(req.body));
        console.log(`[CRUD] Files count:`, req.files?.length || 0);

        let newItem: any = {};

        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
            console.log(`[CRUD] Raw data string (files):`, req.body.data?.substring(0, 100));
            newItem = safeParse(req.body.data || '{}');
            newItem.documents = newItem.documents || {};

            const uploadPromises = (req.files as Express.Multer.File[]).map(async (file) => {
                const docField = file.fieldname.replace('doc_', '');

                // Construct URL based on where the file was actually saved
                // file.path is absolute, we need relative to 'uploads' dir
                const relativePath = path.relative(path.join(process.cwd(), 'uploads'), file.path);
                // Ensure forward slashes for URL
                const urlPath = relativePath.split(path.sep).join('/');

                newItem.documents[docField] = `/api/uploads/${urlPath}`;
                console.log(`[Local Upload] Saved to: ${newItem.documents[docField]}`);
            });

            await Promise.all(uploadPromises);
        } else {
            // Handle Multipart (FormData) without files
            if (req.body.data && typeof req.body.data === 'string') {
                console.log(`[CRUD] Raw data string (no files):`, req.body.data.substring(0, 100));
                newItem = safeParse(req.body.data);
            } else {
                newItem = req.body;
            }
        }

        console.log(`[CRUD] Parsed newItem.id:`, newItem.id);

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

            // For users we accept password_hash only if we computed it new, else we keep existing
            // For users, "data" column is removed, so we only select columns.
            const selectQuery = (table === 'users')
                ? `SELECT * FROM \`${table}\` WHERE id = ? FOR UPDATE`
                : `SELECT data FROM \`${table}\` WHERE id = ? FOR UPDATE`;

            const [rows] = await conn.execute<RowDataPacket[]>(selectQuery, [newItem.id]);

            let finalData;
            if (rows.length > 0) {
                // UPDATE
                const dbRow = rows[0];
                let oldDocs: Record<string, string> = {};

                if (table === 'users') {
                    const dbUser = dbRow;
                    const existingUser: any = {
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

                    finalData = { ...existingUser, ...newItem };
                    oldDocs = existingUser.kycDocuments || {};
                    const newDocs = finalData.kycDocuments || {};

                    // Cleanup removed KYC documents (Non-blocking background task)
                    Object.values(oldDocs).forEach(async (url) => {
                        if (typeof url === 'string' && !Object.values(newDocs).includes(url)) {
                            deleteFileByUrl(url).catch(err => console.error(`[Background Cleanup] Failed:`, err.message));
                        }
                    });

                    const currentHash = passwordHash || dbUser.password_hash;

                    await conn.execute(
                        `UPDATE users SET 
                            email = ?, username = ?, mobile = ?, role = ?, status = ?, name = ?, 
                            kyc_status = ?, kyc_reason = ?, kyc_documents = ?, 
                            bank_name = ?, account_number = ?, ifsc_code = ?, account_holder = ?, 
                            lead_submission_enabled = ?, category = ?, 
                            password_hash = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?`,
                        [
                            finalData.email || null,
                            finalData.username || null,
                            finalData.mobile || finalData.phone || null,
                            finalData.role || 'partner',
                            finalData.status || 'pending',
                            finalData.name || null,
                            finalData.kycStatus || 'not_submitted',
                            finalData.kycReason || null,
                            finalData.kycDocuments ? JSON.stringify(finalData.kycDocuments) : null,
                            finalData.bankName || null,
                            finalData.accountNumber || null,
                            finalData.ifscCode || null,
                            finalData.accountHolder || null,
                            finalData.leadSubmissionEnabled || false,
                            finalData.category || null,
                            currentHash,
                            newItem.id
                        ]
                    );
                } else {
                    const existing = safeParse(dbRow.data);

                    // Cleanup replaced files: Find urls in old but not in new
                    const oldUrls = findAllUploadUrls(existing);
                    finalData = { ...existing, ...newItem };
                    const newUrls = findAllUploadUrls(finalData);

                    // Cleanup replaced files (Non-blocking background task)
                    oldUrls.forEach(async (url) => {
                        if (!newUrls.includes(url)) {
                            deleteFileByUrl(url).catch(err => console.error(`[Background Cleanup] Failed:`, err.message));
                        }
                    });

                    await conn.execute(
                        `UPDATE \`${table}\` SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [JSON.stringify(finalData), newItem.id]
                    );
                }
            } else {
                // INSERT
                finalData = newItem;
                if (table === 'users') {
                    await conn.execute(
                        `INSERT INTO users (
                            id, email, username, mobile, password_hash, role, status, name, 
                            kyc_status, kyc_reason, kyc_documents, 
                            bank_name, account_number, ifsc_code, account_holder, 
                            lead_submission_enabled, category
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            newItem.id,
                            finalData.email || null,
                            finalData.username || null,
                            finalData.mobile || finalData.phone || null,
                            passwordHash,
                            finalData.role || 'partner',
                            finalData.status || 'pending',
                            finalData.name || null,
                            finalData.kycStatus || 'not_submitted',
                            finalData.kycReason || null,
                            finalData.kycDocuments ? JSON.stringify(finalData.kycDocuments) : null,
                            finalData.bankName || null,
                            finalData.accountNumber || null,
                            finalData.ifscCode || null,
                            finalData.accountHolder || null,
                            finalData.leadSubmissionEnabled || false,
                            finalData.category || null
                        ]
                    );
                } else {
                    await conn.execute(
                        `INSERT INTO \`${table}\` (id, data) VALUES (?, ?)`,
                        [newItem.id, JSON.stringify(finalData)]
                    );
                }
            }

            await conn.commit();

            // Append compression logs if available
            if ((req as any).compressionLogs) {
                console.log(`[CRUD] Attaching compression logs to response:`, (req as any).compressionLogs);
                (finalData as any)._compressionLogs = (req as any).compressionLogs;
            } else {
                console.log(`[CRUD] No compression logs found in request.`);
            }

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
};

// DELETE
export const deleteItem = async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const { id } = req.params;
    if (!isValidTable(table)) return res.status(404).json({ error: "Not Found" });

    try {
        // Fetch before deletion to cleanup files
        const selectQuery = (table === 'users')
            ? `SELECT * FROM \`${table}\` WHERE id = ?`
            : `SELECT data FROM \`${table}\` WHERE id = ?`;
        const [rows] = await pool.execute<RowDataPacket[]>(selectQuery, [id]);

        if (rows.length > 0) {
            const row = rows[0];
            const dataToScan = (table === 'users') ? row : safeParse(row.data);
            const urls = findAllUploadUrls(dataToScan);
            // Non-blocking background cleanup
            urls.forEach(url => deleteFileByUrl(url).catch(err => console.error(`[Background Cleanup] Failed:`, err.message)));
        }

        await pool.execute(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);

        // Cascading Sync: If intelligence record is deleted, remove payout log too
        if (table === 'autofetch_records') {
            await pool.execute(`DELETE FROM \`admin_payout_records\` WHERE id = ?`, [id]);
        }

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: "Delete Error", details: err.message });
    }
};
