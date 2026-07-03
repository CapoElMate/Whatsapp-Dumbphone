const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const READY_GRACE_MS = 15000;

const AUTH_DIR = '/app/.wwebjs_auth';
if (fs.existsSync(AUTH_DIR)) {
    for (const entry of fs.readdirSync(AUTH_DIR)) {
        const profileDir = path.join(AUTH_DIR, entry);
        if (fs.statSync(profileDir).isDirectory()) {
            for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
                try { fs.unlinkSync(path.join(profileDir, lock)); } catch (_) {}
            }
        }
    }
}

let readyAt = 0;
let lastState = 'starting';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => {
    readyAt = Date.now();
    lastState = 'ready';
    console.log('WhatsApp Gateway is ready!');
});
client.on('loading_screen', (_, message) => {
    lastState = message || 'loading';
});
client.on('authenticated', () => {
    lastState = 'authenticated';
});
client.on('auth_failure', (message) => {
    readyAt = 0;
    lastState = 'auth_failure';
    console.error('WhatsApp authentication failed:', message);
});
client.on('disconnected', (reason) => {
    readyAt = 0;
    lastState = 'disconnected';
    console.error('WhatsApp disconnected:', reason);
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const isTransientPuppeteerError = (error) => {
    const message = error && error.message ? error.message : '';
    return message.includes('Execution context was destroyed')
        || message.includes('Protocol error')
        || message.includes('Target closed')
        || message.includes('Session closed')
        || message.includes('Navigation failed because browser has disconnected');
};

client.getGatewayState = () => ({
    ready: readyAt > 0 && Date.now() - readyAt >= READY_GRACE_MS,
    lastState
});

client.waitForGatewayReady = async (timeoutMs = 20000) => {
    const startedAt = Date.now();
    while (!client.getGatewayState().ready) {
        if (Date.now() - startedAt >= timeoutMs) {
            const error = new Error('WhatsApp is still loading. Try again in a moment.');
            error.code = 'WHATSAPP_NOT_READY';
            throw error;
        }
        await delay(1000);
    }
};

client.withGatewayReady = async (operation, options = {}) => {
    const retries = options.retries || 3;
    const timeoutMs = options.timeoutMs || 20000;

    for (let attempt = 0; attempt <= retries; attempt++) {
        await client.waitForGatewayReady(timeoutMs);

        try {
            return await operation();
        } catch (error) {
            if (!isTransientPuppeteerError(error) || attempt === retries) throw error;

            readyAt = Date.now();
            lastState = 'reloading';
            await delay(2000 * (attempt + 1));
        }
    }
};

module.exports = client;
