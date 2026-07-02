// ─────────────────────────────────────────────────────────────
//  Silliza Backend Server
//  Node.js + Express
//  Handles: AI proxy, loan storage, WhatsApp notifications
// ─────────────────────────────────────────────────────────────
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Storage file (simple JSON — swap for DB later) ──────────
const DB_FILE = path.join(__dirname, 'loans.json');
function readDB()  { try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch { return []; } }
function writeDB(d){ fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }

// ── Security middleware ──────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));      // allow inline scripts in PWA
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

// Rate-limit the AI endpoint (30 req / 10 min per IP)
const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please wait a moment.' }
});

// Rate-limit loan submission (5 per hour per IP)
const loanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many loan submissions from this IP.' }
});

// ── Serve the PWA frontend ───────────────────────────────────
app.use(express.static(path.join(__dirname, 'Frontend')));

// ── ROUTE: Health check ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Silliza API', time: new Date().toISOString() });
});

// ── ROUTE: AI proxy (Mike wiser agent) ────────────────────────────
app.post('/api/chat', aiLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY; 
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server.' });
  }

  const { model, max_tokens, system, messages, stream } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  // ── Streaming path ──
  if (stream) {
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':       'application/json',
          'x-api-key':          apiKey,
          'anthropic-version':  '2023-06-01'
        },
        body: JSON.stringify({
          model:      model      || 'claude-sonnet-4-6',
          max_tokens: max_tokens || 1000,
          system:     system     || '',
          messages,
          stream: true
        })
      });

      if (!upstream.ok || !upstream.body) {
        const errData = await upstream.json().catch(() => ({}));
        console.error('Anthropic stream error:', errData);
        return res.status(upstream.status || 500).json({ error: errData.error?.message || 'AI error' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      // Node's global fetch (Node 18+) returns a web ReadableStream — pipe it manually
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      req.on('close', () => { try { reader.cancel(); } catch {} });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } catch (err) {
      console.error('Chat stream proxy error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to reach AI service.' });
      } else {
        res.end();
      }
    }
    return;
  }

  // ── Non-streaming fallback path ──
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01'
      },
      body: JSON.stringify({
        model:      model      || 'claude-sonnet-4-6',
        max_tokens: max_tokens || 1000,
        system:     system     || '',
        messages
      })
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error('Anthropic error:', data);
      return res.status(upstream.status).json({ error: data.error?.message || 'AI error' });
    }

    res.json(data);
  } catch (err) {
    console.error('Chat proxy error:', err);
    res.status(500).json({ error: 'Failed to reach AI service.' });
  }
});

// ── ROUTE: Save loan application ────────────────────────────
app.post('/api/loans', loanLimiter, (req, res) => {
  const loan = req.body;
  if (!loan || !loan.name || !loan.phone) {
    return res.status(400).json({ error: 'Missing required loan fields.' });
  }

  const loans = readDB();
  const record = {
    id:        Date.now(),
    ...loan,
    status:    'pending',
    createdAt: new Date().toISOString(),
    ip:        req.ip
  };
  loans.push(record);
  writeDB(loans);

  console.log(`[LOAN] New application: ${loan.name} | K${loan.amount}`);
  res.json({ success: true, id: record.id });
});

// ── ROUTE: Get all loans (admin) ─────────────────────────────
app.get('/api/loans', (req, res) => {
  const adminKey = process.env.ADMIN_KEY; 
  if (adminKey && req.headers['x-admin-key'] !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(readDB());
});

// ── ROUTE: Update loan status (admin) ───────────────────────
app.patch('/api/loans/:id', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers['x-admin-key'] !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const loans = readDB();
  const idx   = loans.findIndex(l => String(l.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Loan not found' });

  loans[idx] = { ...loans[idx], ...req.body, updatedAt: new Date().toISOString() };
  writeDB(loans);
  res.json({ success: true, loan: loans[idx] });
});

// ── ROUTE: WhatsApp notification helper ─────────────────────
//  Returns pre-built wa.me links (server-side, no credentials needed)
app.post('/api/notify', (req, res) => {
  const { loan } = req.body;
  if (!loan) return res.status(400).json({ error: 'Loan data required' });

  const MANAGER = process.env.MANAGER_WHATSAPP || '260769309326';
  const CEO     = process.env.CEO_WHATSAPP     || '260979939322';

  const msg = encodeURIComponent(
    `🏦 *SILLIZA LOAN APP*\n` +
    `New application received!\n\n` +
    `👤 *Name:* ${loan.name}\n` +
    `📞 *Phone:* ${loan.phone}\n` +
    `🪪 *NRC:* ${loan.nrc || 'N/A'}\n` +
    `💼 *Employer:* ${loan.work || 'N/A'}\n` +
    `💰 *Amount:* K${loan.amount}\n` +
    `📅 *Term:* ${loan.term}\n` +
    `📈 *Interest:* ${loan.rate}%\n` +
    `💳 *Repayment:* K${loan.repay}\n` +
    `🔒 *Collateral:* ${loan.collateral || 'None'}\n\n` +
    `_Submitted: ${new Date().toLocaleString('en-ZM')}_`
  );

  res.json({
    manager: `https://wa.me/${MANAGER}?text=${msg}`,
    ceo:     `https://wa.me/${CEO}?text=${msg}`
  });
});

// ── Fallback: serve index.html for all non-API routes ───────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'Fronend', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Silliza server running on port ${PORT}`);
  console.log(`   Local:  http://localhost:${PORT}`);
  console.log(`   API:    http://localhost:${PORT}/api/health\n`);
});
