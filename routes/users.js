const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const prisma = require('../lib/prisma');

// List all users (admin only)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true
      }
    });

    // Get linked employees for each user
    const usersWithEmployees = await Promise.all(users.map(async (user) => {
      const employee = await prisma.employee.findFirst({
        where: { email: user.email }
      });
      return {
        ...user,
        hasEmployee: !!employee,
        employeeId: employee?.id
      };
    }));

    res.render('users/index', { users: usersWithEmployees });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Promote user to admin
router.post('/:id/promote', requireAdmin, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { role: 'ADMIN' }
    });

    req.session.message = {
      type: 'success',
      text: 'User promoted to admin successfully'
    };
    res.redirect('/users');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Demote user from admin
router.post('/:id/demote', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent demoting yourself
    if (userId === req.session.userId) {
      req.session.message = {
        type: 'error',
        text: 'You cannot demote yourself'
      };
      return res.redirect('/users');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { role: 'EMPLOYEE' }
    });

    req.session.message = {
      type: 'success',
      text: 'User demoted to employee successfully'
    };
    res.redirect('/users');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
