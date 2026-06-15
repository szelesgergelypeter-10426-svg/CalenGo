  const express = require('express');
  const cors = require('cors');
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database('./CalenGo.db');
  const app = express();
  const bcrypt = require('bcrypt');
  require('dotenv').config();
  const helmet = require('helmet');
  const rateLimit = require('express-rate-limit');
  const { body, validationResult } = require('express-validator');
  const nodemailer = require('nodemailer');
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
  const xss = require('xss');
  app.use(express.json());
  app.use(helmet());

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


  // AUTHENTICATION MIDDLEWARE
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ error: 'Hozzáférés megtagadva - token szükséges' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Érvénytelen vagy lejárt token' });
    }
    req.user = user;
    next();
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
    message: { error: 'Túl sok próbálkozás, várj 15 percet' }
  });

  /// ÁLTALÁNOS API LIMITER (GET kérésekre)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, ///15 perc
  max: 100, ///MAX 100 kérés
  message: { error: 'Túl sok kérés, várj 15 percet' }
});

/// MÓDOSÍTÓ MŰVELETEK LIMITER (POST, PUT, DELETE)
const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, ///5 perc
  max: 30, ///MAX 30 kérés
  message: { error: 'Túl sok módosítási kérés, várj 5 percet' }
});

/// REGISZTRÁCIÓ LIMITER (erősebb korlát)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, ///1 óra
  max: 5, ///MAX 5 regisztráció IP-nként
  message: { error: 'Túl sok regisztrációs próbálkozás, várj 1 órát' }
});

  ///EMAIL KÜLDŐ SETUP
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'ProjectCalenGo@gmail.com',
      pass: process.env.MAIL_PASS
    }
  });

  function sendMail(to, subject, html) {
    transporter.sendMail({
      from: 'Gym Booking',
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

  db.serialize(() => {

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
    () => res.json({ success: true })
  );
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
          logAction(this.lastID, 'REGISTER', email);
          res.json({ success: true });
        });
    });

  ///BEJELENTKEZÉS
  app.post('/api/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Hiányzó adatok' });
  }
  
  db.get(`SELECT * FROM users WHERE email = ?`,
    [email],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Érvénytelen bejelentkezés' });
      }
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) {
        return res.status(401).json({ error: 'Érvénytelen bejelentkezés' });
      }
      
      // JWT TOKEN GENERÁLÁS
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email, 
          role: user.role 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      res.json({
        success: true,
        token: token,
        id: user.id,
        name: user.name,
        role: user.role
      });
    }
  );
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
      logAction(req.user.id, 'BOOKING_DELETE', req.params.id);
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
        db.run(`UPDATE bookings
          SET date = ?, time = ?
          WHERE id = ?`,
        [date, time, id],
        () => res.json({ success: true })
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
  app.put('/api/user-role/:id', authenticateToken, authorizeAdmin, writeLimiter, (req, res) => {
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
      logAction(req.user.id, 'ROLE_CHANGE', `User ${id} changed to ${role}`);
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
          () => res.json({ success: true })
        );
      }
    );
  });
});

  ///ADMIN->TRAINER PROMOTE->BEKERUL A TRAINER LISTABA
  app.get('/api/trainers', authenticateToken, apiLimiter, (req, res) => {
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
  app.delete('/api/users/:id', authenticateToken, authorizeAdmin, writeLimiter, (req, res) => {
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
      logAction(req.user.id, 'USER_DELETE', `User ${id} deleted`);
      res.json({ success: true });
    });
  });
});
  //GET MY PROFILE
  app.get('/api/profile/:id', authenticateToken, authorizeSelfOrAdmin, apiLimiter, (req, res) => {
  db.get(`SELECT id,name,email,avatar,specialty FROM users WHERE id=?`,
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
      () => res.json({ success: true })
    );
  });
});

  ///LOGIN HELPER
  function logAction(userId, action, details = '') {
    db.run(`INSERT INTO audit_log (userId, action, details, createdAt) VALUES (?, ?, ?, datetime('now'))`,
      [userId, action, details]
    );
  }

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
  app.listen(3000, () => {
    console.log('Server running on port 3000');
  });