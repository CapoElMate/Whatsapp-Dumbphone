const express = require('express');
const router = express.Router();
const { checkAuth, loginLimiter, tokenParam, PASSWORD } = require('./auth');
const client = require('./whatsapp');

const parseLimit = (value, fallback, max) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
};

const CHAT_LIST_LIMIT = parseLimit(process.env.CHAT_LIST_LIMIT, 50, 200);
const MESSAGE_HISTORY_LIMIT = parseLimit(process.env.MESSAGE_HISTORY_LIMIT, 30, 100);

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const loadingPage = (req, message) => {
    const tp = tokenParam(req);
    return `<html><head>
        <meta name="viewport" content="width=240, initial-scale=1.0">
        <meta http-equiv="refresh" content="8;url=/${tp}">
    </head>
    <body style="background:#000;color:#fff;font-family:sans-serif;margin:0;padding:8px;">
        <div style="background:#25D366;color:#000;padding:5px;margin:-8px -8px 8px -8px;"><b>WhatsApp</b></div>
        <p>${escapeHtml(message)}</p>
        <p><a href="/${tp}" style="color:#25D366;">Refresh</a></p>
    </body></html>`;
};

const isNotReadyError = (error) => error && error.code === 'WHATSAPP_NOT_READY';

router.post('/login', loginLimiter, (req, res) => {
    if (req.body.pw === PASSWORD) {
        req.session.loggedIn = true;
        res.redirect('/');
    } else {
        res.send("Invalid password. <a href='/'>Try again</a>");
    }
});

router.get('/', checkAuth, async (req, res) => {
    try {
        const chats = await client.withGatewayReady(() => client.getChats());
        const tp = tokenParam(req);

        let html = `<html><head><meta name="viewport" content="width=240, initial-scale=1.0"></head>
        <body style="background:#000;color:#fff;font-family:sans-serif;margin:0;padding:0;">
        <div style="background:#25D366;color:#000;padding:5px;"><b>WhatsApp</b></div>
        <table width="100%" border="0" cellspacing="0" cellpadding="8">`;

        chats.slice(0, CHAT_LIST_LIMIT).forEach(chat => {
            const hasUnread = chat.unreadCount > 0;
            const titleColor = hasUnread ? '#25D366' : '#ffffff';
            const unreadText = hasUnread ? ` <b>(${chat.unreadCount})</b>` : '';
            html += `<tr><td style="border-bottom:1px solid #333;">
                <a href="/chat/${chat.id._serialized}${tp}" style="color:${titleColor};text-decoration:none;">
                    ${escapeHtml(chat.name || chat.id.user)}${unreadText}
                </a>
            </td></tr>`;
        });

        html += `</table></body></html>`;
        res.send(html);
    } catch (e) {
        if (isNotReadyError(e)) return res.send(loadingPage(req, e.message));
        console.error(e);
        res.send('Error: ' + escapeHtml(e.message));
    }
});

router.get('/chat/:id', checkAuth, async (req, res) => {
    try {
        const chat = await client.withGatewayReady(() => client.getChatById(req.params.id));
        if (chat.unreadCount > 0) await chat.sendSeen();
        const tp = tokenParam(req);

        let msgs = [];
        try { msgs = await chat.fetchMessages({ limit: MESSAGE_HISTORY_LIMIT }); } catch (e) { console.error(e); }

        let html = `<html><head><meta name="viewport" content="width=240, initial-scale=1.0"></head>
        <body style="background:#eee;color:#000;font-family:sans-serif;margin:0;padding:0;">
        <div style="background:#25D366;color:#000;padding:5px;">
            <a href="/${tp}" style="color:#000;text-decoration:none;"><b>[&lt; Back]</b></a> ${escapeHtml(chat.name)}
        </div>
        <div style="padding:4px;">`;

        if (msgs.length === 0) html += `<i>No messages.</i><br><br>`;

        for (const m of msgs) {
            const align = m.fromMe ? 'right' : 'left';
            const bg = m.fromMe ? '#dcf8c6' : '#ffffff';
            const date = new Date(m.timestamp * 1000);
            const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');

            let senderHtml = '';
            if (!m.fromMe && chat.isGroup) {
                try {
                    const contact = await m.getContact();
                    const name = contact.name || contact.pushname || contact.number;
                    senderHtml = `<div style="font-size:10px;color:#128C7E;font-weight:bold;margin-bottom:2px;">${escapeHtml(name)}</div>`;
                } catch (_) {
                    senderHtml = `<div style="font-size:10px;color:#128C7E;font-weight:bold;margin-bottom:2px;">Contact</div>`;
                }
            }

            let mediaHtml = '';
            if (m.hasMedia) {
                const types = { image: 'Image', sticker: 'Sticker', video: 'Video', audio: 'Audio', ptt: 'Audio', document: 'Document' };
                mediaHtml = `<div style="font-size:11px;color:#555;font-style:italic;margin-bottom:2px;">[${types[m.type] || 'Media'}]</div>`;
            }

            html += `<div style="text-align:${align};margin-bottom:5px;">
                <div style="background:${bg};border:1px solid #ccc;padding:4px;display:inline-block;text-align:left;max-width:90%;">
                    ${senderHtml}${mediaHtml}
                    <div style="font-size:12px;">${escapeHtml(m.body || '')}</div>
                    <div style="font-size:9px;color:#888;text-align:right;margin-top:3px;">${timeStr}</div>
                </div>
            </div>`;
        }

        const t = req.query.token || req.session.token;
        const tokenField = t ? `<input type="hidden" name="token" value="${t}">` : '';
        html += `</div><hr>
        <form action="/send" method="post" style="padding:4px;margin:0;">
            <input type="hidden" name="to" value="${req.params.id}">
            ${tokenField}
            <input type="text" name="msg" style="width:140px;">
            <input type="submit" value="OK">
        </form><br><br></body></html>`;

        res.send(html);
    } catch (e) {
        if (isNotReadyError(e)) return res.send(loadingPage(req, e.message));
        console.error(e);
        res.send('Error: ' + escapeHtml(e.message) + ' <br><a href="/">Back</a>');
    }
});

router.post('/send', checkAuth, async (req, res) => {
    try {
        await client.withGatewayReady(() => client.sendMessage(req.body.to, req.body.msg));
        res.redirect('/chat/' + req.body.to + tokenParam(req));
    } catch (e) {
        if (isNotReadyError(e)) return res.send(loadingPage(req, e.message));
        console.error(e);
        res.send('Error: ' + escapeHtml(e.message) + ' <br><a href="/">Back</a>');
    }
});

module.exports = router;
