const {
    DisconnectReason,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const makeWASocket = require('@whiskeysockets/baileys').default;
const qrcode = require('qrcode')

async function connectionLogic(io) {
    const socket = io;
    const {
        state, saveCreds
    } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        printQRInTerminal: true,
        auth: state
    });

    sock.ev.on('connection.update', async (update) => {

        const { connection, lastDisconnect, qr } = update;
        
        
        if (qr) {
            try {
                const qrCodeDataURL = await qrcode.toDataURL(qr);
                socket.emit('qrCode', qrCodeDataURL);
                socket.emit('message', 'Waiting to connect')
            } catch (error) {
                console.error('Error saving QR code:', error);
                reject(error);
                return;
            }
        }

        console.log('waktu itu hujan', connection);
        
        if (connection === 'open') {
            socket.emit('message', 'Connected');
        }

        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

            console.log('banyak menanggung beban',shouldReconnect);
            
            if (shouldReconnect) {
                connectionLogic();
            }
        } 
    });

    // sock.ev.on('messages.update', (messageInfo) => {
    //     console.log('messsageInfo', messageInfo);
    // });

    sock.ev.on('messages.upsert', async (messageInfoUpsert) => {
        if (messageInfoUpsert.type === 'notify') {
            console.log('Incoming Message', JSON.stringify(messageInfoUpsert, undefined, 2));
            await sock.sendMessage(messageInfoUpsert.messages[0].key.remoteJid, { text: 'Hallo' })
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
}

module.exports = connectionLogic;