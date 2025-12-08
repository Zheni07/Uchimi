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

// Auto-documentation preview endpoint
app.post('/api/preview', async (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'Missing SQL' });
  let previewSQL = sql.trim();
  if (!/limit\s+\d+/i.test(previewSQL)) {
    previewSQL = previewSQL.replace(/;*\s*$/, '') + ' LIMIT 100';
  }
  const db = new sqlite3.Database(DB_PATH);
  try {
    const preview = await new Promise((resolve, reject) => {
      db.all(previewSQL, (err, rows) => err ? reject(err) : resolve(rows));
    });
    let columns = [];
    if (preview.length > 0) {
      const keys = Object.keys(preview[0]);
      columns = keys.map(col => {
        const values = preview.map(row => row[col]);
        const nonNullValues = values.filter(v => v !== null && v !== '');
        const type = detectType(nonNullValues);
        const nullable = values.some(v => v === null || v === '');
        const unique = new Set(nonNullValues).size === nonNullValues.length && nonNullValues.length === preview.length;
        return {
          name: col,
          type,
          nullable,
          unique,
        };
      });
    }
    db.close();
    res.json({ columns, preview });
  } catch (e) {
    db.close();
    res.status(400).json({ error: e.message });
  }
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

// Delete a saved staging (metadata, SQL file, and drop table)
app.delete('/staging/:name', (req, res) => {
  const name = req.params.name;
  const metaPath = path.join(METADATA_DIR, `${name}.json`);
  const sqlPath = path.join(__dirname, '../models/staging', `${name}.sql`);
  let errors = [];
  // Delete metadata JSON
  try { fs.unlinkSync(metaPath); } catch (e) { errors.push(e.message); }
  // Delete SQL file
  try { fs.unlinkSync(sqlPath); } catch (e) { errors.push(e.message); }
  // Drop table from SQLite database
  const db = new sqlite3.Database(DB_PATH);
  db.run(`DROP TABLE IF EXISTS "${name}"`, (err) => {
    db.close();
    if (err) errors.push(err.message);
    if (errors.length > 0) {
      return res.status(500).json({ error: 'Failed to delete some files or table', details: errors });
    }
    res.json({ success: true });
  });
});

// Utility to generate dbt-compatible YAML schema
function generateDbtYaml({ name, description, columns }) {
  return [
    'version: 2',
    '',
    'models:',
    `  - name: ${name}`,
    `    description: "${description || ''}"`,
    '    columns:',
    ...columns.map(col => {
      const tests = [];
      if (!col.nullable) tests.push('not_null');
      if (col.unique) tests.push('unique');
      return [
        `      - name: ${col.name}`,
        `        description: "${col.description || ''}"`,
        `        data_type: ${col.type}`,
        ...(tests.length ? ['        tests:'].concat(tests.map(t => `          - ${t}`)) : [])
      ].join('\n');
    })
  ].join('\n');
}

// Save custom staging SQL as dbt model and with metadata
app.post('/save-staging-sql', (req, res) => {
  const { name, sql, dialect = 'sqlite', createTable, documentation, tableDescription, yaml } = req.body;
  if (!name || !sql) return res.status(400).json({ error: 'Missing name or SQL' });
  const filePath = path.join(__dirname, '../models/staging', `${name}.sql`);
  fs.writeFile(filePath, sql, async err => {
    if (err) return res.status(500).json({ error: err.message });
    let preview = [];
    let doc = documentation || [];
    let tableCreated = false;
    let tableError = null;
    let yamlSchema = yaml;
    // Preview and doc generation if not provided
    let previewSQL = sql.trim();
    if (!/limit\s+\d+/i.test(previewSQL)) {
      previewSQL = previewSQL.replace(/;*\s*$/, '') + ' LIMIT 100';
    }
    const db = new sqlite3.Database(DB_PATH);
    try {
      preview = await new Promise((resolve, reject) => {
        db.all(previewSQL, (err, rows) => err ? reject(err) : resolve(rows));
      });
      // Normalize documentation structure: ensure 'name' field exists (support both 'column' and 'name')
      if (doc && doc.length > 0) {
        doc = doc.map(col => {
          const normalized = {
            ...col,
            name: col.name || col.column || col.source || col.original || '',
            // Preserve all custom fields
            description: col.description || '',
            type: col.type || typeof preview[0]?.[col.name || col.column] || 'string',
            nullable: col.nullable !== undefined ? col.nullable : (preview.length > 0 ? preview.some(row => row[col.name || col.column] === null || row[col.name || col.column] === '') : false),
            unique: col.unique !== undefined ? col.unique : (preview.length > 0 ? new Set(preview.map(row => row[col.name || col.column])).size === preview.length : false),
            testNull: col.testNull || false,
            testUnique: col.testUnique || false
          };
          // Remove old field names to avoid confusion
          delete normalized.column;
          return normalized;
        });
      } else if (preview.length > 0) {
        // Generate new documentation if none provided
        const keys = Object.keys(preview[0]);
        doc = keys.map(col => ({
          name: col,
          type: typeof preview[0][col],
          description: '',
          nullable: preview.some(row => row[col] === null || row[col] === ''),
          unique: new Set(preview.map(row => row[col])).size === preview.length,
          testNull: false,
          testUnique: false
        }));
      }
    } catch (e) {
      preview = [];
      // Normalize documentation even if preview fails
      if (doc && doc.length > 0) {
        doc = doc.map(col => ({
          ...col,
          name: col.name || col.column || col.source || col.original || '',
          description: col.description || '',
          type: col.type || 'string',
          nullable: col.nullable !== undefined ? col.nullable : false,
          unique: col.unique !== undefined ? col.unique : false,
          testNull: col.testNull || false,
          testUnique: col.testUnique || false
        })).map(col => {
          delete col.column;
          return col;
        });
      } else {
        doc = [];
      }
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
    // Generate YAML if not provided
    if (!yamlSchema) {
      yamlSchema = generateDbtYaml({ name, description: tableDescription, columns: doc });
    }
    // Save metadata
    const meta = {
      name,
      sql,
      dialect,
      tableDescription: tableDescription || '',
      documentation: doc,
      yaml: yamlSchema,
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

// Download entire staged table as CSV
app.get('/download-staged/:name', (req, res) => {
  const tableName = req.params.name;
  // Only allow staged tables
  if (!tableName.startsWith('stg_')) {
    return res.status(400).json({ error: 'Not a staged table' });
  }
  const db = new sqlite3.Database(DB_PATH);
  db.all(`SELECT * FROM "${tableName}"`, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    if (!rows || rows.length === 0) {
      res.setHeader('Content-Disposition', `attachment; filename="${tableName}.csv"`);
      res.setHeader('Content-Type', 'text/csv');
      return res.send('');
    }
    const keys = Object.keys(rows[0]);
    const csvRows = [keys.join(',')];
    for (const row of rows) {
      csvRows.push(keys.map(k => {
        const val = row[k];
        if (val == null) return '';
        // Escape quotes
        return '"' + String(val).replace(/"/g, '""') + '"';
      }).join(','));
    }
    const csv = csvRows.join('\n');
    res.setHeader('Content-Disposition', `attachment; filename="${tableName}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  });
});

// --- Curated Models Layer ---
const CURATED_DIR = path.join(__dirname, '../models/curated');
const CURATED_META_DIR = path.join(CURATED_DIR, 'metadata');
fs.mkdirSync(CURATED_META_DIR, { recursive: true });

// List all curated models
app.get('/curated-models', (req, res) => {
  fs.readdir(CURATED_META_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: err.message });
    const names = files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    res.json({ models: names });
  });
});

// Get a specific curated model (SQL, doc, preview)
app.get('/curated-model/:name', (req, res) => {
  const metaPath = path.join(CURATED_META_DIR, `${req.params.name}.json`);
  fs.readFile(metaPath, 'utf8', (err, data) => {
    if (err) return res.status(404).json({ error: 'Curated model not found' });
    res.json(JSON.parse(data));
  });
});

// Save or update a curated model
app.post('/curated-models', async (req, res) => {
  const { name, sql, documentation, tableDescription } = req.body;
  if (!name || !sql) return res.status(400).json({ error: 'Missing name or SQL' });
  const filePath = path.join(CURATED_DIR, `${name}.sql`);
  fs.writeFileSync(filePath, sql);
  // Preview and doc generation if not provided
  let preview = [];
  let doc = documentation || [];
  let previewSQL = sql.trim();
  if (!/limit\s+\d+/i.test(previewSQL)) {
    previewSQL = previewSQL.replace(/;*\s*$/, '') + ' LIMIT 100';
  }
  const db = new sqlite3.Database(DB_PATH);
  try {
    preview = await new Promise((resolve, reject) => {
      db.all(previewSQL, (err, rows) => err ? reject(err) : resolve(rows));
    });
    // Normalize documentation structure: ensure 'name' field exists and preserve all fields
    if (doc && doc.length > 0) {
      doc = doc.map(col => {
        const normalized = {
          ...col,
          name: col.name || col.column || col.source || col.original || '',
          // Preserve all custom fields
          description: col.description || '',
          type: col.type || typeof preview[0]?.[col.name || col.column] || 'string',
          nullable: col.nullable !== undefined ? col.nullable : (preview.length > 0 ? preview.some(row => row[col.name || col.column] === null || row[col.name || col.column] === '') : false),
          unique: col.unique !== undefined ? col.unique : (preview.length > 0 ? new Set(preview.map(row => row[col.name || col.column])).size === preview.length : false),
          testNull: col.testNull || false,
          testUnique: col.testUnique || false
        };
        // Remove old field names to avoid confusion
        delete normalized.column;
        return normalized;
      });
    } else if (preview.length > 0) {
      // Generate new documentation if none provided
      const keys = Object.keys(preview[0]);
      doc = keys.map(col => {
        const values = preview.map(row => row[col]);
        const nonNullValues = values.filter(v => v !== null && v !== '');
        return {
          name: col,
          type: typeof preview[0][col],
          description: '',
          nullable: values.some(v => v === null || v === ''),
          unique: new Set(nonNullValues).size === nonNullValues.length && nonNullValues.length === preview.length,
          testNull: false,
          testUnique: false
        };
      });
    }
  } catch (e) {
    preview = [];
    // Normalize documentation even if preview fails
    if (doc && doc.length > 0) {
      doc = doc.map(col => ({
        ...col,
        name: col.name || col.column || col.source || col.original || '',
        description: col.description || '',
        type: col.type || 'string',
        nullable: col.nullable !== undefined ? col.nullable : false,
        unique: col.unique !== undefined ? col.unique : false,
        testNull: col.testNull || false,
        testUnique: col.testUnique || false
      })).map(col => {
        delete col.column;
        return col;
      });
    } else {
      doc = [];
    }
  }
  db.close();
  // Save metadata
  const meta = {
    name,
    sql,
    tableDescription: tableDescription || '',
    documentation: doc,
    preview,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(path.join(CURATED_META_DIR, `${name}.json`), JSON.stringify(meta, null, 2));
  res.json({ success: true, file: filePath, meta });
});

// Preview custom curated SQL (returns up to 100 rows and docs)
app.post('/api/curated-preview', async (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'Missing SQL' });
  let previewSQL = sql.trim();
  if (!/limit\s+\d+/i.test(previewSQL)) {
    previewSQL = previewSQL.replace(/;*\s*$/, '') + ' LIMIT 100';
  }
  const db = new sqlite3.Database(DB_PATH);
  try {
    const preview = await new Promise((resolve, reject) => {
      db.all(previewSQL, (err, rows) => err ? reject(err) : resolve(rows));
    });
    let columns = [];
    if (preview.length > 0) {
      const keys = Object.keys(preview[0]);
      columns = keys.map(col => {
        const values = preview.map(row => row[col]);
        const nonNullValues = values.filter(v => v !== null && v !== '');
        const type = detectType(nonNullValues);
        const nullable = values.some(v => v === null || v === '');
        const unique = new Set(nonNullValues).size === nonNullValues.length && nonNullValues.length === preview.length;
        return {
          name: col,
          type,
          nullable,
          unique,
        };
      });
    }
    db.close();
    res.json({ columns, preview });
  } catch (e) {
    db.close();
    res.status(400).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 