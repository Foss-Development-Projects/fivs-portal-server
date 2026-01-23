require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const chalk = require('chalk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const port = process.env.PORT || 8080;

// Helper for colored logging
const log = {
    info: (msg) => console.log(chalk.blue(`[INFO] ${msg}`)),
    success: (msg) => console.log(chalk.green(`[SUCCESS] ${msg}`)),
    warn: (msg) => console.log(chalk.yellow(`[WARN] ${msg}`)),
    error: (msg, detail = '') => console.error(chalk.red(`[ERROR] ${msg}`), detail),
    db: (msg) => console.log(chalk.cyan(`[DB] ${msg}`))
};

// Database Configuration
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

let pool;
let isDbReady = false;
let dbError = null;

// Initialize Database
async function initDb() {
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
            // Enhanced schema for users to support password hashing
            if (table === 'users') {
                await pool.execute(`
                    CREATE TABLE IF NOT EXISTS \`users\` (
                        id VARCHAR(128) PRIMARY KEY,
                        data JSON NOT NULL,
                        password_hash VARCHAR(255) DEFAULT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                `);

                // Ensure password_hash column exists if table was already there
                const [cols] = await pool.execute("SHOW COLUMNS FROM `users` LIKE 'password_hash'");
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
        // Migrate existing plain-text passwords from JSON data to password_hash column
        const [usersToMigrate] = await pool.execute("SELECT id, data FROM users WHERE password_hash IS NULL");
        if (usersToMigrate.length > 0) {
            log.info(`Found ${usersToMigrate.length} users to migrate to hashed passwords.`);
            for (const row of usersToMigrate) {
                try {
                    const user = JSON.parse(row.data);
                    if (user.password) {
                        const hash = await bcrypt.hash(user.password, 10);
                        // Store hash and REMOVE plain text password from JSON
                        delete user.password;
                        await pool.execute(
                            "UPDATE users SET data = ?, password_hash = ? WHERE id = ?",
                            [JSON.stringify(user), hash, row.id]
                        );
                    }
                } catch (e) {
                    log.error(`Failed to migrate user ${row.id}:`, e.message);
                }
            }
            log.success('Password migration completed.');
        }

        isDbReady = true;
        dbError = null;
        log.success('All tables verified and ready.');
    } catch (err) {
        dbError = err.message;
        log.error('Database Initialization Failed:', err.message);
        setTimeout(initDb, 5000);
    }
}

// Multer Config for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Store uploads in server/uploads
        const dir = path.join(__dirname, 'uploads');
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

// Static Files - Serve uploads
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// DB Guard Middleware
const dbGuard = (req, res, next) => {
    if (!isDbReady) {
        return res.status(503).json({ error: "Database initializing", message: dbError || "Connecting..." });
    }
    next();
};

// --- AUTH ROUTES ---

// Login
app.post('/api/auth/login', dbGuard, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email/Password required" });

    try {
        const [rows] = await pool.execute(
            "SELECT * FROM users WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.email')) = ?",
            [email]
        );

        if (rows.length > 0) {
            const dbUserRecord = rows[0];
            const user = JSON.parse(dbUserRecord.data);
            const hash = dbUserRecord.password_hash;

            const isMatch = hash ? await bcrypt.compare(password, hash) : (user.password === password);

            if (isMatch) {
                // If matched via plain-text (old style), migrate immediately
                if (!hash) {
                    const newHash = await bcrypt.hash(password, 10);
                    delete user.password;
                    await pool.execute(
                        "UPDATE users SET data = ?, password_hash = ? WHERE id = ?",
                        [JSON.stringify(user), newHash, user.id]
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
                    "UPDATE users SET data = ? WHERE id = ?",
                    [JSON.stringify(user), user.id]
                );

                delete user.password;
                res.json({ token, user });
            } else {
                res.status(401).json({ error: "Invalid Credentials" });
            }
        } else {
            res.status(401).json({ error: "User Not Found" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Register
app.post('/api/auth/register', dbGuard, async (req, res) => {
    const newUser = req.body;
    if (!newUser || !newUser.email) return res.status(400).json({ error: "Invalid Data" });

    try {
        const [rows] = await pool.execute(
            "SELECT id FROM users WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.email')) = ?",
            [newUser.email]
        );

        if (rows.length > 0) {
            return res.status(409).json({ error: "Email already exists" });
        }

        const passwordHash = await bcrypt.hash(newUser.password, 10);
        delete newUser.password;

        await pool.execute(
            "INSERT INTO users (id, data, password_hash) VALUES (?, ?, ?)",
            [newUser.id, JSON.stringify(newUser), passwordHash]
        );
        res.json(newUser);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Auth Middleware for Protected Routes
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const xAuthToken = req.headers['x-auth-token'] || '';
    let token = '';

    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else {
        token = xAuthToken;
    }

    if (!token) return res.status(401).json({ error: "Unauthorized: Missing Token" });

    try {
        const [rows] = await pool.execute(
            "SELECT * FROM users WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.session_token')) = ?",
            [token]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: "Unauthorized: Invalid or Expired Token" });
        }

        const userData = JSON.parse(rows[0].data);
        const now = Math.floor(Date.now() / 1000);

        if (userData.session_expiry && userData.session_expiry < now) {
            return res.status(401).json({ error: "Session Expired" });
        }

        // Sliding window refresh
        const role = (userData.role || 'partner').toLowerCase();
        const timeoutSeconds = (role === 'admin') ? 3600 : 600;
        const newExpiry = now + timeoutSeconds;

        await pool.execute(
            "UPDATE users SET data = JSON_SET(data, '$.session_expiry', ?) WHERE id = ?",
            [newExpiry, userData.id]
        );

        req.user = userData;
        req.user.session_expiry = newExpiry;
        next();
    } catch (err) {
        res.status(500).json({ error: "Auth Error" });
    }
};

// Auth Status (Heartbeat)
app.get('/api/auth/status', authMiddleware, (req, res) => {
    res.json({
        status: "active",
        expiry: req.user.session_expiry,
        server_time: Math.floor(Date.now() / 1000)
    });
});

// --- GENERIC CRUD ROUTES ---

const allowedTables = [
    'users', 'leads', 'transactions', 'tickets', 'banners',
    'notifications', 'autofetch_records', 'admin_payout_records',
    'payout_reports', 'profit_reports'
];

// GET List
app.get('/api/:table', authMiddleware, async (req, res) => {
    const { table } = req.params;
    if (!allowedTables.includes(table)) return res.status(404).json({ error: "Not Found" });

    try {
        const [rows] = await pool.execute(`SELECT data FROM \`${table}\` ORDER BY updated_at DESC`);
        res.json(rows.map(r => JSON.parse(r.data)));
    } catch (err) {
        res.status(500).json({ error: "Storage Error", details: err.message });
    }
});

// GET Single
app.get('/api/:table/:id', authMiddleware, async (req, res) => {
    const { table, id } = req.params;
    if (!allowedTables.includes(table)) return res.status(404).json({ error: "Not Found" });

    try {
        if (id) {
            const [rows] = await pool.execute(`SELECT data FROM \`${table}\` WHERE id = ?`, [id]);
            if (rows.length > 0) res.json(JSON.parse(rows[0].data));
            else res.status(404).json({ error: "Not Found" });
        } else {
            const [rows] = await pool.execute(`SELECT data FROM \`${table}\` ORDER BY updated_at DESC`);
            res.json(rows.map(r => JSON.parse(r.data)));
        }
    } catch (err) {
        res.status(500).json({ error: "Storage Error", details: err.message });
    }
});

// POST (Create or Update with Merge)
app.post('/api/:table', authMiddleware, upload.any(), async (req, res) => {
    const { table } = req.params;
    if (!allowedTables.includes(table)) return res.status(404).json({ error: "Not Found" });

    try {
        let newItem = {};

        // Handle Multipart
        if (req.files && req.files.length > 0) {
            newItem = JSON.parse(req.body.data || '{}');
            if (!newItem.documents) newItem.documents = {};

            req.files.forEach(file => {
                // Construct public URL
                const docField = file.fieldname.replace('doc_', '');
                newItem.documents[docField] = `/api/uploads/${file.filename}`;
            });
        } else {
            newItem = req.body;
        }

        if (!newItem.id) return res.status(400).json({ error: "Missing Record ID" });

        // Password Hashing for Users
        let passwordHash = null;
        if (table === 'users' && newItem.password) {
            passwordHash = await bcrypt.hash(newItem.password, 10);
            delete newItem.password;
        }

        // Transaction for Merge
        const conn = await pool.getConnection();
        await conn.beginTransaction();

        try {
            const [rows] = await conn.execute(`SELECT data, password_hash FROM \`${table}\` WHERE id = ? FOR UPDATE`, [newItem.id]);

            let finalData;
            if (rows.length > 0) {
                const existing = JSON.parse(rows[0].data);
                finalData = { ...existing, ...newItem };
                const currentHash = passwordHash || rows[0].password_hash;

                await conn.execute(
                    `UPDATE \`${table}\` SET data = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [JSON.stringify(finalData), currentHash, newItem.id]
                );
            } else {
                finalData = newItem;
                await conn.execute(
                    `INSERT INTO \`${table}\` (id, data, password_hash) VALUES (?, ?, ?)`,
                    [newItem.id, JSON.stringify(finalData), passwordHash]
                );
            }

            await conn.commit();
            res.json(finalData);
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } catch (err) {
        res.status(500).json({ error: "Storage Error", details: err.message });
    }
});

// DELETE
app.delete('/api/:table/:id', authMiddleware, async (req, res) => {
    const { table, id } = req.params;
    if (!allowedTables.includes(table)) return res.status(404).json({ error: "Not Found" });

    try {
        await pool.execute(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Delete Error", details: err.message });
    }
});

// Serve Frontend (Vite Build)
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get(/(.*)/, (req, res) => {
    // If it's an API route that didn't match, don't serve index.html
    if (req.path.startsWith('/api')) return res.status(404).json({ error: "API Route Not Found" });
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

// Start Server
app.listen(port, () => {
    log.success(`NodeJS Backend running on port ${port}`);
    initDb();
});
