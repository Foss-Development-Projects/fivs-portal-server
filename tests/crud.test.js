const request = require('supertest');
const { app, pool, initDb } = require('../index');

describe('Generic CRUD API', () => {
    let token;
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
        const p = pool();
        // Clean up and create admin user for token
        await p.execute("DELETE FROM users WHERE id = ?", [testUser.id]);
        await p.execute("INSERT INTO users (id, data) VALUES (?, ?)", [testUser.id, JSON.stringify(testUser)]);

        // Login to get token
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: testUser.email, password: 'password123' }); // Note: login logic handles plain text if hash missing

        // Wait, I need to make sure the login works. 
        // In index.js, if hash is missing, it compares plain text.
        // But for fresh insert, I should probably set session_token manually or use the login if it works.
        // Let's just set the session token manually for simplicity in beforeAll
        const testToken = 'test_token_xyz';
        await p.execute("UPDATE users SET data = JSON_SET(data, '$.session_token', ?, '$.session_expiry', ?) WHERE id = ?",
            [testToken, Math.floor(Date.now() / 1000) + 3600, testUser.id]);
        token = testToken;
    });

    afterAll(async () => {
        const p = pool();
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
