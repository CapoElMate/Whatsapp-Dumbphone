const rateLimit = require('express-rate-limit');

const PASSWORD = process.env.PASSWORD || 'admin123';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts. Please try again later.'
});

const tokenPromptPage = (req, message) => `
    <html><head><meta name="viewport" content="width=240, initial-scale=1.0"></head>
    <body style="background:#000;color:#fff;font-family:sans-serif;">
    <h3>Se requiere token</h3>
    <p>${message || 'Ingresa el token de acceso para continuar.'}</p>
    <form action="${req.originalUrl}" method="get">
        <input type="password" name="token" autofocus><br><br>
        <input type="submit" value="abrir">
    </form>
    </body></html>`;

const tokenParam = (req) => {
    const t = req.query.token || req.session.token;
    return t ? `?token=${encodeURIComponent(t)}` : '';
};

const requireTokenAuth = (req, res, next) => {
    const token = req.query.token || req.body.token;
    if (ACCESS_TOKEN && token === ACCESS_TOKEN) {
        req.session.token = token;
        return next();
    }

    res.send(tokenPromptPage(req, 'Necesitas el token de acceso para abrir esta imagen.'));
};

const checkAuth = (req, res, next) => {
    const token = req.query.token || req.body.token;
    if (ACCESS_TOKEN && token === ACCESS_TOKEN) {
        req.session.token = token;
        return next();
    }
    if (req.session.loggedIn || req.session.token === ACCESS_TOKEN) return next();
    res.send(`<html><head><meta name="viewport" content="width=240, initial-scale=1.0"></head>
        <body style="background:#000;color:#fff;font-family:sans-serif;">
        <h3>Login</h3>
        <form action="/login" method="post">
            <input type="password" name="pw"><br><br>
            <input type="submit" value="login">
        </form>
    </body></html>`);
};

module.exports = { checkAuth, loginLimiter, tokenParam, PASSWORD, requireTokenAuth };
