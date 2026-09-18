const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL est obligatoire. Configure-la dans Render (ou utilise un fichier .env en local).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  max: 5
});

const seedDocsDir = path.join(ROOT, 'documents');
const seedContactsPath = path.join(ROOT, 'sources', 'contacts.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

function validateEmail(email) {
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
  if (!phone) return true;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

function escapeVCard(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function makeVCard({ name, email, phone, organization = '' }) {
  const { firstName, lastName } = splitName(name);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
    `FN:${escapeVCard(name)}`
  ];
  if (organization) lines.push(`ORG:${escapeVCard(organization)};`);
  if (phone) lines.push(`TEL;TYPE=CELL:${escapeVCard(phone)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(email)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

function safeFilename(name) {
  const base = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .trim()
    .replace(/\s+/g, '_') || 'contact';
  return `${base}.vcf`;
}

function extractVCardField(vcard, field) {
  const regex = new RegExp(`^${field}(?:;[^:]*)?:(.*)$`, 'mi');
  const match = String(vcard).match(regex);
  return match ? match[1].trim() : '';
}

function decodeVCardValue(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseVCard(vcard, filename) {
  const fn = decodeVCardValue(extractVCardField(vcard, 'FN')) || filename.replace(/\.vcf$/i, '');
  const email = decodeVCardValue(extractVCardField(vcard, 'EMAIL'));
  const phone = decodeVCardValue(extractVCardField(vcard, 'TEL'));
  return { name: fn, email, phone };
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      filename TEXT NOT NULL UNIQUE,
      vcard TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Importe une seule fois les VCF déjà présents dans le dépôt.
  if (fs.existsSync(seedDocsDir)) {
    const files = await fsp.readdir(seedDocsDir);
    for (const filename of files) {
      if (!filename.toLowerCase().endsWith('.vcf')) continue;
      const existing = await pool.query('SELECT 1 FROM contacts WHERE filename = $1 LIMIT 1', [filename]);
      if (existing.rowCount) continue;
      const vcard = await fsp.readFile(path.join(seedDocsDir, filename), 'utf8');
      const parsed = parseVCard(vcard, filename);
      await pool.query(
        `INSERT INTO contacts (name, email, phone, filename, vcard)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (filename) DO NOTHING`,
        [parsed.name, parsed.email || null, parsed.phone || null, filename, vcard]
      );
    }
  }

  // Si une ancienne version avait déjà contacts.json, importe aussi ses contacts.
  if (fs.existsSync(seedContactsPath)) {
    try {
      const contacts = JSON.parse(await fsp.readFile(seedContactsPath, 'utf8'));
      if (Array.isArray(contacts)) {
        for (const contact of contacts) {
          if (!contact?.filename || !contact?.vcard || !contact?.name) continue;
          await pool.query(
            `INSERT INTO contacts (name, email, phone, filename, vcard, uploaded_at)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
             ON CONFLICT (filename) DO NOTHING`,
            [contact.name, contact.email || null, contact.phone || null, contact.filename, contact.vcard, contact.uploadedAt || null]
          );
        }
      }
    } catch (err) {
      console.warn('contacts.json ignoré :', err.message);
    }
  }
}

async function uniqueFilename(name) {
  const ext = '.vcf';
  const base = name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  let candidate = `${base}${ext}`;
  let i = 2;
  while ((await pool.query('SELECT 1 FROM contacts WHERE filename = $1 LIMIT 1', [candidate])).rowCount) {
    candidate = `${base}_${i}${ext}`;
    i++;
  }
  return candidate;
}

app.post('/contacts', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const organization = String(req.body?.organization || '').trim();

  if (!name) return res.status(400).send('Le nom est requis');
  if (!validateEmail(email)) return res.status(400).send('Email invalide');
  if (!validatePhone(phone)) return res.status(400).send('Numéro de téléphone invalide');

  try {
    const vcard = makeVCard({ name, email, phone, organization });
    const filename = await uniqueFilename(safeFilename(name));
    const result = await pool.query(
      `INSERT INTO contacts (name, email, phone, filename, vcard)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, phone, filename, vcard, uploaded_at AS "uploadedAt"`,
      [name, email || null, phone || null, filename, vcard]
    );
    res.status(201).json({ ok: true, ...result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Impossible d’enregistrer le contact');
  }
});

app.post('/upload-vcf', async (req, res) => {
  const { filename, vcard } = req.body || {};
  if (!filename || !vcard) return res.status(400).send('VCF absent');

  const cleanName = path.basename(String(filename)).replace(/[^\wÀ-ÿ ._-]/g, '');
  if (!cleanName.toLowerCase().endsWith('.vcf')) return res.status(400).send('Le fichier doit être un .vcf');

  try {
    const finalName = await uniqueFilename(cleanName);
    const parsed = parseVCard(String(vcard), finalName);
    await pool.query(
      `INSERT INTO contacts (name, email, phone, filename, vcard)
       VALUES ($1, $2, $3, $4, $5)`,
      [parsed.name, parsed.email || null, parsed.phone || null, finalName, String(vcard)]
    );
    res.status(201).json({ ok: true, filename: finalName });
  } catch (err) {
    console.error(err);
    res.status(500).send('Impossible d’enregistrer la vCard');
  }
});

app.get('/api/vcf-list', async (req, res) => {
  try {
    const result = await pool.query('SELECT filename FROM contacts ORDER BY name COLLATE "C", filename COLLATE "C"');
    res.json({ files: result.rows.map(row => row.filename) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Impossible de lire la liste VCF' });
  }
});

app.get('/documents/:filename', async (req, res) => {
  const filename = path.basename(String(req.params.filename || ''));
  if (!filename.toLowerCase().endsWith('.vcf')) return res.status(400).send('Fichier invalide');

  try {
    const result = await pool.query('SELECT vcard FROM contacts WHERE filename = $1 LIMIT 1', [filename]);
    if (!result.rowCount) return res.status(404).send('VCF introuvable');
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.send(result.rows[0].vcard);
  } catch (err) {
    console.error(err);
    res.status(500).send('Impossible de récupérer la vCard');
  }
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch {
    res.status(503).json({ ok: false, database: 'disconnected' });
  }
});

app.get('/api/contacts', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, filename, uploaded_at AS "uploadedAt" FROM contacts ORDER BY name, filename'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur DB' });
  }
});

app.use(express.static(ROOT));

initDatabase()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Annuaire disponible sur le port ${PORT}`);
      console.log('Stockage : PostgreSQL');
    });
  })
  .catch(err => {
    console.error('Impossible d’initialiser PostgreSQL :', err);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
