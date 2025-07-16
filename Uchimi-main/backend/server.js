const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 4000;
// This backend serves data only from the Northwind sample database.
const DB_PATH = path.join(__dirname, '../northwind_small.sqlite');
const METADATA_DIR = path.join(__dirname, '../models/staging/metadata');
fs.mkdirSync(METADATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

function toSnakeCase(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/__+/g, '_')
    .toLowerCase();
}

function detectType(values) {
  // Try to detect if all values are numbers or dates
  if (values.every(v => v === null || v === '' || !isNaN(Number(v)))) return 'number';
  if (values.every(v => v === null || v === '' || !isNaN(Date.parse(v)))) return 'date';
  return 'string';
}

// List all tables in the SQLite database
app.get('/tables', (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(row => row.name));
  });
});

// Get all data from a specific table
app.get('/table/:name', (req, res) => {
  const tableName = req.params.name;
  const db = new sqlite3.Database(DB_PATH);
  db.all(`SELECT * FROM "${tableName}"`, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Save generated staging model SQL
app.post('/generate-staging-model', (req, res) => {
  const { table, sql } = req.body;
  if (!table || !sql) return res.status(400).json({ error: 'Missing table or sql' });
  const filePath = path.join(__dirname, '../models/staging', `stg_${table}.sql`);
  fs.writeFile(filePath, sql, err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, file: filePath });
  });
});

app.post('/generate-user-model', (req, res) => {
  const { name, sql } = req.body;
  if (!name || !sql) return res.status(400).json({ error: 'Missing name or sql' });
  const filePath = path.join(__dirname, '../models/marts', `${name}.sql`);
  fs.mkdir(path.join(__dirname, '../models/marts'), { recursive: true }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    fs.writeFile(filePath, sql, err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, file: filePath });
    });
  });
});

// Preview custom staging SQL (returns up to 100 rows)
app.post('/preview-staging-sql', (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'Missing SQL' });
  let previewSQL = sql.trim();
  // Add LIMIT 100 if not present
  if (!/limit\s+\d+/i.test(previewSQL)) {
    previewSQL = previewSQL.replace(/;*\s*$/, '') + ' LIMIT 100';
  }
  const db = new sqlite3.Database(DB_PATH);
  db.all(previewSQL, (err, rows) => {
    db.close();
    if (err) return res.status(400).json({ error: err.message });
    res.json({ rows });
  });
});

// List all saved stagings
app.get('/stagings', (req, res) => {
  fs.readdir(METADATA_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: err.message });
    const names = files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    res.json({ stagings: names });
  });
});

// Get a specific staging (SQL, doc, preview)
app.get('/staging/:name', (req, res) => {
  const metaPath = path.join(METADATA_DIR, `${req.params.name}.json`);
  fs.readFile(metaPath, 'utf8', (err, data) => {
    if (err) return res.status(404).json({ error: 'Staging not found' });
    res.json(JSON.parse(data));
  });
});

// Save custom staging SQL as dbt model and with metadata
app.post('/save-staging-sql', (req, res) => {
  const { name, sql, dialect = 'sqlite', createTable } = req.body;
  if (!name || !sql) return res.status(400).json({ error: 'Missing name or SQL' });
  const filePath = path.join(__dirname, '../models/staging', `${name}.sql`);
  fs.writeFile(filePath, sql, async err => {
    if (err) return res.status(500).json({ error: err.message });
    let preview = [];
    let doc = [];
    let tableCreated = false;
    let tableError = null;
    // Preview and doc generation
    let previewSQL = sql.trim();
    if (!/limit\s+\d+/i.test(previewSQL)) {
      previewSQL = previewSQL.replace(/;*\s*$/, '') + ' LIMIT 100';
    }
    const db = new sqlite3.Database(DB_PATH);
    try {
      preview = await new Promise((resolve, reject) => {
        db.all(previewSQL, (err, rows) => err ? reject(err) : resolve(rows));
      });
      // Exclude columns with all NULLs
      if (preview.length > 0) {
        const keys = Object.keys(preview[0]);
        const nonNullCols = keys.filter(k => preview.some(row => row[k] !== null && row[k] !== ''));
        preview = preview.map(row => {
          const filtered = {};
          nonNullCols.forEach(k => { filtered[k] = row[k]; });
          return filtered;
        });
        // Documentation
        doc = nonNullCols.map(col => ({
          column: col,
          source: col, // Could be improved with SQL parsing for aliases
          type: typeof preview[0][col],
          description: ''
        }));
      }
    } catch (e) {
      preview = [];
      doc = [];
    }
    // Optionally create table
    if (createTable) {
      try {
        await new Promise((resolve, reject) => {
          db.run(`DROP TABLE IF EXISTS "${name}"`, err => err ? reject(err) : resolve());
        });
        const selectSQL = sql.trim().replace(/;\s*$/, '');
        await new Promise((resolve, reject) => {
          db.run(`CREATE TABLE "${name}" AS ${selectSQL}`, err => err ? reject(err) : resolve());
        });
        tableCreated = true;
      } catch (e) {
        tableError = e.message;
      }
    }
    db.close();
    // Save metadata
    const meta = {
      name,
      sql,
      dialect,
      documentation: doc,
      preview,
      timestamp: new Date().toISOString()
    };
    fs.writeFile(path.join(METADATA_DIR, `${name}.json`), JSON.stringify(meta, null, 2), err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, file: filePath, tableCreated, tableError, meta });
    });
  });
});

// Endpoint to drop all staged tables (names starting with 'stg_')
app.post('/drop-staged-tables', (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'stg_%'`, (err, rows) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: err.message });
    }
    const tables = rows.map(r => r.name);
    let dropped = 0;
    let errors = [];
    if (tables.length === 0) {
      db.close();
      return res.json({ success: true, dropped: 0 });
    }
    tables.forEach(table => {
      db.run(`DROP TABLE IF EXISTS "${table}"`, err => {
        if (err) errors.push({ table, error: err.message });
        dropped++;
        if (dropped === tables.length) {
          db.close();
          if (errors.length > 0) {
            res.status(500).json({ error: 'Some tables could not be dropped', details: errors });
          } else {
            res.json({ success: true, dropped });
          }
        }
      });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 