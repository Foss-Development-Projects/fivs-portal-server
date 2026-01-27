import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Request, Response } from 'express';

// 1. Mock modules BEFORE importing them
jest.unstable_mockModule('../../src/config/db.js', () => ({
    pool: {
        execute: jest.fn(),
        getConnection: jest.fn(),
    },
    isDbReady: true,
    dbError: null,
}));

jest.unstable_mockModule('bcryptjs', () => ({
    default: {
        compare: jest.fn(),
        hash: jest.fn(),
    }
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
    log: {
        error: jest.fn(),
    }
}));

// 2. Import everything else AFTER mocks
const { pool } = await import('../../src/config/db.js');
const { default: bcrypt } = await import('bcryptjs');
const { login, register } = await import('../../src/controllers/authController.js');

describe('Auth Controller', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        jsonMock = jest.fn() as any;
        statusMock = jest.fn().mockReturnValue({ json: jsonMock }) as any;
        req = {
            body: {}
        };
        res = {
            status: (statusMock as any),
            json: (jsonMock as any)
        } as Response;
    });

    describe('login', () => {
        it('should return 400 if email or password is missing', async () => {
            req.body = { email: 'test@example.com' };
            await login(req as Request, res as Response);
            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith({ error: "Email/Password required" });
        });

        it('should return 401 if user not found', async () => {
            req.body = { email: 'test@example.com', password: 'password' };
            (pool.execute as any).mockResolvedValueOnce([[]]);

            await login(req as Request, res as Response);
            expect(statusMock).toHaveBeenCalledWith(401);
            expect(jsonMock).toHaveBeenCalledWith({ error: "User Not Found" });
        });

        it('should return 401 if password does not match', async () => {
            req.body = { email: 'test@example.com', password: 'password' };
            const mockUser = {
                id: '123',
                email: 'test@example.com',
                password_hash: 'hashedpassword',
                role: 'partner',
                status: 'active'
            };
            (pool.execute as any).mockResolvedValueOnce([[mockUser]]);
            (bcrypt.compare as any).mockResolvedValueOnce(false);

            await login(req as Request, res as Response);
            expect(statusMock).toHaveBeenCalledWith(401);
            expect(jsonMock).toHaveBeenCalledWith({ error: "Invalid Credentials" });
        });

        it('should return 403 if account is suspended', async () => {
            req.body = { email: 'test@example.com', password: 'password' };
            const mockUser = {
                id: '123',
                email: 'test@example.com',
                password_hash: 'hashedpassword',
                role: 'partner',
                status: 'suspended'
            };
            (pool.execute as any).mockResolvedValueOnce([[mockUser]]);
            (bcrypt.compare as any).mockResolvedValueOnce(true);

            await login(req as Request, res as Response);
            expect(statusMock).toHaveBeenCalledWith(403);
            expect(jsonMock).toHaveBeenCalledWith({ error: "Account Suspended. Contact Support." });
        });

        it('should return 403 if partner account is pending', async () => {
            req.body = { email: 'test@example.com', password: 'password' };
            const mockUser = {
                id: '123',
                email: 'test@example.com',
                password_hash: 'hashedpassword',
                role: 'partner',
                status: 'pending'
            };
            (pool.execute as any).mockResolvedValueOnce([[mockUser]]);
            (bcrypt.compare as any).mockResolvedValueOnce(true);

            await login(req as Request, res as Response);
            expect(statusMock).toHaveBeenCalledWith(403);
            expect(jsonMock).toHaveBeenCalledWith({ error: "Your account is waiting for Admin approval." });
        });

        it('should return token and user logic on success', async () => {
            req.body = { email: 'test@example.com', password: 'password' };
            const mockUser = {
                id: '123',
                email: 'test@example.com',
                password_hash: 'hashedpassword',
                role: 'partner',
                status: 'active',
                name: 'Test User'
            };
            (pool.execute as any).mockResolvedValueOnce([[mockUser]]);
            (bcrypt.compare as any).mockResolvedValueOnce(true);
            (pool.execute as any).mockResolvedValueOnce([{}]);

            await login(req as Request, res as Response);
            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
                token: expect.any(String),
                user: expect.objectContaining({ email: 'test@example.com' })
            }));
            expect(pool.execute).toHaveBeenCalledTimes(2);
        });
    });

    describe('register', () => {
        it('should return 400 if invalid data', async () => {
            req.body = {};
            await register(req as Request, res as Response);
            expect(statusMock).toHaveBeenCalledWith(400);
        });

        it('should return 409 if email already exists', async () => {
            req.body = { email: 'test@example.com', password: 'password' };
            (pool.execute as any).mockResolvedValueOnce([[{ id: '123' }]]);

            await register(req as Request, res as Response);
            expect(statusMock).toHaveBeenCalledWith(409);
            expect(jsonMock).toHaveBeenCalledWith({ error: "Email already exists" });
        });

        it('should create user and return user data on success', async () => {
            req.body = {
                id: 'newParams',
                email: 'new@example.com',
                password: 'password',
                name: 'New User'
            };
            (pool.execute as any).mockResolvedValueOnce([[]]);
            (bcrypt.hash as any).mockResolvedValueOnce('hashedpassword');
            (pool.execute as any).mockResolvedValueOnce([{}]);

            await register(req as Request, res as Response);

            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
                email: 'new@example.com',
                name: 'New User'
            }));
            expect(jsonMock.mock.calls[0][0]).not.toHaveProperty('password');
            expect(pool.execute).toHaveBeenCalledTimes(2);
        });
    });
});
