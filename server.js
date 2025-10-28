require('dotenv').config();
const express = require('express');
const session = require('express-session');
const ejsMate = require('ejs-mate');
const methodOverride = require('method-override');
const path = require('path');
const { addUserToLocals } = require('./middleware/auth');
const prisma = require('./lib/prisma');
const app = express();
const PORT = process.env.PORT || 3000;

// EJS configuration
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true, // Prevents client-side JS from accessing the cookie
    secure: false, // Set to true if using HTTPS in production
    sameSite: 'lax' // Protects against CSRF
  },
  rolling: true // Reset cookie expiration on every response
}));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(addUserToLocals);

// Routes
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const eventRoutes = require('./routes/events');
const { requireAuth } = require('./middleware/auth');

// Public routes
app.use('/auth', authRoutes);

// Protected routes
app.use('/employees', requireAuth, employeeRoutes);
app.use('/events', requireAuth, eventRoutes);

// Home route - redirect to calendar
app.get('/', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }
  res.redirect('/events/calendar');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
