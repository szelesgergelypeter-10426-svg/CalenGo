  const express = require('express');
  const cors = require('cors');
  const sqlite3 = require('sqlite3').verbose();
  const DB_PATH = process.env.DB_PATH || './CalenGo.db';
  const db = new sqlite3.Database(DB_PATH);
  const app = express();
  const BASE_URL = process.env.BASE_URL || 'http://localhost:4200';
  const bcrypt = require('bcrypt');
  require('dotenv').config();
  const helmet = require('helmet');
  const rateLimit = require('express-rate-limit');
  const { body, validationResult } = require('express-validator');
  const nodemailer = require('nodemailer');
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
  const xss = require('xss');
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(helmet());
  const crypto = require('crypto');
  const loginAttempts = {};

  const cookieParser = require('cookie-parser');
  app.use(cookieParser());

  ///random 6 szamjegyu kod a 2FA hoz
  function generateTwoFactorCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}


  // HTTPS kényszerítés (production)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
  }
  next();
});

  // CORS beállítások - csak a megbízható origin-öknek enged
const allowedOrigins = [
  'http://localhost:4200',     // Angular fejlesztői szerver
  'http://127.0.0.1:4200',
  'https://yourdomain.com'     // Éles domain (cseréld ki a sajátodra)
];

app.use(cors({
  origin: function(origin, callback) {
    // Fejlesztéshez engedjük a null origin-t (pl. Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,  // Cookie-k és auth headerek engedélyezése
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


  app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://maps.googleapis.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; frame-src https://www.google.com;");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  next();
});

  // XSS védelem - bejövő adatok tisztítása
function sanitizeInput(req, res, next) {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key].trim());
      }
    });
  }
  next();
}
  app.use(sanitizeInput);


  function isTokenRevoked(token, callback) {
  db.get(`SELECT id FROM revoked_tokens WHERE token = ?`, [token], (err, row) => {
    callback(!!row);
  });
  }

  // AUTHENTICATION MIDDLEWARE
function authenticateToken(req, res, next) {
  const token = req.cookies.accessToken; // 🔽 COOKIE-BÓL
  if (!token) return res.status(401).json({ error: 'Token szükséges' });

  isTokenRevoked(token, (revoked) => {
    if (revoked) return res.status(403).json({ error: 'Token visszavonva' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return res.status(403).json({ error: 'Érvénytelen token' });
      req.user = user;
      next();
    });
  });
}
// AUTHORIZATION MIDDLEWARE - Csak saját vagy admin adatokat módosíthat
function authorizeSelfOrAdmin(req, res, next) {
  const requestedUserId = parseInt(req.params.id);
  if (req.user.role === 'admin' || req.user.id === requestedUserId) {
    next();
  } else {
    res.status(403).json({ error: 'Nincs jogosultságod ehhez a művelethez' });
  }
}

// AUTHORIZATION MIDDLEWARE - Csak admin
function authorizeAdmin(req, res, next) {
  if (req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin jogosultság szükséges' });
  }
}

  ///REQUEST LIMITER
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, ///15MIN
    max: 20, ///MAX 20REQUESTS
    message: { error: 'Túl sok próbálkozás, várj 15 percet' },
    validate: { trustProxy: false }
  });

  /// ÁLTALÁNOS API LIMITER (GET kérésekre)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, ///15 perc
  max: 100, ///MAX 100 kérés
  message: { error: 'Túl sok kérés, várj 15 percet' },
  validate: { trustProxy: false }
});

/// MÓDOSÍTÓ MŰVELETEK LIMITER (POST, PUT, DELETE)
const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, ///5 perc
  max: 30, ///MAX 30 kérés
  message: { error: 'Túl sok módosítási kérés, várj 5 percet' },
  validate: { trustProxy: false }
});

/// REGISZTRÁCIÓ LIMITER (erősebb korlát)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, ///1 óra
  max: 5, ///MAX 5 regisztráció IP-nként
  message: { error: 'Túl sok regisztrációs próbálkozás, várj 1 órát' },
  validate: { trustProxy: false }
});

const criticalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 perc
  max: 10, // max 10 kérés
  message: { error: 'Túl sok kritikus művelet, várj 15 percet' },
  validate: { trustProxy: false }
});

  ///EMAIL KÜLDŐ SETUP
  const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'ProjectCalenGo@gmail.com',
    pass: process.env.EMAIL_PASS
  }
  });

  function sendMail(to, subject, html) {
  // Ne küldjünk emailt fejlesztésben (opcionális)
  if (process.env.NODE_ENV === 'development' && !process.env.EMAIL_TEST_MODE) {
    console.log('DEV: Email not sent (would have been sent to:', to, ')');
    return;
  }
  
  transporter.sendMail({
    from: `"CalenGo" <${process.env.EMAIL_USER}>`,  // Hitelesített feladó
    to,
    subject,
    html
  }, (err) => {
    if (err) console.log('MAIL ERROR:', err);
    else console.log('MAIL SENT:', to);
  });
  }
  ///EMAIL KIKÜLDÉSE 240SOR
  ///EMAIL VALIDÁLÁS
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  ///LOGIN HELPER
  function logAction(userId, action, details = '', ip = null, userAgent = null, endpoint = null) {
  db.run(
    `INSERT INTO audit_log (userId, action, details, createdAt, ip, userAgent, endpoint)
     VALUES (?, ?, ?, datetime('now'), ?, ?, ?)`,
    [userId, action, details, ip, userAgent, endpoint]
  );
}

  db.serialize(() => {

    db.run(`CREATE TABLE IF NOT EXISTS revoked_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE,
      revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

      // 2FA oszlopok hozzáadása a users táblához
    db.run(`ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN DEFAULT 0`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN two_factor_code TEXT`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN two_factor_expires DATETIME`, () => {});
    db.run(`ALTER TABLE audit_log ADD COLUMN userAgent TEXT`, () => {});
    db.run(`ALTER TABLE audit_log ADD COLUMN endpoint TEXT`, () => {});

    db.run(`CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      token TEXT UNIQUE,
      expires DATETIME,
      FOREIGN KEY(userId) REFERENCES users(id)
    )`);
    
    db.run(`ALTER TABLE audit_log ADD COLUMN ip TEXT`, () => {});

    ///alap admin user +jelszava le hashelve a biztonsag kedveert
    db.get(`SELECT * FROM users WHERE email = ?`, ['admin@calengo.com'], async (err, user) => {
    if (!user) {const hash = await bcrypt.hash('admin123', 10);
      db.run(`INSERT INTO users (name, email, password, role)
        VALUES (?, ?, ?, 'admin')`,
        ['Admin', 'admin@calengo.com', hash]
      );
    }
    });
    
    // PROFILKÉP HOZZÁADÁSA - HA NINCSENEK
    db.run(`ALTER TABLE users ADD COLUMN avatar TEXT`, () => { });
    
    ///BOOKINGOKHOZ EMAIL COLUM HOZZÁADÁSA
    db.run(`ALTER TABLE bookings ADD COLUMN email TEXT`, () => {});

    ///speciality letrehozasa
    db.run(`ALTER TABLE users ADD COLUMN specialty TEXT DEFAULT 'Személyi edző'`, () => {});

    ///unique account
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users(email)`);

    db.run(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      action TEXT,
      details TEXT,
      createdAt TEXT)`);

    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT)`);

    db.run(`CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      trainerId INTEGER,
      date TEXT,
      time TEXT,
      status TEXT DEFAULT 'folyamatban')`);

    ///EGYEDI FOGLALÁS, 1IDŐPONTHOZ CSAK 1 FOGLALÁS LEHETSÉGES
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_booking
      ON bookings(trainerId, date, time) WHERE status!='törölve'`);

    ///trainer bio
    db.run(`CREATE TABLE IF NOT EXISTS trainer_bio (id INTEGER PRIMARY KEY AUTOINCREMENT,
      trainerId INTEGER UNIQUE,
      bio TEXT)`);
  });

  /// trainer bio lekérése
  app.get('/api/trainer-bio/:trainerId', authenticateToken, apiLimiter, (req, res) => {
  db.get(`SELECT bio FROM trainer_bio WHERE trainerId=?`,
    [req.params.trainerId],
    (err, row) => { res.json(row || { bio: '' });}
  );
});

  ///trainer bio mentés,update (ne törlődjön ha ment)
  app.put('/api/trainer-bio/:trainerId', authenticateToken, writeLimiter, (req, res) => {
  if (req.user.id !== parseInt(req.params.trainerId) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Csak a saját bio-dat módosíthatod' });
  }
  
  let { bio } = req.body;
  
  // Bio validáció
  if (bio && bio.length > 500) {
    return res.status(400).json({ error: 'A bio túl hosszú (max 500 karakter)' });
  }
  
  // Tiltott karakterek szűrése a bio-ból
  if (bio) {
    bio = bio.replace(/[<>]/g, ''); // < és > karakterek eltávolítása
  }
  
    db.run(`INSERT INTO trainer_bio (trainerId, bio) VALUES (?, ?) ON CONFLICT(trainerId) DO UPDATE SET bio=excluded.bio`,
    [req.params.trainerId, bio || ''],
    () => {
     logAction(req.user.id, 'BIO_UPDATE', `Trainer ${req.params.trainerId} bio updated`, req.ip, req.headers['user-agent'], req.originalUrl);
      res.json({ success: true });
    }
  );
});  


app.post('/api/refresh-token', (req, res) => {
  const refreshToken = req.cookies.refreshToken; // 🔽 COOKIE-BÓL
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token szükséges' });

  db.get(`SELECT userId, expires FROM refresh_tokens WHERE token = ?`, [refreshToken], (err, row) => {
    if (err || !row) return res.status(403).json({ error: 'Érvénytelen refresh token' });
    if (new Date(row.expires) < new Date()) {
      db.run(`DELETE FROM refresh_tokens WHERE token = ?`, [refreshToken]);
      return res.status(403).json({ error: 'Refresh token lejárt' });
    }

    db.get(`SELECT id, email, role FROM users WHERE id = ?`, [row.userId], (err, user) => {
      if (err || !user) return res.status(404).json({ error: 'Felhasználó nem található' });
      
      const newToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      
      res.cookie('accessToken', newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 1000
      });

      res.json({ success: true });
    });
  });
});



  

  ///REGISZTRÁCIÓ
  app.post('/api/register', registerLimiter, [
  body('name').isLength({ min: 2, max: 100 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).isStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 0
  })
], async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {return res.status(400).json({ errors: errors.array() });}
      const { name, email, password } = req.body;
      const hash = await bcrypt.hash(password, 10);

      db.run(`INSERT INTO users (name,email,password,role,specialty) VALUES (?,?,?,'user','Személyi edző')`,
        [name, email, hash],
        function (err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {return res.status(409).json({ error: 'A megadott email már használt' }); }///409 CONFLICT ERROR
            return res.status(500).json(err); ///500 SERVER ERROR
          }
          logAction(this.lastID, 'REGISTER', email, req.ip, req.headers['user-agent'], req.originalUrl);
          res.json({ success: true });
        });
    });

  ///BEJELENTKEZÉS
///BEJELENTKEZÉS
app.post('/api/login', authLimiter, async (req, res) => {
  const { email, password, rememberMe } = req.body;  // 🔽 rememberMe hozzáadva
  if (!email || !password) {
    return res.status(400).json({ error: 'Hiányzó adatok' });
  }
  
  db.get(`SELECT * FROM users WHERE email = ?`,
    [email],
    async (err, user) => {
      if (err || !user) {
        // Sikertelen próbálkozás naplózása és számláló frissítése
        const ip = req.ip;
        if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, firstAttempt: Date.now() };
        loginAttempts[ip].count++;
        loginAttempts[ip].lastAttempt = Date.now();

        if (loginAttempts[ip].count >= 5 && (Date.now() - loginAttempts[ip].firstAttempt) < 15 * 60 * 1000) {
          sendMail(
            'admin@calengo.com',
            '🚨 Többszörös sikertelen bejelentkezés',
            `<p>IP cím: ${ip}</p><p>Email: ${email}</p><p>Próbálkozások száma: ${loginAttempts[ip].count}</p>`
          );
          loginAttempts[ip] = { count: 0, firstAttempt: Date.now() };
        }

        logAction(null, 'LOGIN_FAILED', `Email: ${email} IP: ${req.ip}`, req.ip, req.headers['user-agent'], req.originalUrl);
        return res.status(401).json({ error: 'Érvénytelen bejelentkezés' });
      }
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) {
        const ip = req.ip;
        if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, firstAttempt: Date.now() };
        loginAttempts[ip].count++;
        loginAttempts[ip].lastAttempt = Date.now();

        if (loginAttempts[ip].count >= 5 && (Date.now() - loginAttempts[ip].firstAttempt) < 15 * 60 * 1000) {
          sendMail(
            'admin@calengo.com',
            '🚨 Többszörös sikertelen bejelentkezés',
            `<p>IP cím: ${ip}</p><p>Email: ${email}</p><p>Próbálkozások száma: ${loginAttempts[ip].count}</p>`
          );
          loginAttempts[ip] = { count: 0, firstAttempt: Date.now() };
        }

        logAction(null, 'LOGIN_FAILED', `Email: ${email} IP: ${req.ip}`, req.ip, req.headers['user-agent'], req.originalUrl);
        return res.status(401).json({ error: 'Érvénytelen bejelentkezés' });
      }

      // Sikeres login – töröljük a számlálót
      delete loginAttempts[req.ip];

      // 2FA ellenőrzés
      if (user.two_factor_enabled) {
        const code = generateTwoFactorCode();
        const expires = new Date(Date.now() + 10 * 60 * 1000);
        db.run(
          `UPDATE users SET two_factor_code = ?, two_factor_expires = ? WHERE id = ?`,
          [code, expires.toISOString(), user.id]
        );
        sendMail(
          user.email,
          "🔐 Kétfaktoros azonosítási kód",
          `<h2>Kétfaktoros kód</h2>
          <p>Kedves ${user.name}!</p>
          <p>A bejelentkezéshez szükséges kódod:</p>
          <h1 style="font-size: 32px; background: #f0f0f0; padding: 20px; text-align: center;">${code}</h1>
          <p>A kód 10 percig érvényes.</p>
          <p>Ha nem te próbálkoztál, hagyd figyelmen kívül ezt az üzenetet.</p>`
        );
        return res.json({
          requiresTwoFactor: true,
          userId: user.id,
          message: 'Kétfaktoros kód elküldve az email címedre.'
        });
      }

      // JWT token generálás (2FA nélkül)
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '1h' }
      );
      
      // 🔽 Refresh token generálás – ha rememberMe true, akkor 30 nap, különben 7 nap
      const refreshToken = crypto.randomBytes(40).toString('hex');
      const refreshExpiryDays = rememberMe === true ? 30 : 7;  // 🔽 EZ A LÉNYEG
      const expiresRefresh = new Date(Date.now() + refreshExpiryDays * 24 * 60 * 60 * 1000);
      db.run(
        `INSERT INTO refresh_tokens (userId, token, expires) VALUES (?, ?, ?)`,
        [user.id, refreshToken, expiresRefresh.toISOString()]
      );

      logAction(user.id, 'LOGIN_SUCCESS', `IP: ${req.ip}`, req.ip, req.headers['user-agent'], req.originalUrl);
              // Cookie-k beállítása
        res.cookie('accessToken', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 60 * 60 * 1000 // 1 óra
        });

        res.cookie('refreshToken', refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: refreshExpiryDays * 24 * 60 * 60 * 1000 // 7 vagy 30 nap
        });

        // JSON válasz (tokenek nélkül)
        res.json({
          success: true,
          id: user.id,
          name: user.name,
          role: user.role,
          rememberMe: rememberMe || false
        });
    }
  );
});


///2FA ellenőrzés
app.post('/api/verify-2fa', authLimiter, (req, res) => {
  const { userId, code } = req.body;

  if (!userId || !code) {
    return res.status(400).json({ error: 'Hiányzó adatok' });
  }

  db.get(
    `SELECT id, name, email, role, two_factor_code, two_factor_expires FROM users WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err || !user) {
        return res.status(404).json({ error: 'Felhasználó nem található' });
      }

      const now = new Date();
      const expires = new Date(user.two_factor_expires);

      if (user.two_factor_code !== code) {
        logAction(userId, '2FA_FAILED', `Hibás kód: ${code}`, req.ip, req.headers['user-agent'], req.originalUrl);
        return res.status(401).json({ error: 'Érvénytelen kód' });
      }

      if (now > expires) {
        logAction(userId, '2FA_FAILED', 'Lejárt kód', req.ip, req.headers['user-agent'], req.originalUrl);
        return res.status(401).json({ error: 'A kód lejárt, kérj új kódot' });
      }

      db.run(
        `UPDATE users SET two_factor_code = NULL, two_factor_expires = NULL WHERE id = ?`,
        [userId]
      );

      logAction(userId, '2FA_SUCCESS', 'Sikeres 2FA', req.ip, req.headers['user-agent'], req.originalUrl);

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      const refreshToken = crypto.randomBytes(40).toString('hex');
      const expiresRefresh = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      db.run(
        `INSERT INTO refresh_tokens (userId, token, expires) VALUES (?, ?, ?)`,
        [user.id, refreshToken, expiresRefresh.toISOString()]
      );

      res.cookie('accessToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 1000
      });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 nap (itt nincs rememberMe, de lehet bővíteni)
      });

      res.json({
        success: true,
        id: user.id,
        name: user.name,
        role: user.role
      });
          }
        );
      });

///2FA ki/be kapcsolása
app.post('/api/toggle-2fa', authenticateToken, (req, res) => {
  const { enabled } = req.body; // boolean (true/false)
  const userId = req.user.id;

  db.run(
    `UPDATE users SET two_factor_enabled = ? WHERE id = ?`,
    [enabled ? 1 : 0, userId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      logAction(userId, '2FA_TOGGLE', `2FA ${enabled ? 'bekapcsolva' : 'kikapcsolva'}`, req.ip, req.headers['user-agent'], req.originalUrl);
      res.json({ success: true, enabled });
    }
  );
});


///logout
app.post('/api/logout', authenticateToken, (req, res) => {
  const token = req.cookies.accessToken; // 🔽 COOKIE-BÓL
  db.run(`INSERT INTO revoked_tokens (token) VALUES (?)`, [token], (err) => {
    if (err) {
      logAction(req.user.id, 'LOGOUT_ERROR', err.message, req.ip);
      return res.status(500).json({ error: 'Logout hiba' });
    }
    db.run(`DELETE FROM refresh_tokens WHERE userId = ?`, [req.user.id]);
    
    // 🔽 COOKIE-K TÖRLÉSE
    res.clearCookie('accessToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    res.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });

    logAction(req.user.id, 'LOGOUT', 'Sikeres kijelentkezés', req.ip, req.headers['user-agent'], req.originalUrl);
    res.json({ success: true });
  });
});

/// Minden eszköz kijelentkeztetése
app.post('/api/logout-all', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const token = req.cookies.accessToken;

  db.run(`DELETE FROM refresh_tokens WHERE userId = ?`, [userId], function(err) {
    if (err) {
      logAction(userId, 'LOGOUT_ALL_ERROR', err.message, req.ip);
      return res.status(500).json({ error: 'Hiba a kijelentkeztetés során' });
    }

    db.run(`INSERT INTO revoked_tokens (token) VALUES (?)`, [token], function(err) {
      if (err) {
        logAction(userId, 'LOGOUT_ALL_ERROR', err.message, req.ip);
        return res.status(500).json({ error: 'Hiba a token visszavonásakor' });
      }

      res.clearCookie('accessToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
      res.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });

      logAction(userId, 'LOGOUT_ALL', 'Minden eszköz kijelentkeztetve', req.ip, req.headers['user-agent'], req.originalUrl);
      res.json({ success: true, message: 'Minden eszközről kijelentkeztettünk.' });
    });
  });
});

  /// IDŐPONT FOGLALÁS
  app.post('/api/book', authenticateToken, writeLimiter, (req, res) => {
  const { trainerId, date, time, email } = req.body;
  const userId = req.user.id;  // TOKENBŐL VESSZÜK, NEM A BODY-BÓL!
  console.log("BOOK REQ:", { userId, trainerId, date, time, email });
  if (!userId || !trainerId || !date || !time) {return res.status(400).json({ error: 'Hiányzó adatok' });}
  ///EMAIL VALIDÁLÁS HOGY JÓ E A FORMÁTUM
  if (!email || !isValidEmail(email)) {return res.status(400).json({ error: 'Hibás email formátum' });}

    /// VAN E MÁR FOGLÁS ERRE AZ IDŐPONTRA
    db.get(`SELECT id FROM bookings WHERE trainerId = ?
      AND date = ?
      AND time = ?
      AND status != 'törölve'`,
      [trainerId, date, time],
      (err, existing) => {
        if (existing) {
          return res.status(409).json({
            error: 'Ez az időpont már foglalt'
          });
        }

    /// HA NEM FOGLALT -> ADATBÁZISBA FELTÖLTÉS + EMAIL KÜLDÉS
    db.run(`INSERT INTO bookings (userId, trainerId, date, time, status, email)
      VALUES (?, ?, ?, ?, 'folyamatban', ?)`,
    [userId, trainerId, date, time, email],
    function (err) {
      if (err) {console.error(err);
        return res.status(500).json({ error: err.message });
      }
     logAction(userId, 'BOOKING_CREATE', `Trainer:${trainerId} Date:${date} Time:${time}`, req.ip, req.headers['user-agent'], req.originalUrl);

    db.get("SELECT name FROM users WHERE id = ?",
    [trainerId],
    (err, trainer) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: err.message });}
        const trainerName = trainer?.name || "Ismeretlen";
        sendMail(
          email,
          "Foglalás megerősítve",
          `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4; padding: 20px;">
          <tr><td align="center">
            <table width="500" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #dddddd;">
              <tr>
                <td style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; font-family: Arial, sans-serif; font-size: 24px; font-weight: bold;">
                  Foglalás megerősítve ✅
                </td>
              </tr>
              <tr>
                <td style="padding: 20px; color: #333333; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.5;">
                  <p>Kedves Ügyfelünk!</p>
                  <p>Köszönjük a foglalást, az alábbi időpontra sikeresen rögzítettük:</p>
                  <table width="100%" cellspacing="0" cellpadding="10" style="background-color: #f9f9f9; margin: 15px 0;">
                    <tr>
                      <td style="font-weight: bold;">Edző:</td>
                      <td>${trainerName}</td>
                    </tr>
                    <tr>
                      <td style="font-weight: bold;">Dátum:</td>
                      <td>${date}</td>
                    </tr>
                    <tr>
                      <td style="font-weight: bold;">Idő:</td>
                      <td>${time}</td>
                    </tr>
                  </table>
                  <p>Várunk szeretettel az edzésen!</p>
                  <p style="margin-top: 20px;">Üdvözlettel,<br><strong>A csapat</strong></p>
                </td>
              </tr>
            </table>
          </td></tr>
          </table>`
        );     
      }
    );
  });

        ///USER EMAIL KÜLDÉS
        db.get(`SELECT 
          t.email as trainerEmail,
          t.name as trainerName,
          u.name as userName,
          u.email as userEmail
            FROM users t
            JOIN users u ON u.id = ?
            WHERE t.id = ?`,
          [userId, trainerId],
          (e, data) => {
            if (data) {
              sendMail(
                data.trainerEmail,
                "Új foglalás érkezett",
                `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4; padding: 20px;">
                <tr> <td align="center">
                  <table width="500" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    <tr> <td style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; font-family: Arial, sans-serif; font-size: 24px; font-weight: bold;">
                      Új foglalás érkezett ✅ </td> </tr> <tr>
                      <td style="padding: 20px; color: #333333; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.5;">
                        <p>Tisztelt ${data.trainerName}</p> <p> Új Foglalása érkezett, az alábbi időpontra:</p>
                        <table width="100%" border="0" cellspacing="0" cellpadding="10" style="background-color: #f9f9f9; margin: 15px 0;">
                          <tr> <td style="font-weight: bold;">Név:</td> <td>${data.userName}</td> </tr>
                          <tr><td style="font-weight: bold;">Email:</td> <td>${data.userEmail}</td> </tr>
                          <tr> <td style="font-weight: bold;">Dátum:</td> <td>${date}</td> </tr>
                          <tr> <td style="font-weight: bold;">Idő:</td> <td>${time}</td> </tr>
                          </table>  <p>Várunk szeretettel az edzésen!</p> <p style="margin-top: 20px;">Üdvözlettel,<br />
                          <strong>A csapat</strong></p> </td> </tr> <tr> <td style="background-color: #eeeeee; text-align: center; padding: 10px; font-size: 12px; color: #777777; font-family: Arial, sans-serif;">
                            Ez egy automatikus üzenet, kérjük ne válaszolj rá. </td> </tr> </table> </td> </tr> </table>`);
              } else {
              console.log("nincsen email az adott id hez:", trainerId);
            }
            res.json({ success: true });
          }); 
      });
  });

  ///A USER ÖSSZES FOGLALÁSÁNAK LEKÉRDEZÉSE
  app.get('/api/my-bookings/:userId', authenticateToken, apiLimiter, (req, res) => {
  // Ellenőrizzük, hogy a saját foglalásait kéri-e
  if (req.user.id !== parseInt(req.params.userId) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Csak a saját foglalásaidat tekintheted meg' });
  }
  
  db.all(`SELECT b.*, t.name as trainerName
    FROM bookings b
    JOIN users t ON b.trainerId = t.id
    WHERE b.userId = ?`,
    [req.params.userId],
    (_, rows) => res.json(rows));
});

  ///foglalas torlese
  app.delete('/api/bookings/:id', authenticateToken, writeLimiter, (req, res) => {
  db.get(`SELECT userId FROM bookings WHERE id=?`, [req.params.id], (_, row) => {
    if (!row) return res.status(404).json({ error: 'Nincs ilyen foglalás' });
    if (row.userId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'trainer') {
      return res.status(403).json({ error: 'Nincs jogosultságod törölni ezt a foglalást' });
    }
    db.run(`DELETE FROM bookings WHERE id=?`, [req.params.id], () => {
      logAction(req.user.id, 'BOOKING_DELETE', req.params.id, req.ip, req.headers['user-agent'], req.originalUrl);
      res.json({ success: true });
    });
  });
});

  //foglalas lekeres trainernek / trainer sajat foglalas nezet
  app.get('/api/trainer-bookings/:trainerId', authenticateToken, apiLimiter, (req, res) => {
  if (req.user.id !== parseInt(req.params.trainerId) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Csak a saját foglalásaidat tekintheted meg' });
  }
  
  db.all(`SELECT 
        b.*, 
        u.name as userName,
        u.email as userEmail
     FROM bookings b
     JOIN users u ON b.userId = u.id
     WHERE b.trainerId=?`,
    [req.params.trainerId],
    (_, rows) => res.json(rows));
});


  //BOOKING UPDATE - IDŐPONT MÓDOSÍTÁS TRAINER ÁLTAL
  app.put('/api/booking/:id', authenticateToken, writeLimiter, (req, res) => {
  const { id } = req.params;
  const { date, time } = req.body;
  // lekérjük az aktuális bookingot
  db.get(`SELECT trainerId FROM bookings WHERE id=?`, [id], (err, row) => {
    if (!row) {
      return res.status(404).json({ error: 'Nincs ilyen foglalás' });
    }
    // Csak a saját bookingját módosíthatja a trainer
    if (row.trainerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Nincs jogosultságod módosítani' });
    }
      // ELLENORIZZUK HOGY AZ UJ IDŐPONTRA NINCSEN MÁR FOGLALÁS
      db.get(`SELECT id FROM bookings
        WHERE trainerId = ?
        AND date = ?
        AND time = ?
        AND id != ?
        AND status != 'törölve'`,
      [row.trainerId, date, time, id],
      (err, existing) => {
        if (existing) {
          return res.status(409).json({
            error: 'Ez az időpont már foglalt'
          }); }
        db.run(`UPDATE bookings SET date = ?, time = ? WHERE id = ?`,
            [date, time, id],
            () => {
            logAction(req.user.id, 'BOOKING_UPDATE', `Booking ${id} changed to ${date} ${time}`, req.ip, req.headers['user-agent'], req.originalUrl);
              res.json({ success: true });
            }
          );
        });
      });
    });

  //minden user lekerese
  app.get('/api/users', authenticateToken, authorizeAdmin, apiLimiter, (req, res) => {
  db.all(`SELECT id, name, email, role FROM users ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'trainer' THEN 2 WHEN 'user' THEN 3 ELSE 4 END, name ASC`,
    (err, rows) => res.json(rows)
  );
});

  // ROLE MÓDOSÍTÁS — ADMIN
  app.put('/api/user-role/:id', authenticateToken, authorizeAdmin, writeLimiter, criticalLimiter, (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  
  if (!['user', 'trainer', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Érvénytelen szerepkör' });
  }
  
  db.run(`UPDATE users SET role = ? WHERE id = ?`,
    [role, id],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }
      logAction(req.user.id, 'ROLE_CHANGE', `User ${id} changed to ${role}`, req.ip, req.headers['user-agent'], req.originalUrl);
      res.json({ success: true });
    }
  );
});

  // TRAINER APPROVE / REJECT / APPROVE EMAIL KÜLDÉS
    // TRAINER APPROVE / REJECT / APPROVE EMAIL KÜLDÉS
  app.put('/api/trainer-booking-status/:id', authenticateToken, writeLimiter, (req, res) => {
  // Csak a saját bookingjait módosíthatja a trainer vagy admin
  db.get(`SELECT trainerId FROM bookings WHERE id=?`, [req.params.id], (err, booking) => {
    if (!booking) return res.status(404).json({ error: 'Nincs ilyen foglalás' });
    if (booking.trainerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Nincs jogosultságod státuszt módosítani' });
    }
    
    const { status } = req.body;
    function translateStatus(status) { ///STATUSZ FORDÍTÁS A MAGYARRA
    return {
      'pending': 'Folyamatban',
      'approved': 'Elfogadva',
      'rejected': 'Elutasítva',
      'cancelled': 'Törölve',
      'folyamatban': 'Folyamatban',
      'elfogadva': 'Elfogadva',
      'elutasítva': 'Elutasítva',
      'törölve': 'Törölve'
    }[status] || status; }
    db.get(`SELECT u.email, u.name as userName, b.date, b.time
      FROM bookings b
      JOIN users u ON b.userId=u.id
      WHERE b.id=?`,
      [req.params.id],
      (e, row) => {
        if (row && row.email) {
          sendMail(
            row.email,
            "Időpont foglalás státusza frissítve",
            `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4; padding: 20px;">
            <tr><td align="center">
              <table width="500" style="background-color: #ffffff; border: 1px solid #dddddd;">
                <tr><td style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; font-size: 24px;">
                Időpontja módosítva!</td> </tr> <tr>
                  <td style="padding: 20px; font-family: Arial;">
                    <p>Kedves ${row.userName}!</p>
                    <p>A foglalásod módosításra került:</p>
                    <table width="100%" cellpadding="10" style="background:#f9f9f9;">
                      <tr> <td><b>Státusz:</b> </td> <td>${translateStatus(status)}</td></tr>
                      <tr><td><b>Dátum:</b></td><td>${row.date}</td></tr>
                      <tr><td><b>Idő:</b></td><td>${row.time}</td></tr>
                    追赶
                    <p>Várunk szeretettel!</p>
                  </td>
                </tr>
              </table>
            </td>
          </table>
          </table>`
          );
        } else {
          console.log("Nincs email ehhez a bookinghoz");
        }
        
        // EZ VOLT A HIÁNYZÓ ZÁRÓ KAPCSOS ZÁRÓJEL!
        db.run(`UPDATE bookings SET status = ? WHERE id = ?`,
          [status, req.params.id],
          () => {
          logAction(req.user.id, 'STATUS_CHANGE', `Booking ${req.params.id} status: ${status}`, req.ip, req.headers['user-agent'], req.originalUrl);
            res.json({ success: true });
          }
        );
      }
    );
  });
});

  ///ADMIN->TRAINER PROMOTE->BEKERUL A TRAINER LISTABA
app.get('/api/trainers', apiLimiter, (req, res) => {
  db.all(`SELECT u.id, u.name, u.avatar, u.email, u.specialty, tb.bio
    FROM users u LEFT JOIN trainer_bio tb ON tb.trainerId = u.id
    WHERE u.role='trainer'`,
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});
  //ADMIN USER TÖRLÉSE + HOZZÁ TARTOZÓ BOOKINGOK TÖRLÉSE
  app.delete('/api/users/:id', authenticateToken, authorizeAdmin, writeLimiter, criticalLimiter, (req, res) => {
  const id = req.params.id;
  // Ne törölje saját magát
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Nem törölheted saját magad' });
  }
  db.run(`DELETE FROM bookings WHERE userId = ?`, [id], () => {
    db.run(`DELETE FROM users WHERE id = ?`, [id], function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }
      logAction(req.user.id, 'USER_DELETE', `User ${id} deleted`, req.ip, req.headers['user-agent'], req.originalUrl);
      res.json({ success: true });
    });
  });
});
  //GET MY PROFILE
app.get('/api/profile/:id', authenticateToken, authorizeSelfOrAdmin, apiLimiter, (req, res) => {
  db.get(`SELECT id, name, email, avatar, specialty, two_factor_enabled FROM users WHERE id=?`,
    [req.params.id],
    (_, row) => res.json(row)
  );
});

  //UPDATE PROFILE
  app.put('/api/profile/:id', authenticateToken, authorizeSelfOrAdmin, writeLimiter, async (req, res) => {
  let { name, email, password, avatar, specialty } = req.body;
  
  // Extra validációk
  if (name && (name.length < 2 || name.length > 100)) {
    return res.status(400).json({ error: 'A név 2-100 karakter között lehet' });
  }
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: 'Érvénytelen email formátum' });
  }
  if (specialty && specialty.length > 50) {
    return res.status(400).json({ error: 'A szakterület túl hosszú' });
  }
  db.get(`SELECT password, avatar FROM users WHERE id=?`, [req.params.id], async (err, user) => {
    let finalAvatar = avatar || user.avatar;
    let finalPassword = user.password;
    if (password && password.trim() !== '') {
      finalPassword = await bcrypt.hash(password, 10);
    }
    db.run(`UPDATE users SET name=?, email=?, password=?, avatar=?, specialty=? WHERE id=?`,
      [name, email, finalPassword, finalAvatar, specialty, req.params.id],
      () => {
      logAction(req.user.id, 'PROFILE_UPDATE', `User ${req.params.id} updated profile`, req.ip, req.headers['user-agent'], req.originalUrl);
        res.json({ success: true });
          }
        );
  });
});
  

  ///LOG LISTÁZÓ API
  app.get('/api/audit', authenticateToken, authorizeAdmin, apiLimiter, (req, res) => {
  db.all(`SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON a.userId=u.id ORDER BY a.id DESC`, (e, r) => res.json(r));
});

 ///GLOBAL ERROR KEZELŐ
app.use((err, req, res, next) => {
  console.error('GLOBAL ERROR:', err);
  res.status(500).json({ error: 'Server error' });
});

app.get('/', (req, res) => {
  res.send('CalenGo backend running');
});

// 30 napnál régebbi naplók törlése indításkor
db.run(`DELETE FROM audit_log WHERE createdAt < datetime('now', '-30 days')`);

///1oranal regebbi loginattemptet torli memoriatakarekossag erdekeben
setInterval(() => {
  const now = Date.now();
  for (const ip in loginAttempts) {
    if (now - loginAttempts[ip].firstAttempt > 60 * 60 * 1000) {
      delete loginAttempts[ip];
    }
  }
}, 10 * 60 * 1000); // 10 percenként fut

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});