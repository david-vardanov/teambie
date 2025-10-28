const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');

// Login page
router.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.render('auth/login', { error: null });
});

// Login handler
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.render('auth/login', { error: 'Invalid email or password' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.render('auth/login', { error: 'Invalid email or password' });
    }

    // Regenerate session to prevent session fixation attacks
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.render('auth/login', { error: 'Session error. Please try again.' });
      }

      // Store user data in the new session
      req.session.userId = user.id;
      req.session.userRole = user.role;
      req.session.userName = user.name;

      // Explicitly save session before redirecting
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.render('auth/login', { error: 'Session error. Please try again.' });
        }
        res.redirect('/');
      });
    });
  } catch (error) {
    console.error(error);
    res.render('auth/login', { error: 'An error occurred. Please try again.' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
    }
    res.redirect('/auth/login');
  });
});

module.exports = router;
