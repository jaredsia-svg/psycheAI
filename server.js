const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');

const db = require('./src/db');
const Q = require('./src/questionnaire');
const { analyzeSocialText, blendTraits } = require('./src/textAnalysis');
const { buildReport } = require('./src/compatibility');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/jsqr.js', express.static(path.join(__dirname, 'node_modules/jsqr/dist/jsQR.js')));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 },
}));

// ---------- helpers ----------

const stmts = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByQr: db.prepare('SELECT * FROM users WHERE qr_code = ?'),
  insertUser: db.prepare('INSERT INTO users (email, password_hash, display_name, qr_code) VALUES (?, ?, ?, ?)'),
  profileByUser: db.prepare('SELECT * FROM profiles WHERE user_id = ?'),
  upsertProfile: db.prepare(`
    INSERT INTO profiles (user_id, age, location, bio, socials_json, social_text, answers_json, traits_json, interests_json, completed, updated_at)
    VALUES (@user_id, @age, @location, @bio, @socials_json, @social_text, @answers_json, @traits_json, @interests_json, @completed, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      age=@age, location=@location, bio=@bio, socials_json=@socials_json, social_text=@social_text,
      answers_json=@answers_json, traits_json=@traits_json, interests_json=@interests_json,
      completed=@completed, updated_at=datetime('now')`),
  insertMatch: db.prepare('INSERT INTO matches (scanner_id, scanned_id, score, report_json) VALUES (?, ?, ?, ?)'),
  matchById: db.prepare('SELECT * FROM matches WHERE id = ?'),
  matchesForUser: db.prepare(`
    SELECT m.*, u1.display_name AS scanner_name, u2.display_name AS scanned_name
    FROM matches m JOIN users u1 ON u1.id = m.scanner_id JOIN users u2 ON u2.id = m.scanned_id
    WHERE m.scanner_id = ? OR m.scanned_id = ? ORDER BY m.created_at DESC LIMIT 50`),
};

function currentUser(req) {
  return req.session.userId ? stmts.userById.get(req.session.userId) : null;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function getProfile(userId) {
  const row = stmts.profileByUser.get(userId);
  if (!row) return null;
  return {
    ...row,
    socials: JSON.parse(row.socials_json || '{}'),
    answers: JSON.parse(row.answers_json || '{}'),
    traits: JSON.parse(row.traits_json || '{}'),
    interests: JSON.parse(row.interests_json || '[]'),
  };
}

function baseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ---------- pages ----------

app.get('/', (req, res) => {
  const user = currentUser(req);
  if (user) return res.redirect('/dashboard');
  res.render('index', { user: null });
});

app.get('/register', (req, res) => res.render('register', { user: null, error: null }));

app.post('/register', (req, res) => {
  const { email, password, display_name } = req.body;
  const err = !email || !/^\S+@\S+\.\S+$/.test(email) ? 'Please enter a valid email.'
    : !password || password.length < 8 ? 'Password must be at least 8 characters.'
      : !display_name || !display_name.trim() ? 'Please enter your name.'
        : stmts.userByEmail.get(email.toLowerCase()) ? 'An account with that email already exists.'
          : null;
  if (err) return res.status(400).render('register', { user: null, error: err });

  const qr = 'KIN-' + crypto.randomBytes(12).toString('base64url');
  const info = stmts.insertUser.run(
    email.toLowerCase(), bcrypt.hashSync(password, 10), display_name.trim().slice(0, 60), qr
  );
  req.session.userId = info.lastInsertRowid;
  res.redirect('/profile/edit');
});

app.get('/login', (req, res) => res.render('login', { user: null, error: null }));

app.post('/login', (req, res) => {
  const user = stmts.userByEmail.get(String(req.body.email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    return res.status(401).render('login', { user: null, error: 'Invalid email or password.' });
  }
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/dashboard', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const profile = getProfile(user.id);
  const qrUrl = `${baseUrl(req)}/scan?code=${encodeURIComponent(user.qr_code)}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 320, margin: 2, color: { dark: '#3b2050', light: '#ffffff' } });
  const matches = stmts.matchesForUser.all(user.id, user.id);
  res.render('dashboard', { user, profile, qrDataUrl, qrUrl, matches });
});

app.get('/profile/edit', requireAuth, (req, res) => {
  const user = currentUser(req);
  res.render('edit-profile', { user, profile: getProfile(user.id), Q, error: null });
});

app.post('/profile/edit', requireAuth, (req, res) => {
  const user = currentUser(req);
  const b = req.body;

  const socials = {};
  for (const k of ['linkedin', 'instagram', 'twitter', 'tiktok', 'facebook', 'website']) {
    const v = String(b['social_' + k] || '').trim().slice(0, 200);
    if (v) socials[k] = v;
  }

  // Collect questionnaire answers.
  const answers = {};
  for (const item of [...Q.BIG_FIVE_ITEMS, ...Q.ATTACHMENT_ITEMS]) answers[item.id] = b[item.id];
  for (const v of Q.VALUES) answers['val_' + v.id] = b['val_' + v.id];
  for (const q of Q.LIFESTYLE) answers[q.id] = b[q.id];
  answers.love_languages = (Array.isArray(b.love_languages) ? b.love_languages : [b.love_languages]).filter(Boolean).slice(0, 2);

  const socialText = String(b.social_text || '').slice(0, 20000);
  const analysis = analyzeSocialText(socialText);
  const traits = blendTraits(Q.scoreAnswers(answers), analysis);

  const chosen = (Array.isArray(b.interests) ? b.interests : [b.interests])
    .filter(t => Q.INTEREST_TAGS.includes(t));
  const interests = [...new Set([...chosen, ...analysis.interests])];

  stmts.upsertProfile.run({
    user_id: user.id,
    age: Number(b.age) >= 18 && Number(b.age) < 120 ? Number(b.age) : null,
    location: String(b.location || '').trim().slice(0, 100) || null,
    bio: String(b.bio || '').trim().slice(0, 1000) || null,
    socials_json: JSON.stringify(socials),
    social_text: socialText || null,
    answers_json: JSON.stringify(answers),
    traits_json: JSON.stringify(traits),
    interests_json: JSON.stringify(interests),
    completed: 1,
  });
  res.redirect('/dashboard');
});

app.get('/scan', requireAuth, (req, res) => {
  const user = currentUser(req);
  const profile = getProfile(user.id);
  res.render('scan', { user, prefill: String(req.query.code || ''), profileComplete: !!(profile && profile.completed), error: null });
});

app.post('/scan', requireAuth, (req, res) => {
  const user = currentUser(req);
  const myProfile = getProfile(user.id);

  // Accept a raw code or a full QR URL containing ?code=...
  let code = String(req.body.code || '').trim();
  const m = code.match(/[?&]code=([^&\s]+)/);
  if (m) code = decodeURIComponent(m[1]);

  const renderErr = (error) => res.status(400).render('scan', {
    user, prefill: '', profileComplete: !!(myProfile && myProfile.completed), error,
  });

  if (!myProfile || !myProfile.completed) return renderErr('Complete your own profile before matching.');
  const other = stmts.userByQr.get(code);
  if (!other) return renderErr('That QR code doesn\'t belong to any Kindred user.');
  if (other.id === user.id) return renderErr('That\'s your own code — self-love is important, but scan someone else 😄');
  const otherProfile = getProfile(other.id);
  if (!otherProfile || !otherProfile.completed) return renderErr(`${other.display_name} hasn't completed their profile yet.`);

  const report = buildReport(
    user.display_name, other.display_name,
    myProfile.traits, otherProfile.traits,
    myProfile.interests, otherProfile.interests
  );
  const info = stmts.insertMatch.run(user.id, other.id, report.total, JSON.stringify(report));
  res.redirect('/match/' + info.lastInsertRowid);
});

app.get('/match/:id', requireAuth, (req, res) => {
  const user = currentUser(req);
  const match = stmts.matchById.get(Number(req.params.id));
  if (!match || (match.scanner_id !== user.id && match.scanned_id !== user.id)) {
    return res.status(404).render('error', { user, message: 'Match not found.' });
  }
  const scanner = stmts.userById.get(match.scanner_id);
  const scanned = stmts.userById.get(match.scanned_id);
  res.render('match', { user, match, report: JSON.parse(match.report_json), scanner, scanned });
});

app.use((req, res) => res.status(404).render('error', { user: currentUser(req), message: 'Page not found.' }));

app.listen(PORT, () => console.log(`Kindred running on http://localhost:${PORT}`));
