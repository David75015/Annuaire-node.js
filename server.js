const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const docsDir = path.join(ROOT, 'documents');
const vcfListPath = path.join(ROOT, 'sources', 'vcf-list.json');
const contactsPath = path.join(ROOT, 'sources', 'contacts.json');
const dataDir = path.join(ROOT, 'data');
const dbPath = path.join(dataDir, 'app.db');

// Ensure data dir exists
if (!fsSync.existsSync(dataDir)) fsSync.mkdirSync(dataDir, { recursive: true });

// Initialize SQLite DB
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Erreur ouverture DB', err);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    phone TEXT,
    filename TEXT,
    uploadedAt TEXT
  )`);
});

// Ensure directories exist
if (!fsSync.existsSync(docsDir)) fsSync.mkdirSync(docsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, docsDir),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

app.post('/upload', upload.single('vcf'), async (req, res) => {
  const file = req.file;
  const { name, email, phone } = req.body || {};
  if (!file) return res.status(400).send('Fichier VCF absent');

  // Validate email and phone server-side (if provided)
  function isValidEmail(e) {
    if (!e) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }
  function isValidPhone(p) {
    if (!p) return true;
    const digits = String(p).replace(/\D/g, '');
    return digits.length >= 6 && digits.length <= 15;
  }
  if (!isValidEmail(email)) return res.status(400).send('Email invalide');
  if (!isValidPhone(phone)) return res.status(400).send('Numéro de téléphone invalide');

  try {
    // Update vcf-list.json
    let data = { files: [] };
    try {
      const raw = await fs.readFile(vcfListPath, 'utf8');
      data = JSON.parse(raw || '{}');
      if (!Array.isArray(data.files)) data.files = [];
    } catch (e) {
      data = { files: [] };
    }
    if (!data.files.includes(file.filename)) data.files.push(file.filename);
    await fs.writeFile(vcfListPath, JSON.stringify(data, null, 2), 'utf8');

    // Insert into SQLite DB
    const uploadedAt = new Date().toISOString();
    db.run(
      'INSERT INTO contacts (name, email, phone, filename, uploadedAt) VALUES (?, ?, ?, ?, ?)',
      [name || '', email || '', phone || '', file.filename, uploadedAt],
      (dberr) => {
        if (dberr) console.error('Erreur insert DB', dberr);
      }
    );

    // Keep a JSON backup for compatibility
    try {
      let contacts = [];
      try {
        const rawC = await fs.readFile(contactsPath, 'utf8');
        contacts = JSON.parse(rawC || '[]');
        if (!Array.isArray(contacts)) contacts = [];
      } catch (e) {
        contacts = [];
      }
      contacts.push({ name: name || '', email: email || '', phone: phone || '', filename: file.filename, uploadedAt });
      await fs.writeFile(contactsPath, JSON.stringify(contacts, null, 2), 'utf8');
    } catch (e) {
      console.error('Impossible de mettre à jour contacts.json', e);
    }

    res.json({ ok: true, filename: file.filename });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur');
  }
});

// Serve static files (site + documents)
app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
