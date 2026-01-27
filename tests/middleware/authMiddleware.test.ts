import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';

// 1. Mock modules
jest.unstable_mockModule('../../src/config/db.js', () => ({
    pool: {
        execute: jest.fn(),
    },
    isDbReady: true,
    dbError: null,
}));

// 2. Dynamic imports
const { pool } = await import('../../src/config/db.js');
const { dbGuard, authMiddleware } = await import('../../src/middleware/authMiddleware.js');

describe('Auth Middleware', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: NextFunction;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        jsonMock = jest.fn() as any;
        statusMock = jest.fn().mockReturnValue({ json: jsonMock }) as any;
        next = jest.fn();
        req = {
            headers: {}
        };
        res = {
            status: (statusMock as any),
            json: (jsonMock as any)
        } as Response;
    });

    describe('dbGuard', () => {
        it('should call next if db is ready', async () => {
            await dbGuard(req as Request, res as Response, next);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('authMiddleware', () => {
        it('should return 401 if no token provided', async () => {
            await authMiddleware(req as Request, res as Response, next);
            expect(statusMock).toHaveBeenCalledWith(401);
            expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized: Missing Token" });
        });

        it('should return 401 if session not found', async () => {
            req.headers = { authorization: 'Bearer token' };
            (pool.execute as any).mockResolvedValueOnce([[]]);

            await authMiddleware(req as Request, res as Response, next);
            expect(statusMock).toHaveBeenCalledWith(401);
            expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized: Invalid or Expired Token" });
        });

        it('should return 401 if session expired', async () => {
            req.headers = { authorization: 'Bearer token' };
            (pool.execute as any).mockResolvedValueOnce([[{
                id: '123',
                session_token: 'token',
                session_expiry: Math.floor(Date.now() / 1000) - 1000
            }]]);

            await authMiddleware(req as Request, res as Response, next);
            expect(statusMock).toHaveBeenCalledWith(401);
            expect(jsonMock).toHaveBeenCalledWith({ error: "Session Expired" });
        });

        it('should attach user and call next if session valid', async () => {
            req.headers = { authorization: 'Bearer token' };
            (pool.execute as any).mockResolvedValueOnce([[{
                id: '123',
                role: 'admin',
                session_token: 'token',
                session_expiry: Math.floor(Date.now() / 1000) + 10000
            }]]);
            (pool.execute as any).mockResolvedValueOnce([{}]); // Sliding window update

            await authMiddleware(req as Request, res as Response, next);
            expect(req).toHaveProperty('user');
            expect((req as any).user.id).toBe('123');
            expect(next).toHaveBeenCalled();
        });
    });
});
