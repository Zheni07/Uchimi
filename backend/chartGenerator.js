const fs = require('fs');
const path = require('path');

/**
 * Generate HTML charts from data preview
 * Creates various chart types based on column types and data patterns
 */
function generateCharts(name, preview, documentation) {
  if (!preview || preview.length === 0) {
    return null;
  }

  const charts = [];
  const numericCols = documentation
    .filter(col => col.type === 'number' || col.type === 'integer')
    .map(col => col.name);

  const stringCols = documentation
    .filter(col => col.type === 'string')
    .map(col => col.name);

  const dateCols = documentation
    .filter(col => col.type === 'date')
    .map(col => col.name);

  // 1. Numeric columns - Bar/Line chart for first two numeric columns
  if (numericCols.length >= 1) {
    const col = numericCols[0];
    const values = preview.map(row => row[col]).filter(v => v !== null && v !== '');
    
    if (values.length > 0) {
      const stats = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
        count: values.length
      };

      charts.push({
        type: 'distribution',
        title: `${col} Distribution`,
        column: col,
        stats
      });
    }
  }

  // 2. String columns - Pie/Donut chart for category distribution
  if (stringCols.length >= 1) {
    const col = stringCols[0];
    const values = preview.map(row => row[col]).filter(v => v !== null && v !== '');
    const valueCount = {};
    
    values.forEach(val => {
      valueCount[val] = (valueCount[val] || 0) + 1;
    });

    if (Object.keys(valueCount).length > 0 && Object.keys(valueCount).length <= 20) {
      charts.push({
        type: 'category',
        title: `${col} Distribution`,
        column: col,
        data: valueCount
      });
    }
  }

  // 3. Date columns - Timeline chart
  if (dateCols.length >= 1) {
    const col = dateCols[0];
    const values = preview.map(row => row[col]).filter(v => v !== null && v !== '');
    
    if (values.length > 0) {
      charts.push({
        type: 'timeline',
        title: `${col} Timeline`,
        column: col,
        count: values.length
      });
    }
  }

  // 4. Multi-column analysis if multiple numeric columns exist
  if (numericCols.length >= 2) {
    charts.push({
      type: 'correlation',
      title: 'Numeric Columns Overview',
      columns: numericCols.slice(0, 3)
    });
  }

  return charts;
}

/**
 * Generate HTML report with embedded charts using Chart.js
 */
function generateHTMLReport(name, preview, documentation, charts) {
  if (!charts || charts.length === 0) {
    return null;
  }

  let canvases = '';
  let chartScripts = '';
  let chartIndex = 0;

  for (const chart of charts) {
    const canvasId = `chart-${chartIndex}`;
    canvases += `<div class="chart-container"><canvas id="${canvasId}"></canvas></div>\n`;

    if (chart.type === 'distribution') {
      const col = chart.column;
      const values = preview.map(row => row[col]).filter(v => v !== null && v !== '');
      const binCount = Math.min(20, Math.ceil(Math.sqrt(values.length)));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const binSize = (max - min) / binCount || 1;
      const bins = Array(binCount).fill(0);
      const binLabels = [];

      values.forEach(val => {
        const binIndex = Math.min(Math.floor((val - min) / binSize), binCount - 1);
        bins[binIndex]++;
      });

      for (let i = 0; i < binCount; i++) {
        const start = (min + i * binSize).toFixed(2);
        const end = (min + (i + 1) * binSize).toFixed(2);
        binLabels.push(`${start}-${end}`);
      }

      chartScripts += `
        new Chart(document.getElementById('${canvasId}'), {
          type: 'bar',
          data: {
            labels: ${JSON.stringify(binLabels)},
            datasets: [{
              label: '${chart.column}',
              data: ${JSON.stringify(bins)},
              backgroundColor: 'rgba(75, 192, 192, 0.7)',
              borderColor: 'rgba(75, 192, 192, 1)',
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            plugins: { title: { display: true, text: '${chart.title}' } },
            scales: { y: { beginAtZero: true } }
          }
        });
      `;
    } else if (chart.type === 'category') {
      const labels = Object.keys(chart.data);
      const data = Object.values(chart.data);

      chartScripts += `
        new Chart(document.getElementById('${canvasId}'), {
          type: 'doughnut',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [{
              data: ${JSON.stringify(data)},
              backgroundColor: [
                'rgba(255, 99, 132, 0.7)',
                'rgba(54, 162, 235, 0.7)',
                'rgba(255, 206, 86, 0.7)',
                'rgba(75, 192, 192, 0.7)',
                'rgba(153, 102, 255, 0.7)',
                'rgba(255, 159, 64, 0.7)'
              ],
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            plugins: { title: { display: true, text: '${chart.title}' } }
          }
        });
      `;
    } else if (chart.type === 'timeline') {
      const col = chart.column;
      const values = preview.map(row => row[col]).filter(v => v !== null && v !== '');
      const sortedDates = values.sort();
      const dateCount = {};

      sortedDates.forEach(date => {
        const dateStr = new Date(date).toISOString().split('T')[0];
        dateCount[dateStr] = (dateCount[dateStr] || 0) + 1;
      });

      const dates = Object.keys(dateCount).sort();
      const counts = dates.map(d => dateCount[d]);

      chartScripts += `
        new Chart(document.getElementById('${canvasId}'), {
          type: 'line',
          data: {
            labels: ${JSON.stringify(dates)},
            datasets: [{
              label: '${chart.column}',
              data: ${JSON.stringify(counts)},
              borderColor: 'rgba(75, 192, 192, 1)',
              backgroundColor: 'rgba(75, 192, 192, 0.1)',
              tension: 0.1,
              fill: true
            }]
          },
          options: {
            responsive: true,
            plugins: { title: { display: true, text: '${chart.title}' } },
            scales: { y: { beginAtZero: true } }
          }
        });
      `;
    } else if (chart.type === 'correlation') {
      const cols = chart.columns;
      const summary = cols.map(col => {
        const values = preview.map(row => row[col]).filter(v => v !== null && v !== '');
        return {
          col,
          avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
          count: values.length
        };
      });

      chartScripts += `
        new Chart(document.getElementById('${canvasId}'), {
          type: 'radar',
          data: {
            labels: ${JSON.stringify(summary.map(s => s.col))},
            datasets: [{
              label: 'Average Value',
              data: ${JSON.stringify(summary.map(s => s.avg))},
              borderColor: 'rgba(75, 192, 192, 1)',
              backgroundColor: 'rgba(75, 192, 192, 0.2)'
            }]
          },
          options: {
            responsive: true,
            plugins: { title: { display: true, text: '${chart.title}' } }
          }
        });
      `;
    }

    chartIndex++;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} - Data Charts</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    .header h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
    }
    .header p {
      font-size: 1.1em;
      opacity: 0.9;
    }
    .content {
      padding: 40px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .stat-card {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #667eea;
    }
    .stat-card label {
      display: block;
      font-size: 0.9em;
      color: #666;
      margin-bottom: 8px;
    }
    .stat-card value {
      display: block;
      font-size: 1.8em;
      font-weight: bold;
      color: #333;
    }
    .charts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 30px;
    }
    .chart-container {
      position: relative;
      height: 400px;
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
    }
    footer {
      background: #f8f9fa;
      padding: 20px;
      text-align: center;
      color: #666;
      font-size: 0.9em;
      border-top: 1px solid #e0e0e0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${name}</h1>
      <p>Generated on ${new Date().toLocaleString()}</p>
    </div>
    <div class="content">
      <div class="stats">
        <div class="stat-card">
          <label>Total Rows</label>
          <value>${preview.length}</value>
        </div>
        <div class="stat-card">
          <label>Columns</label>
          <value>${documentation.length}</value>
        </div>
      </div>
      <div class="charts">
        ${canvases}
      </div>
    </div>
    <footer>
      <p>Data visualization generated by Uchimi DataFlow Studio</p>
    </footer>
  </div>

  <script>
    ${chartScripts}
  </script>
</body>
</html>`;

  return html;
}

/**
 * Save charts to files
 */
function saveCharts(name, chartsHtml, chartsDir) {
  if (!chartsHtml) return null;

  try {
    // Ensure directory exists
    if (!fs.existsSync(chartsDir)) {
      fs.mkdirSync(chartsDir, { recursive: true });
    }
    
    const chartsPath = path.join(chartsDir, `${name}_charts.html`);
    fs.writeFileSync(chartsPath, chartsHtml);
    console.log(`Charts saved to: ${chartsPath}`);
    return chartsPath;
  } catch (err) {
    console.error(`Error saving charts: ${err.message}`);
    return null;
  }
}

module.exports = {
  generateCharts,
  generateHTMLReport,
  saveCharts
};
