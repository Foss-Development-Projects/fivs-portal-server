import { describe, it, test, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app, getPool, initDb } from '../src/server';

describe('Generic CRUD API', () => {
    let token: string;
    let testUser = {
        id: 'crud_tester',
        name: 'CRUD Tester',
        email: 'crud@example.com',
        role: 'admin',
        status: 'approved'
    };

    let testRecord = {
        id: 'test_lead_999',
        customerName: 'Test Customer',
        leadType: 'motor'
    };

    beforeAll(async () => {
        await initDb();
        const p = getPool();
        // Clean up and create admin user for token
        await p.execute("DELETE FROM users WHERE id = ?", [testUser.id]);
        await p.execute(
            "INSERT INTO users (id, email, name, role, status, session_token, session_expiry) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [testUser.id, testUser.email, testUser.name, testUser.role, testUser.status, 'test_token_xyz', Math.floor(Date.now() / 1000) + 3600]
        );
        token = 'test_token_xyz';

    });

    afterAll(async () => {
        const p = getPool();
        await p.execute("DELETE FROM users WHERE id = ?", [testUser.id]);
        await p.execute("DELETE FROM leads WHERE id = ?", [testRecord.id]);
        await p.end();
    });

    test('GET /api/leads - Fetch all leads (authorized)', async () => {
        const response = await request(app)
            .get('/api/leads')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
    });

    test('POST /api/leads - Create a new lead', async () => {
        const response = await request(app)
            .post('/api/leads')
            .set('Authorization', `Bearer ${token}`)
            .send(testRecord);

        expect(response.status).toBe(200);
        expect(response.body.id).toBe(testRecord.id);
        expect(response.body.customerName).toBe(testRecord.customerName);
    });

    test('GET /api/leads/:id - Fetch single lead', async () => {
        const response = await request(app)
            .get(`/api/leads/${testRecord.id}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.id).toBe(testRecord.id);
    });

    test('DELETE /api/leads/:id - Delete a lead', async () => {
        const response = await request(app)
            .delete(`/api/leads/${testRecord.id}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    test('GET /api/leads/:id - Should return 404 after delete', async () => {
        const response = await request(app)
            .get(`/api/leads/${testRecord.id}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(404);
    });

    test('GET /api/invalid_table - Should return 404 for forbidden tables', async () => {
        const response = await request(app)
            .get('/api/invalid_table')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(404);
    });
});
