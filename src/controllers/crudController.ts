import { Request, Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/db.js';
import bcrypt from 'bcryptjs';

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
            if (!newItem.documents) newItem.documents = {};

            (req.files as Express.Multer.File[]).forEach(file => {
                const docField = file.fieldname.replace('doc_', '');
                newItem.documents[docField] = `/api/uploads/${file.filename}`;
            });
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
                if (table === 'users') {
                    // Merge existing columns with newItem
                    const dbUser = rows[0];
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
                    const existing = safeParse(rows[0].data);
                    finalData = { ...existing, ...newItem };
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
