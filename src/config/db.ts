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
                await pool.execute(`
                    CREATE TABLE IF NOT EXISTS \`users\` (
                        id VARCHAR(128) PRIMARY KEY,
                        data JSON NOT NULL,
                        password_hash VARCHAR(255) DEFAULT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                `);

                const [cols] = await pool.execute<RowDataPacket[]>("SHOW COLUMNS FROM `users` LIKE 'password_hash'");
                if (cols.length === 0) {
                    log.info('Adding password_hash column to users table...');
                    await pool.execute("ALTER TABLE `users` ADD COLUMN password_hash VARCHAR(255) DEFAULT NULL AFTER data");
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

        // --- PASSWORD MIGRATION ---
        const [usersToMigrate] = await pool.execute<RowDataPacket[]>("SELECT id, data FROM users WHERE password_hash IS NULL");
        if (usersToMigrate.length > 0) {
            log.info(`Found ${usersToMigrate.length} users to migrate to hashed passwords.`);
            for (const row of usersToMigrate) {
                try {
                    const user = JSON.parse(row.data);
                    if (user.password) {
                        const hash = await bcrypt.hash(user.password, 10);
                        delete user.password;
                        await pool.execute(
                            "UPDATE users SET data = ?, password_hash = ? WHERE id = ?",
                            [JSON.stringify(user), hash, row.id]
                        );
                    }
                } catch (e: any) {
                    log.error(`Failed to migrate user ${row.id}:`, e.message);
                }
            }
            log.success('Password migration completed.');
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
