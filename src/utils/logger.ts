import chalk from 'chalk';

export const log = {
    info: (msg: string) => console.log(chalk.blue(`[INFO] ${msg}`)),
    success: (msg: string) => console.log(chalk.green(`[SUCCESS] ${msg}`)),
    warn: (msg: string) => console.log(chalk.yellow(`[WARN] ${msg}`)),
    error: (msg: string, detail: any = '') => console.error(chalk.red(`[ERROR] ${msg}`), detail),
    db: (msg: string) => console.log(chalk.cyan(`[DB] ${msg}`))
};
