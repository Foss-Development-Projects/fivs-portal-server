import { describe, it, test, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app, getPool, initDb } from '../src/server';
import bcrypt from 'bcryptjs';

describe('Authentication API', () => {
    let testUser = {
        id: 'test_user_123',
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        role: 'partner',
        status: 'approved'
    };

    beforeAll(async () => {
        // Ensure DB is initialized
        await initDb();
        const p = getPool();
        // Clean up any existing test user
        await p.execute("DELETE FROM users WHERE id = ?", [testUser.id]);
        await p.execute("DELETE FROM users WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.email')) = ?", [testUser.email]);
    });

    afterAll(async () => {
        // Clean up
        const p = getPool();
        await p.execute("DELETE FROM users WHERE id = ?", [testUser.id]);
        await p.end();
    });

    test('POST /api/auth/register - Successfully register a new user', async () => {
        const response = await request(app)
            .post('/api/auth/register')
            .send(testUser);

        expect(response.status).toBe(200);
        expect(response.body.email).toBe(testUser.email);
        expect(response.body.id).toBe(testUser.id);
    });

    test('POST /api/auth/register - Fail if user already exists', async () => {
        const response = await request(app)
            .post('/api/auth/register')
            .send(testUser);

        expect(response.status).toBe(409);
        expect(response.body.error).toBe("Email already exists");
    });

    test('POST /api/auth/login - Successfully login', async () => {
        const response = await request(app)
            .post('/api/auth/login')
            .send({
                email: testUser.email,
                password: testUser.password
            });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('token');
        expect(response.body.user.email).toBe(testUser.email);
    });

    test('POST /api/auth/login - Fail with invalid password', async () => {
        const response = await request(app)
            .post('/api/auth/login')
            .send({
                email: testUser.email,
                password: 'wrongpassword'
            });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe("Invalid Credentials");
    });

    test('GET /api/auth/status - Check auth status with token', async () => {
        // First login to get token
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({
                email: testUser.email,
                password: testUser.password
            });

        const token = loginRes.body.token;

        const response = await request(app)
            .get('/api/auth/status')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("active");
    });
});
