import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const logsDir = path.join(process.cwd(), 'logs');
const errorLogPath = path.join(logsDir, 'errors.log');
const activityLogPath = path.join(logsDir, 'activity.log');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const writeToFile = (filePath: string, level: string, msg: string, detail: any = '') => {
    const timestamp = new Date().toISOString();
    const detailStr = detail ? (typeof detail === 'object' ? JSON.stringify(detail) : String(detail)) : '';
    const logEntry = `[${timestamp}] [${level}] ${msg} ${detailStr}\n`;

    try {
        fs.appendFileSync(filePath, logEntry);
    } catch (err) {
        console.error('Failed to write to log file:', err);
    }
};

export const log = {
    info: (msg: string) => {
        console.log(chalk.blue(`[INFO] ${msg}`));
        writeToFile(activityLogPath, 'INFO', msg);
    },
    success: (msg: string) => {
        console.log(chalk.green(`[SUCCESS] ${msg}`));
        writeToFile(activityLogPath, 'SUCCESS', msg);
    },
    warn: (msg: string) => {
        console.log(chalk.yellow(`[WARN] ${msg}`));
        writeToFile(activityLogPath, 'WARN', msg);
    },
    error: (msg: string, detail: any = '') => {
        console.error(chalk.red(`[ERROR] ${msg}`), detail);
        writeToFile(errorLogPath, 'ERROR', msg, detail);
    },
    db: (msg: string) => {
        console.log(chalk.cyan(`[DB] ${msg}`));
        writeToFile(activityLogPath, 'DB', msg);
    }
};
