import React, { useEffect, useState } from "react";
import './App.css';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';

function Staging() {
  const location = useLocation();
  const [stagingName, setStagingName] = React.useState("");
  const [sqlInput, setSqlInput] = React.useState("");
  const [previewRows, setPreviewRows] = React.useState([]);
  const [previewError, setPreviewError] = React.useState("");
  const [saveStatus, setSaveStatus] = React.useState("");
  const [isPreviewing, setIsPreviewing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [stagings, setStagings] = React.useState([]);
  const [selectedStaging, setSelectedStaging] = React.useState("");
  const [documentation, setDocumentation] = React.useState([]);
  const [dialect, setDialect] = React.useState("sqlite");

  // Load all saved stagings on mount or after save
  React.useEffect(() => {
    fetch("http://localhost:4000/stagings")
      .then(res => res.json())
      .then(data => setStagings(data.stagings || []));
  }, [saveStatus]);

  // Load a selected staging
  React.useEffect(() => {
    if (!selectedStaging) return;
    fetch(`http://localhost:4000/staging/${selectedStaging}`)
      .then(res => res.json())
      .then(data => {
        setStagingName(data.name);
        setSqlInput(data.sql);
        setPreviewRows(data.preview || []);
        setDocumentation(data.documentation || []);
        setDialect(data.dialect || "sqlite");
        setPreviewError("");
        setSaveStatus("");
      });
  }, [selectedStaging]);

  // Auto-load staging if coming from sidebar
  React.useEffect(() => {
    if (location.state && location.state.loadStaging) {
      setSelectedStaging(location.state.loadStaging);
    }
    // eslint-disable-next-line
  }, [location.state]);

  // If navigated from the Staging button, always reset selectedStaging
  React.useEffect(() => {
    if (location.state && location.state.fromStagingButton) {
      setSelectedStaging("");
      setStagingName("");
      setSqlInput("");
      setPreviewRows([]);
      setDocumentation([]);
      setPreviewError("");
      setSaveStatus("");
      setDialect("sqlite");
    }
    // eslint-disable-next-line
  }, [location.state]);

  const handlePreview = async () => {
    setPreviewError("");
    setPreviewRows([]);
    setDocumentation([]);
    setIsPreviewing(true);
    try {
      const res = await fetch("http://localhost:4000/preview-staging-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: sqlInput })
      });
      const data = await res.json();
      if (data.error) {
        setPreviewError(data.error);
      } else {
        setPreviewRows(data.rows);
        // Generate documentation from preview
        if (data.rows && data.rows.length > 0) {
          const keys = Object.keys(data.rows[0]);
          setDocumentation(keys.map(col => ({
            column: col,
            source: col,
            type: typeof data.rows[0][col],
            description: ''
          })));
        } else {
          setDocumentation([]);
        }
      }
    } catch (err) {
      setPreviewError("Failed to preview: " + err.message);
    }
    setIsPreviewing(false);
  };

  const handleSave = async () => {
    setSaveStatus("");
    setIsSaving(true);
    try {
      const res = await fetch("http://localhost:4000/save-staging-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: stagingName, sql: sqlInput, dialect, createTable: true })
      });
      const data = await res.json();
      if (data.success) {
        setSaveStatus("Staging saved successfully!");
        setSelectedStaging(stagingName); // reload this staging
      } else {
        setSaveStatus(data.error || "Failed to save staging.");
      }
    } catch (err) {
      setSaveStatus("Failed to save staging: " + err.message);
    }
    setIsSaving(false);
  };

  return (
    <div style={{ padding: 40, maxWidth: 900, margin: '0 auto' }}>
      <h1>Manual Staging Definition</h1>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        <label style={{ fontWeight: 600 }}>Load Saved Staging:</label>
        <select
          value={selectedStaging}
          onChange={e => setSelectedStaging(e.target.value)}
          style={{ fontSize: 16, padding: 8, borderRadius: 4, border: '1px solid #ccc', minWidth: 220 }}
        >
          <option value="">-- Select --</option>
          {stagings.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 600 }}>Staging Name</label><br />
        <input
          type="text"
          value={stagingName}
          onChange={e => setStagingName(e.target.value)}
          placeholder="e.g. stg_products_transformed"
          style={{ width: 400, fontSize: 16, padding: 8, borderRadius: 4, border: '1px solid #ccc', marginTop: 4 }}
        />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 600 }}>SQL Query (SQLite dialect)</label><br />
        <textarea
          value={sqlInput}
          onChange={e => setSqlInput(e.target.value)}
          placeholder={"Write your SQL transformation here.\nExample: SELECT id, LOWER(name) AS name_cleaned FROM raw_customers WHERE name IS NOT NULL;"}
          style={{ width: '100%', minHeight: 120, fontSize: 15, padding: 8, borderRadius: 4, border: '1px solid #ccc', marginTop: 4 }}
        />
      </div>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={handlePreview}
          disabled={!sqlInput.trim() || isPreviewing}
          style={{ padding: '10px 24px', fontSize: 16, background: '#36f', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, marginRight: 16 }}
        >
          {isPreviewing ? 'Previewing...' : 'Preview'}
        </button>
        <button
          onClick={handleSave}
          disabled={!stagingName.trim() || !sqlInput.trim() || isSaving}
          style={{ padding: '10px 24px', fontSize: 16, background: '#00b887', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
        >
          {isSaving ? 'Saving...' : 'Save Staging'}
        </button>
        {saveStatus && <span style={{ marginLeft: 18, color: saveStatus.includes('success') ? '#00b887' : 'red', fontWeight: 600 }}>{saveStatus}</span>}
      </div>
      {documentation.length > 0 && (
        <div style={{ marginTop: 24, background: '#f7fafc', borderRadius: 8, boxShadow: '0 2px 8px #0001', padding: 10 }}>
          <h3 style={{ marginTop: 0 }}>Documentation</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ background: '#e4e9f2', color: '#222b45', padding: '4px 6px', borderBottom: '2px solid #c5cee0', fontWeight: 600 }}>Column Name</th>
                <th style={{ background: '#e4e9f2', color: '#222b45', padding: '4px 6px', borderBottom: '2px solid #c5cee0', fontWeight: 600 }}>Source Column</th>
                <th style={{ background: '#e4e9f2', color: '#222b45', padding: '4px 6px', borderBottom: '2px solid #c5cee0', fontWeight: 600 }}>Data Type</th>
                <th style={{ background: '#e4e9f2', color: '#222b45', padding: '4px 6px', borderBottom: '2px solid #c5cee0', fontWeight: 600 }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {documentation.map((col, idx) => (
                <tr key={col.column + idx}>
                  <td style={{ padding: '4px 6px', borderBottom: '1px solid #e4e9f2' }}>{col.column}</td>
                  <td style={{ padding: '4px 6px', borderBottom: '1px solid #e4e9f2' }}>{col.source}</td>
                  <td style={{ padding: '4px 6px', borderBottom: '1px solid #e4e9f2' }}>{col.type}</td>
                  <td style={{ padding: '4px 6px', borderBottom: '1px solid #e4e9f2' }}>{col.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {previewError && <div style={{ color: 'red', marginBottom: 16 }}>{previewError}</div>}
      {previewRows.length > 0 && (
        <div style={{ marginTop: 24, background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px #0001', padding: 10 }}>
          <h3 style={{ marginTop: 0 }}>Preview Result (up to 100 rows)</h3>
          <div style={{ overflow: 'auto', maxHeight: 400 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  {Object.keys(previewRows[0]).map(key => (
                    <th key={key} style={{ background: '#f7fafc', color: '#222b45', padding: '4px 6px', borderBottom: '2px solid #e4e9f2', position: 'sticky', top: 0, fontWeight: 600 }}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => (
                  <tr key={idx} style={{ background: idx % 2 === 0 ? '#f7fafc' : '#fff', height: 28 }}>
                    {Object.values(row).map((val, i) => (
                      <td key={i} style={{ padding: '4px 6px', borderBottom: '1px solid #e4e9f2', color: '#333', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarNav({ tables, selectedTable, setSelectedTable, sidebarStagings }) {
  // Single-select accordion state
  const [openSection, setOpenSection] = useState(null); // 'tables' | 'staging' | null
  const navigate = useNavigate();

  // Effect: When switching to 'staging', clear selected table
  React.useEffect(() => {
    if (openSection === 'staging') {
      setSelectedTable('');
    }
  }, [openSection, setSelectedTable]);

  // Filter out staging tables (those starting with 'stg_' or 'staging' or containing 'hpjpp')
  const filteredTables = tables.filter(
    t => !t.toLowerCase().startsWith('stg_') &&
         !t.toLowerCase().startsWith('staging') &&
         !t.toLowerCase().includes('stg') &&
         !t.toLowerCase().includes('staging') &&
         !t.toLowerCase().includes('hpjpp')
  );

  return (
    <aside style={{ width: 220, background: '#222b45', color: '#fff', padding: 0, boxShadow: '2px 0 8px #0001', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '24px 0 0 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ color: '#8f9bb3', fontWeight: 700, fontSize: 15, padding: '0 0 18px 26px', letterSpacing: 1 }}>Menu</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', width: '100%' }}>
          {/* Tables Accordion Button */}
          <button
            onClick={() => setOpenSection(openSection === 'tables' ? null : 'tables')}
            style={{
              background: 'linear-gradient(90deg, #00d68f 0%, #36f 100%)',
              borderRadius: 8,
              boxShadow: '0 1.5px 6px #0001',
              padding: '10px 0',
              margin: 0,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              userSelect: 'none',
              justifyContent: 'center',
              gap: 8,
              border: '1.5px solid #00d68f',
              cursor: 'pointer',
              textDecoration: 'none',
              color: '#fff',
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: 1,
              textShadow: '0 1px 4px #0001',
              transition: 'box-shadow 0.2s, border 0.2s',
              minWidth: 0,
            }}
          >
            Tables
            <span style={{ marginLeft: 8 }}>{openSection === 'tables' ? '▲' : '▼'}</span>
          </button>
          {openSection === 'tables' && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0 0' }}>
              {filteredTables.map(table => (
                <li key={table}>
                  <button
                    style={{
                      width: '100%',
                      background: selectedTable === table ? '#00d68f' : 'transparent',
                      color: selectedTable === table ? '#222b45' : '#fff',
                      border: 'none',
                      padding: '10px 12px',
                      marginBottom: 6,
                      borderRadius: 6,
                      cursor: openSection === 'tables' ? 'pointer' : 'not-allowed',
                      textAlign: 'left',
                      fontWeight: selectedTable === table ? 700 : 400,
                      transition: 'background 0.2s, color 0.2s',
                      opacity: openSection === 'tables' ? 1 : 0.5,
                    }}
                    disabled={openSection !== 'tables'}
                    onClick={() => {
                      if (openSection === 'tables') {
                        setSelectedTable(table);
                        navigate('/');
                      }
                    }}
                  >
                    {table}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Staging Accordion Button */}
          <button
            onClick={() => setOpenSection(openSection === 'staging' ? null : 'staging')}
            style={{
              background: 'linear-gradient(90deg, #36f 0%, #00d68f 100%)',
              borderRadius: 8,
              boxShadow: '0 1.5px 6px #0001',
              padding: '10px 0',
              margin: 0,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              userSelect: 'none',
              justifyContent: 'center',
              gap: 8,
              border: '1.5px solid #36f',
              cursor: 'pointer',
              textDecoration: 'none',
              color: '#fff',
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: 1,
              textShadow: '0 1px 4px #0001',
              transition: 'box-shadow 0.2s, border 0.2s',
              minWidth: 0,
            }}
          >
            Staging
            <span style={{ marginLeft: 8 }}>{openSection === 'staging' ? '▲' : '▼'}</span>
          </button>
          {openSection === 'staging' && (
            <div style={{ marginTop: -8, marginBottom: 12, paddingLeft: 8 }}>
              <div style={{ color: '#8f9bb3', fontSize: 13, marginBottom: 4, marginLeft: 2 }}>Saved Stagings</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sidebarStagings.length === 0 && (
                  <li style={{ color: '#8f9bb3', fontSize: 13, padding: '6px 10px' }}>No stagings saved.</li>
                )}
                {sidebarStagings.map(name => (
                  <li key={name}>
                    <Link
                      to={`/staging`}
                      state={{ loadStaging: name }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, color: '#fff', textDecoration: 'none',
                        background: '#232f45', borderRadius: 6, padding: '10px 0', fontSize: 14, fontWeight: 500,
                        transition: 'background 0.15s',
                        width: '100%',
                        margin: 0,
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="5" width="14" height="10" rx="2" fill="#36f" fillOpacity="0.12" stroke="#36f" strokeWidth="1.2"/>
                        <rect x="5.5" y="7.5" width="9" height="5" rx="1" fill="#00b887" fillOpacity="0.18" stroke="#00b887" strokeWidth="0.8"/>
                      </svg>
                      {name}
                    </Link>
                  </li>
                ))}
                {/* New Staging Button */}
                <button
                  onClick={() => navigate('/staging', { state: { fromStagingButton: true } })}
                  style={{
                    marginTop: 10,
                    background: '#36f',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '10px 0',
                    fontWeight: 600,
                    fontSize: 15,
                    cursor: 'pointer',
                    width: '100%',
                    boxShadow: '0 1px 4px #0002',
                    transition: 'background 0.2s',
                  }}
                >
                  + New Staging
                </button>
              </ul>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function App() {
  const [tables, setTables] = useState([]);
  const [showTables, setShowTables] = useState(false); // Toggle for table list
  const [selectedTable, setSelectedTable] = useState("");
  const [tableData, setTableData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sidebarStagings, setSidebarStagings] = useState([]);

  useEffect(() => {
    fetch("http://localhost:4000/tables")
      .then(res => res.json())
      .then(tableList => {
        setTables(tableList);
        // Auto-select 'data(1)' if it exists
        if (tableList.includes('data(1)')) {
          setSelectedTable('data(1)');
        }
      })
      .catch(() => setError("Could not fetch tables from backend."));
    // Fetch stagings for sidebar
    fetch("http://localhost:4000/stagings")
      .then(res => res.json())
      .then(data => setSidebarStagings(data.stagings || []));
  }, []);

  useEffect(() => {
    if (!selectedTable) return;
    setLoading(true);
    setError("");
    fetch(`http://localhost:4000/table/${selectedTable}`)
      .then(res => res.json())
      .then(data => {
        setTableData(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not fetch table data.");
        setLoading(false);
      });
  }, [selectedTable]);

  return (
    <Router>
      <div style={{ display: 'flex', minHeight: '100vh', background: '#f4f6fa' }}>
        <SidebarNav
          tables={tables}
          selectedTable={selectedTable}
          setSelectedTable={setSelectedTable}
          sidebarStagings={sidebarStagings}
        />
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/" element={
              <div style={{ padding: 40 }}>
                <header style={{ marginBottom: 32 }}>
                  <h1 style={{ fontSize: 32, color: '#222b45', margin: 0 }}>SQLite Database Viewer</h1>
                  <p style={{ color: '#8f9bb3', marginTop: 8 }}>Select a table from the sidebar to view its data.</p>
                </header>
                {error && <div style={{ color: 'red', marginBottom: 16 }}>{error}</div>}
                {/* Show a message if no table is selected */}
                {!selectedTable && (
                  <div style={{ color: '#8f9bb3', fontSize: 18, marginTop: 80, textAlign: 'center' }}>
                    <span>Click a table name on the left to view its data.</span>
                  </div>
                )}
                {selectedTable && (
                  <>
                    <div style={{ marginBottom: 24, background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px #0001', padding: 20, display: 'inline-block' }}>
                      <h2 style={{ margin: 0, color: '#00b887', fontSize: 22 }}>{selectedTable}</h2>
                      <span style={{ color: '#8f9bb3', fontSize: 14 }}>Rows: {tableData.length}</span>
                    </div>
                    {loading && <p>Loading table data...</p>}
                    {!loading && tableData.length === 0 && (
                      <p style={{ color: '#8f9bb3' }}>No data in this table.</p>
                    )}
                    {tableData.length > 0 && (
                      <div style={{ overflow: 'auto', maxHeight: 600, background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px #0001', padding: 10 }}>
                        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                          <thead>
                            <tr>
                              {Object.keys(tableData[0]).map(key => (
                                <th key={key} style={{ background: '#f7fafc', color: '#222b45', padding: '4px 6px', borderBottom: '2px solid #e4e9f2', position: 'sticky', top: 0, fontWeight: 600 }}>{key}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tableData.map((row, idx) => (
                              <tr key={idx} style={{ background: idx % 2 === 0 ? '#f7fafc' : '#fff', height: 28 }}>
                                {Object.values(row).map((val, i) => (
                                  <td key={i} style={{ padding: '4px 6px', borderBottom: '1px solid #e4e9f2', color: '#333', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(val)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            } />
            <Route path="/staging" element={<Staging />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
