import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { log } from '../utils/logger.js';

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST || 'localhost',
    socketPath: process.env.INSTANCE_CONNECTION_NAME ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : undefined,
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    connectTimeout: 20000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
};

export let pool: Pool;
export let isDbReady = false;
export let dbError: string | null = null;

export const getPool = () => pool;

export async function initDb() {
    try {
        log.db('Connecting...');
        pool = mysql.createPool(dbConfig);
        const conn = await pool.getConnection();
        log.success('Connected to Database.');
        conn.release();

        const collections = [
            'users', 'leads', 'transactions', 'tickets', 'banners',
            'notifications', 'autofetch_records', 'admin_payout_records',
            'payout_reports', 'profit_reports'
        ];

        for (const table of collections) {
            if (table === 'users') {
                // Create table with specific columns if it doesn't exist
                await pool.execute(`
                    CREATE TABLE IF NOT EXISTS \`users\` (
                        id VARCHAR(128) PRIMARY KEY,
                        email VARCHAR(255) DEFAULT NULL,
                        username VARCHAR(255) DEFAULT NULL,
                        mobile VARCHAR(50) DEFAULT NULL,
                        password_hash VARCHAR(255) DEFAULT NULL,
                        role VARCHAR(50) DEFAULT 'partner',
                        status VARCHAR(50) DEFAULT 'pending',
                        name VARCHAR(255) DEFAULT NULL,
                        
                        kyc_status VARCHAR(50) DEFAULT 'not_submitted',
                        kyc_reason TEXT DEFAULT NULL,
                        kyc_documents JSON DEFAULT NULL,
                        
                        bank_name VARCHAR(255) DEFAULT NULL,
                        account_number VARCHAR(100) DEFAULT NULL,
                        ifsc_code VARCHAR(50) DEFAULT NULL,
                        account_holder VARCHAR(255) DEFAULT NULL,
                        
                        lead_submission_enabled BOOLEAN DEFAULT FALSE,
                        category VARCHAR(100) DEFAULT NULL,
                        
                        session_token VARCHAR(255) DEFAULT NULL,
                        session_expiry BIGINT DEFAULT NULL,
                        
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY unique_email (email)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                `);

                // Add columns to existing table if they don't exist
                const [cols] = await pool.execute<RowDataPacket[]>("SHOW COLUMNS FROM `users`");
                const colNames = cols.map((c: any) => c.Field);

                // Core Identifiers
                if (!colNames.includes('email')) await pool.execute("ALTER TABLE `users` ADD COLUMN email VARCHAR(255) DEFAULT NULL AFTER id");
                if (!colNames.includes('username')) await pool.execute("ALTER TABLE `users` ADD COLUMN username VARCHAR(255) DEFAULT NULL AFTER email");
                if (!colNames.includes('mobile')) await pool.execute("ALTER TABLE `users` ADD COLUMN mobile VARCHAR(50) DEFAULT NULL AFTER username");
                if (!colNames.includes('password_hash')) await pool.execute("ALTER TABLE `users` ADD COLUMN password_hash VARCHAR(255) DEFAULT NULL AFTER mobile");

                // Profile
                if (!colNames.includes('role')) await pool.execute("ALTER TABLE `users` ADD COLUMN role VARCHAR(50) DEFAULT 'partner' AFTER password_hash");
                if (!colNames.includes('status')) await pool.execute("ALTER TABLE `users` ADD COLUMN status VARCHAR(50) DEFAULT 'pending' AFTER role");
                if (!colNames.includes('name')) await pool.execute("ALTER TABLE `users` ADD COLUMN name VARCHAR(255) DEFAULT NULL AFTER status");

                // KYC
                if (!colNames.includes('kyc_status')) await pool.execute("ALTER TABLE `users` ADD COLUMN kyc_status VARCHAR(50) DEFAULT 'not_submitted' AFTER name");
                if (!colNames.includes('kyc_reason')) await pool.execute("ALTER TABLE `users` ADD COLUMN kyc_reason TEXT DEFAULT NULL AFTER kyc_status");
                if (!colNames.includes('kyc_documents')) await pool.execute("ALTER TABLE `users` ADD COLUMN kyc_documents JSON DEFAULT NULL AFTER kyc_reason");

                // Bank
                if (!colNames.includes('bank_name')) await pool.execute("ALTER TABLE `users` ADD COLUMN bank_name VARCHAR(255) DEFAULT NULL AFTER kyc_documents");
                if (!colNames.includes('account_number')) await pool.execute("ALTER TABLE `users` ADD COLUMN account_number VARCHAR(100) DEFAULT NULL AFTER bank_name");
                if (!colNames.includes('ifsc_code')) await pool.execute("ALTER TABLE `users` ADD COLUMN ifsc_code VARCHAR(50) DEFAULT NULL AFTER account_number");
                if (!colNames.includes('account_holder')) await pool.execute("ALTER TABLE `users` ADD COLUMN account_holder VARCHAR(255) DEFAULT NULL AFTER ifsc_code");

                // Config
                if (!colNames.includes('lead_submission_enabled')) await pool.execute("ALTER TABLE `users` ADD COLUMN lead_submission_enabled BOOLEAN DEFAULT FALSE AFTER account_holder");
                if (!colNames.includes('category')) await pool.execute("ALTER TABLE `users` ADD COLUMN category VARCHAR(100) DEFAULT NULL AFTER lead_submission_enabled");

                // Session
                if (!colNames.includes('session_token')) await pool.execute("ALTER TABLE `users` ADD COLUMN session_token VARCHAR(255) DEFAULT NULL AFTER category");
                if (!colNames.includes('session_expiry')) await pool.execute("ALTER TABLE `users` ADD COLUMN session_expiry BIGINT DEFAULT NULL AFTER session_token");

                try {
                    await pool.execute("ALTER TABLE `users` ADD UNIQUE INDEX unique_email (email)");
                } catch (e: any) {
                    // Ignore if duplicate key name
                }

            } else {
                await pool.execute(`
                    CREATE TABLE IF NOT EXISTS \`${table}\` (
                        id VARCHAR(128) PRIMARY KEY,
                        data JSON NOT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                `);
            }
        }

        // --- MIGRATION: Extact Data to Columns ---
        // We only migrate if 'data' column exists. If it doesn't, migration is done.
        try {
            const [dataCol] = await pool.execute<RowDataPacket[]>("SHOW COLUMNS FROM `users` LIKE 'data'");
            if (dataCol.length > 0) {
                const [usersToMigrate] = await pool.execute<RowDataPacket[]>("SELECT id, data, password_hash FROM users");
                if (usersToMigrate.length > 0) {
                    for (const row of usersToMigrate) {
                        try {
                            const user = JSON.parse(row.data);
                            const updates: any[] = [];
                            let sql = "UPDATE users SET ";

                            const appendUpdate = (col: string, val: any) => {
                                sql += `${col} = ?, `;
                                updates.push(val);
                            };

                            appendUpdate('email', user.email);
                            appendUpdate('username', user.username);
                            appendUpdate('mobile', user.mobile || user.phone); // Handle mapping

                            appendUpdate('role', user.role);
                            appendUpdate('status', user.status);
                            appendUpdate('name', user.name);

                            appendUpdate('kyc_status', user.kycStatus || 'not_submitted');
                            appendUpdate('kyc_reason', user.kycReason);
                            appendUpdate('kyc_documents', user.kycDocuments ? JSON.stringify(user.kycDocuments) : null);

                            appendUpdate('bank_name', user.bankName);
                            appendUpdate('account_number', user.accountNumber);
                            appendUpdate('ifsc_code', user.ifscCode);
                            appendUpdate('account_holder', user.accountHolder);

                            appendUpdate('lead_submission_enabled', user.leadSubmissionEnabled || false);
                            appendUpdate('category', user.category);

                            appendUpdate('session_token', user.session_token);
                            appendUpdate('session_expiry', user.session_expiry);

                            if (user.password && !row.password_hash) {
                                const hash = await bcrypt.hash(user.password, 10);
                                appendUpdate('password_hash', hash);
                            }

                            // Remove trailing comma and space
                            sql = sql.slice(0, -2);
                            sql += " WHERE id = ?";
                            updates.push(row.id);

                            await pool.execute(sql, updates);
                        } catch (e: any) {
                            log.error(`Failed to migrate user ${row.id}:`, e.message);
                        }
                    }
                    log.success('User schema migration completed.');

                    // DROP JSON COLUMN
                    log.info('Dropping legacy data column from users table...');
                    try {
                        await pool.execute("ALTER TABLE `users` DROP COLUMN `data`");
                    } catch (e: any) {
                        log.error("Failed to drop data column (might already be dropped): " + e.message);
                    }
                }
            }
        } catch (e) {
            // data column missing or error, ignore
        }

        isDbReady = true;
        dbError = null;
        log.success('All tables verified and ready.');
    } catch (err: any) {
        dbError = err.message;
        log.error('Database Initialization Failed:', err.message);
        setTimeout(initDb, 5000);
    }
}
