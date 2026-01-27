import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Request, Response } from 'express';

// 1. Mock modules
jest.unstable_mockModule('../../src/config/db.js', () => ({
    pool: {
        execute: jest.fn(),
        getConnection: jest.fn(),
    },
    isDbReady: true,
    dbError: null,
}));

// 2. Dynamic imports
const { pool } = await import('../../src/config/db.js');
const { getList, getSingle, createOrUpdate, deleteItem } = await import('../../src/controllers/crudController.js');

describe('CRUD Controller', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        jsonMock = jest.fn() as any;
        statusMock = jest.fn().mockReturnValue({ json: jsonMock }) as any;
        req = {
            params: {},
            body: {}
        };
        res = {
            status: (statusMock as any),
            json: (jsonMock as any)
        } as Response;
    });

    describe('getList', () => {
        it('should handle users table specifically', async () => {
            req.params = { table: 'users' };
            (pool.execute as any).mockResolvedValueOnce([[{ id: '1', email: 'test@test.com', updated_at: new Date() }]]);

            await getList(req as Request, res as Response);

            expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM `users` ORDER BY updated_at DESC'));
            expect(jsonMock).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ email: 'test@test.com' })]));
        });

        it('should handle generic tables and parse JSON fields', async () => {
            req.params = { table: 'leads' };
            const rawData = [{ data: JSON.stringify({ key: 'val' }) }];
            (pool.execute as any).mockResolvedValueOnce([rawData]);

            await getList(req as Request, res as Response);

            expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('SELECT data FROM `leads`'));
            expect(jsonMock).toHaveBeenCalledWith([{ key: 'val' }]);
        });
    });

    describe('getSingle', () => {
        it('should return 404 if item not found', async () => {
            req.params = { table: 'users', id: '999' };
            (pool.execute as any).mockResolvedValueOnce([[]]);

            await getSingle(req as Request, res as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
        });

        it('should return single item if found', async () => {
            req.params = { table: 'users', id: '1' };
            (pool.execute as any).mockResolvedValueOnce([[{ id: '1', email: 'test@test.com' }]]);

            await getSingle(req as Request, res as Response);

            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@test.com' }));
        });
    });

    describe('createOrUpdate', () => {
        it('should handle update if id is provided', async () => {
            req.params = { table: 'leads' };
            req.body = { id: '1', name: 'Updated' };

            const executeMock = jest.fn() as any;
            executeMock.mockResolvedValueOnce([[{ data: JSON.stringify({ id: '1', name: 'Old' }) }]]); // Select for update
            executeMock.mockResolvedValueOnce([{}]); // Update

            const mockConn = {
                beginTransaction: jest.fn() as any,
                execute: executeMock,
                commit: jest.fn() as any,
                rollback: jest.fn() as any,
                release: jest.fn() as any,
            };
            (pool.getConnection as any).mockResolvedValueOnce(mockConn);

            await createOrUpdate(req as Request, res as Response);

            expect(mockConn.beginTransaction).toHaveBeenCalled();
            expect(mockConn.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE `leads` SET data = ?'), expect.any(Array));
            expect(mockConn.commit).toHaveBeenCalled();
            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated' }));
        });
    });

    describe('deleteItem', () => {
        it('should delete item', async () => {
            req.params = { table: 'users', id: '1' };
            (pool.execute as any).mockResolvedValueOnce([{}]);

            await deleteItem(req as Request, res as Response);

            expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM `users` WHERE id = ?'), ['1']);
            expect(jsonMock).toHaveBeenCalledWith({ success: true });
        });
    });
});
