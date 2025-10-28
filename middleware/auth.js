// Authentication middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }
  next();
}

// Admin-only middleware
function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.userRole !== 'ADMIN') {
    return res.status(403).send('Access denied. Admin only.');
  }
  next();
}

// Use shared Prisma instance
const prisma = require('../lib/prisma');

// Add user info to all templates
async function addUserToLocals(req, res, next) {
  res.locals.currentUser = null;
  res.locals.isAdmin = false;

  if (req.session && req.session.userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.session.userId }
      });

      if (user) {
        res.locals.currentUser = user;
        res.locals.isAdmin = user.role === 'ADMIN';
        // Update session with fresh user data
        req.session.userRole = user.role;
        req.session.userName = user.name;
      } else {
        // User not found in DB, clear invalid session
        req.session.destroy(() => {});
      }
    } catch (error) {
      console.error('Error fetching user:', error);
      // On error, don't destroy session but log for debugging
    }
  }

  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  addUserToLocals
};
