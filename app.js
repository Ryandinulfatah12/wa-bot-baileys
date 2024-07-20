const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.static(__dirname + '/public'));
app.use(cors()); // Enable CORS

const connectedDevices = {};

io.on('connection', (socket) => {
    const uuid = socket.handshake.query.uuid;
    const projectId = socket.handshake.query.projectId;

    if (uuid || projectId) {
        if (!connectedDevices[projectId]) {
            connectedDevices[projectId] = { socket, connected: false, uuid, projectId, qrCodeDataURL: null };
            connectionLogicMultiDevice(projectId);
        } else {
            if (connectedDevices[projectId].connected) {
                socket.emit('message', 'Connected');
            } else if (connectedDevices[projectId].qrCodeDataURL) {
                socket.emit('qrCode', connectedDevices[projectId].qrCodeDataURL);
                socket.emit('message', 'Waiting to connect');
            }
            connectedDevices[projectId].socket = socket; // Update the socket reference
        }

        socket.on('disconnect', () => {
            if (connectedDevices[projectId]) {
                console.log(`Device with projectId ${projectId} disconnected`);
            }
        });
    }
});

app.get('/scan', (req, res) => {
    res.render('index');
});

app.post('/send-message', async (req, res) => {
    const { projectId, phoneNumber, message } = req.body;

    if (!projectId || !phoneNumber || !message) {
        return res.status(400).send('Missing required fields');
    }

    const device = connectedDevices[projectId];
    if (!device || !device.connected || !device.sock) {
        return res.status(404).send('Device not connected');
    }

    try {
        await device.sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, { text: message });
        res.status(200).send('Message sent');
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).send('Failed to send message');
    }
});

app.get('/check-connection', (req, res) => {
    const { projectId } = req.query;

    if (!projectId) {
        return res.status(400).send('Missing projectId');
    }

    const device = connectedDevices[projectId];
    if (device && device.connected) {
        return res.status(200).send('Device is connected');
    } else {
        return res.status(404).send('Device not connected');
    }
});

const {
    DisconnectReason,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const makeWASocket = require('@whiskeysockets/baileys').default;

async function connectionLogicMultiDevice(projectId) {
    const authDir = `auth_info_baileys_${projectId}`;
    const credsPath = path.join(authDir, 'creds.json');

    try {
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const sock = makeWASocket({
            printQRInTerminal: false,
            auth: state
        });

        connectedDevices[projectId].sock = sock;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            console.log('connection', connection);

            if (qr && !connectedDevices[projectId].connected) {
                try {
                    const qrCodeDataURL = await qrcode.toDataURL(qr);
                    connectedDevices[projectId].qrCodeDataURL = qrCodeDataURL;
                    connectedDevices[projectId].socket.emit('qrCode', qrCodeDataURL);
                    connectedDevices[projectId].socket.emit('message', 'Waiting to connect');
                } catch (error) {
                    console.error('Error generating QR code:', error);
                }
            }

            if (connection === 'open') {
                connectedDevices[projectId].connected = true;
                connectedDevices[projectId].socket.emit('message', 'Connected');
                console.log(`Device with projectId ${projectId} connected`);
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                const shouldRescan = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;

                if (shouldReconnect) {
                    console.log(`Reconnecting device with projectId ${projectId}`);
                    connectionLogicMultiDevice(projectId);
                }

                if (shouldRescan && fs.existsSync(credsPath)) {
                    try {
                        fs.unlinkSync(credsPath);
                        connectedDevices[projectId].connected = false;
                        connectedDevices[projectId].qrCodeDataURL = null;
                        console.log(`Rescanning device with projectId ${projectId}`);
                        connectionLogicMultiDevice(projectId);
                    } catch (error) {
                        console.error('Error clearing creds.json:', error);
                    }
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Check if credentials are already available and connected
        if (fs.existsSync(credsPath)) {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
            if (creds && creds.me && creds.me.id) {
                connectedDevices[projectId].connected = true;
                connectedDevices[projectId].socket.emit('message', 'Connected');
                console.log(`Device with projectId ${projectId} already connected`);
            }
        }
    } catch (error) {
        console.error('Error in connectionLogicMultiDevice:', error);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
