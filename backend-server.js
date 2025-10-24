// server.js - Backend API Server
// Install dependencies: npm install express pg cors dotenv bcrypt jsonwebtoken
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'it_consulting',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// JWT middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', timestamp: new Date() });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  const { email, password, full_name, role } = req.body;
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING user_id, email, full_name, role',
      [email, hashedPassword, full_name, role || 'client']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Email already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user.user_id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        user_id: user.user_id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ticket routes
app.get('/api/tickets', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT t.*, u.full_name as client_name, a.full_name as assigned_to_name
      FROM tickets t
      LEFT JOIN users u ON t.client_id = u.user_id
      LEFT JOIN users a ON t.assigned_to = a.user_id
    `;
    
    if (req.user.role === 'client') {
      query += ` WHERE t.client_id = $1`;
      const result = await pool.query(query + ' ORDER BY t.created_at DESC', [req.user.userId]);
      res.json(result.rows);
    } else {
      const result = await pool.query(query + ' ORDER BY t.created_at DESC');
      res.json(result.rows);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tickets/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.full_name as client_name, a.full_name as assigned_to_name
       FROM tickets t
       LEFT JOIN users u ON t.client_id = u.user_id
       LEFT JOIN users a ON t.assigned_to = a.user_id
       WHERE t.ticket_id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tickets', authenticateToken, async (req, res) => {
  const { title, description, priority, category } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO tickets (client_id, title, description, priority, category)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.userId, title, description, priority || 'medium', category || 'general']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tickets/:id', authenticateToken, async (req, res) => {
  const { status, priority, assigned_to, resolution_notes } = req.body;
  
  try {
    const fields = [];
    const values = [];
    let paramCount = 1;
    
    if (status !== undefined) {
      fields.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (priority !== undefined) {
      fields.push(`priority = $${paramCount++}`);
      values.push(priority);
    }
    if (assigned_to !== undefined) {
      fields.push(`assigned_to = $${paramCount++}`);
      values.push(assigned_to);
    }
    if (resolution_notes !== undefined) {
      fields.push(`resolution_notes = $${paramCount++}`);
      values.push(resolution_notes);
    }
    
    if (status === 'closed') {
      fields.push(`closed_at = CURRENT_TIMESTAMP`);
    }
    
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(req.params.id);
    
    const result = await pool.query(
      `UPDATE tickets SET ${fields.join(', ')} WHERE ticket_id = $${paramCount} RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Comments routes
app.get('/api/tickets/:id/comments', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.full_name as author_name
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.user_id
       WHERE c.ticket_id = $1
       ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tickets/:id/comments', authenticateToken, async (req, res) => {
  const { comment_text } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO comments (ticket_id, user_id, comment_text)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.params.id, req.user.userId, comment_text]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dashboard stats
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'open') as open_tickets,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_tickets,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_tickets,
        COUNT(*) as total_tickets
      FROM tickets
      ${req.user.role === 'client' ? 'WHERE client_id = $1' : ''}
    `, req.user.role === 'client' ? [req.user.userId] : []);
    
    res.json(stats.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get consultants (for assignment)
app.get('/api/consultants', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, full_name, email FROM users WHERE role IN ('consultant', 'admin')`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});
