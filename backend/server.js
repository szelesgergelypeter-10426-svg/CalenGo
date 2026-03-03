const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const db = new sqlite3.Database('./CalenGo.db');
const app = express();
const bcrypt = require('bcrypt');
require('dotenv').config();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');

app.use(express.json());
app.use(cors());
app.use(helmet());


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Túl sok próbálkozás, várj 15 percet' }
});


///EMAIL KÜLDŐ RENDSZER
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ProjectCalenGo@gmail.com',
    pass: process.env.MAIL_PASS
  }
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

///PROFILKÉP FELTÖLTÉS
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + path.extname(file.originalname);
    cb(null, unique);
  }
});

const upload = multer({ storage });

// statikus fájl kiszolgálás
app.use('/uploads', express.static('uploads'));


// TEST ROUTE
app.get('/', (req, res) => {
  res.send('CalenGo backend running');
});


db.serialize(() => {

  // PROFIL MEZŐK HOZZÁADÁSA - HA NINCSENEK
 db.run(`ALTER TABLE users ADD COLUMN avatar TEXT`, ()=>{});

 db.run(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    action TEXT,
    details TEXT,
    createdAt TEXT
  )
  `);

 db.run(`
    CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT
    )
  `);

  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    trainerId INTEGER,
    date TEXT,
    time TEXT,
    status TEXT DEFAULT 'pending')
  `);

  db.run(`INSERT OR IGNORE INTO users (id, name, email, password, role)
    VALUES (1, 'Admin', 'admin@calengo.com', 'admin123', 'admin')
  `);

  db.run(`
  CREATE TABLE IF NOT EXISTS trainers (
    id INTEGER PRIMARY KEY,
    name TEXT)
  `);

  db.run(`INSERT OR IGNORE INTO trainers (id, name)
  VALUES (1, 'John Doe'), (2, 'Jane Smith')
  `);

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_booking
    ON bookings(trainerId, date, time)
    WHERE status='active'
  `);

});


//regiosztracio
app.post('/api/register',
[
  body('name').isLength({min:2}),
  body('email').isEmail(),
  body('password').isLength({min:8})
],
async (req,res)=>{

  const errors = validationResult(req);
  if(!errors.isEmpty()){
    return res.status(400).json({errors: errors.array()});
  }

  const { name,email,password } = req.body;

  const hash = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (name,email,password,role)
     VALUES (?,?,?,'user')`,
    [name,email,hash],
    function(err){

      if(err){
        if(err.message.includes('UNIQUE')){
          return res.status(409).json({error:'Email exists'});
        }
        return res.status(500).json(err);
      }

      logAction(this.lastID,'REGISTER',email);
      res.json({success:true});
    });
});

//LOGIN + DEBUG
app.post('/api/login', authLimiter, async (req, res) => {

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing data' });
  }

  db.get(
    `SELECT * FROM users WHERE email = ?`,
    [email],
    async (err, user) => {

      if (!user) {
        return res.status(401).json({ error: 'Invalid login' });
      }

      const ok = password === user.password || await bcrypt.compare(password, user.password);

      if (!ok) {
        return res.status(401).json({ error: 'Invalid login' });
      }

      res.json({
        id: user.id,
        name: user.name,
        role: user.role
      });
    }
  );
});

//idopont foglalas
app.post('/api/book', authLimiter, (req, res) => {

  const { userId, trainerId, date, time, email } = req.body;

  console.log("BOOK REQ:", req.body);

  if (!userId || !trainerId || !date || !time) {
    return res.status(400).json({ error: 'Missing data' });
  }

  if (!email || !isValidEmail(email)) {
  return res.status(400).json({ error: 'Hibás email formátum' });
  }
 
  // 🔍 CHECK — van-e már foglalás erre az időpontra
  db.get(`
    SELECT id FROM bookings
    WHERE trainerId = ?
    AND date = ?
    AND time = ?
    AND status = 'active'
  `,
  [trainerId, date, time],
  (err, existing) => {

    if (existing) {
      return res.status(409).json({
        error: 'Ez az időpont már foglalt'
      });
    }
    


    // ha nincs → INSERT + email küldése + logolás
    db.run(`
    INSERT INTO bookings (userId, trainerId, date, time, status)
    VALUES (?, ?, ?, ?, 'pending')
    `,
    [userId, trainerId, date, time],
    function(err) {

      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }

    sendMail(
    email,
    "Foglalás megerősítve",
    `Sikeres foglalás:\nDátum: ${date}\nIdő: ${time}`
    );
    res.json({ success: true });
  });
    ///TRAINER USER LEKÉRÉSE
   db.get(
  "SELECT email,name FROM users WHERE id=?",
  [trainerId],
  (e, trainer) => {

    if (trainer) {
      sendMail(
        trainer.email,
        "Új foglalás érkezett",
        `Új időpont foglalás:\nDátum: ${date}\nIdő: ${time}`
      );
    } else {
      console.log("Trainer email not found for id:", trainerId);
    }
  });
  });
});

//foglalas lekeres usernek
app.get('/api/my-bookings/:userId', (req,res)=>{
  db.all(`
    SELECT b.*, t.name as trainerName
    FROM bookings b
    JOIN users t ON b.trainerId = t.id
    WHERE b.userId = ?
  `,
  [req.params.userId],
  (_,rows)=> res.json(rows));
});

  ///foglalas torlese
app.delete('/api/bookings/:id', (req,res)=>{
  db.get(`SELECT userId FROM bookings WHERE id=?`,
    [req.params.id],
    (_,row)=>{

      db.run(
        `DELETE FROM bookings WHERE id=?`,
        [req.params.id],
        ()=>{
          if(row) logAction(row.userId,'BOOKING_DELETE',req.params.id);
          res.json({success:true});
        });
    });
});

//foglalas lekeres trainernek / trainer sajat foglalas nezet
app.get('/api/trainer-bookings/:trainerId',(req,res)=>{
  db.all(
    `SELECT * FROM bookings WHERE trainerId=?`,
    [req.params.trainerId],
    (_,rows)=> res.json(rows)
  );
});



//foglalas torlese
app.put('/api/cancel/:id', (req, res) => {
  const { id } = req.params;

  db.run(
    `UPDATE bookings SET status = 'cancelled' WHERE id = ?`,
    [id],
    () => res.json({ message: 'Cancelled' })
  );
});

//ADMIN MODOSITAS - ADMIN-AL
app.put('/api/booking/:id', (req, res) => {

  const { id } = req.params;
  const { date, time } = req.body;

  db.run(`
    UPDATE bookings
    SET date = ?, time = ?
    WHERE id = ?
  `,
  [date, time, id],
  function(err) {

    if (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }

    res.json({ success: true });
  });

});

//minden user lekerese
app.get('/api/users', (req, res) => {
  db.all(`SELECT id, name, email, role FROM users`,
    (err, rows) => res.json(rows)
  );
});

// ROLE MÓDOSÍTÁS — ADMIN
app.put('/api/user-role/:id', (req, res) => {

  const { id } = req.params;
  const { role } = req.body;

  if (!['user','trainer','admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  db.run(
    `UPDATE users SET role = ? WHERE id = ?`,
    [role, id],
    function(err) {

      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }

      res.json({ success: true });
    }
  );

});
//ADMIN BOOKING
app.get('/api/all-bookings-grouped', (req,res)=>{
  db.all(`
    SELECT b.*, u.name as userName, t.name as trainerName
    FROM bookings b
    JOIN users u ON b.userId=u.id
    JOIN users t ON b.trainerId=t.id
    ORDER BY trainerName, date, time
  `,(e,r)=>res.json(r))
})

// TRAINER APPROVE / REJECT
app.put('/api/trainer-booking-status/:id', (req, res) => {

  const { status } = req.body;

  db.get(`
    SELECT u.email, b.date, b.time
    FROM bookings b
    JOIN users u ON b.userId=u.id
    WHERE b.id=?`,
    [req.params.id],
    (e,row) => {

      if (row && row.email) {
      sendMail(
      row.email,
      "Foglalás státusz frissítve",
      `Státusz: ${status}\n${row.date} ${row.time}`
    );
  }
    }
  );

  db.run(`
    UPDATE bookings SET status = ?
    WHERE id = ?`,
    [status, req.params.id],
    () => res.json({ success: true })
  );
});

///ADMIN->TRAINER PROMOTE->BEKERUL A TRAINER LISTABA
app.get('/api/trainers',(req,res)=>{
  db.all(
    `SELECT id,name FROM users WHERE role='trainer'`,
    (_,rows)=> res.json(rows)
  );
});
//ADMIN USER TÖRLÉSE + HOZZÁ TARTOZÓ BOOKINGOK TÖRLÉSE
app.delete('/api/users/:id', (req, res) => {

  const id = req.params.id;

  db.run(`DELETE FROM bookings WHERE userId = ?`, [id], () => {

    db.run(`DELETE FROM users WHERE id = ?`, [id], function(err) {

      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }

      res.json({ success: true });

    });

  });

});
//GET MY PROFILE
app.get('/api/profile/:id', (req,res)=>{
  db.get(
    `SELECT id,name,email,password,avatar
     FROM users WHERE id=?`,
    [req.params.id],
    (_,row)=> res.json(row)
  );
});

//UPDATE PROFILE
app.put('/api/profile/:id', (req,res)=>{
  const { name, email, password, avatar } = req.body;

  db.run(`
    UPDATE users
    SET name=?, password=?, avatar=?
    WHERE id=?
  `,
  [name, password, avatar, req.params.id],
  ()=> res.json({success:true}));
});

///EMAIL KÜLDŐ
function sendMail(to, subject, text) {
  transporter.sendMail({
    from: 'Gym Booking',
    to,
    subject,
    text
  }, (err) => {
    if (err) console.log('MAIL ERROR:', err);
    else console.log('MAIL SENT:', to);
  });
}

///PROFILKÉP FELTÖLTÉSE
app.post('/api/upload-avatar/:id', upload.single('avatar'), (req, res) => {

  const filePath = '/uploads/' + req.file.filename;

  db.run(
    `UPDATE users SET avatar=? WHERE id=?`,
    [filePath, req.params.id],
    () => res.json({ path: filePath })
  );

});

///LOGIN HELPER
function logAction(userId, action, details = '') {
  db.run(
    `INSERT INTO audit_log (userId, action, details, createdAt)
     VALUES (?, ?, ?, datetime('now'))`,
    [userId, action, details]
  );
}
///LOG LISTÁZÓ API
app.get('/api/audit', (req,res)=>{
  db.all(`
    SELECT a.*, u.email
    FROM audit_log a
    LEFT JOIN users u ON a.userId=u.id
    ORDER BY a.id DESC
  `,(e,r)=>res.json(r));
});

///GLOBAL ERROR KEZELŐ
app.use((err, req, res, next) => {
  console.error('GLOBAL ERROR:', err);
  res.status(500).json({ error: 'Server error' });
});


//------------------SZEERVER FUTTATAS------------------//
app.listen(3000, () => {
  console.log('Server running on port 3000');
});
//------------------SZEERVER FUTTATAS------------------//
