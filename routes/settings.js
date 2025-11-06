const express = require('express');
const path = require('path');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const prisma = require('../lib/prisma');

// Get or create bot settings
async function getBotSettings() {
  let settings = await prisma.botSettings.findFirst();

  if (!settings) {
    // Create default settings
    settings = await prisma.botSettings.create({
      data: {
        botEnabled: false,
        timezoneOffset: 3,
        morningReportTime: "09:00",
        endOfDayReportTime: "19:00",
        missedCheckInTime: "12:00"
      }
    });
  }

  return settings;
}

// Test route
router.get('/test', requireAdmin, (req, res) => {
  res.render('settings/bot-test');
});

// Show bot settings page (admin only)
router.get('/bot', requireAdmin, async (req, res) => {
  try {
    const settings = await getBotSettings();

    // Get bot token from settings or .env
    const botToken = settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '';
    const tokenConfigured = !!botToken && botToken !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE';

    // Mask token for display (show only first 20 chars)
    const maskedToken = (botToken && botToken.length > 20)
      ? (botToken.substring(0, 20) + '...')
      : botToken;

    // Get all active employees with connection status
    const allEmployees = await prisma.employee.findMany({
      where: { archived: false },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        telegramUserId: true,
        clickupUserId: true
      }
    });

    const linkedEmployees = allEmployees.filter(e => e.telegramUserId !== null).length;
    const totalEmployees = allEmployees.length;

    // Get ClickUp linked employees
    const clickupLinkedEmployees = allEmployees.filter(e => e.clickupUserId !== null).length;

    // Get pending events
    const pendingEvents = await prisma.event.count({
      where: { moderated: false }
    });

    // Mask ClickUp API token
    const maskedClickUpToken = (settings.clickupApiToken && settings.clickupApiToken.length > 20)
      ? (settings.clickupApiToken.substring(0, 20) + '...')
      : settings.clickupApiToken || '';

    return res.render('settings/bot-settings', {
      settings: settings,
      maskedToken: maskedToken,
      tokenConfigured: tokenConfigured,
      linkedEmployees: linkedEmployees,
      totalEmployees: totalEmployees,
      clickupLinkedEmployees: clickupLinkedEmployees,
      maskedClickUpToken: maskedClickUpToken,
      pendingEvents: pendingEvents,
      allEmployees: allEmployees
    });
  } catch (error) {
    console.error('Settings route error:', error);
    return res.status(500).send('Server Error: ' + error.message);
  }
});

// Update bot settings (admin only)
router.post('/bot', requireAdmin, async (req, res) => {
  try {
    const {
      telegramBotToken,
      botEnabled,
      timezoneOffset,
      morningReportTime,
      endOfDayReportTime,
      missedCheckInTime,
      clickupApiToken,
      clickupWorkspaceId,
      clickupSpaceId,
      clickupFolderId,
      clickupListId,
      clickupEnabled
    } = req.body;

    let settings = await prisma.botSettings.findFirst();

    if (!settings) {
      settings = await prisma.botSettings.create({
        data: {
          telegramBotToken: telegramBotToken || null,
          botEnabled: botEnabled === 'on',
          timezoneOffset: parseInt(timezoneOffset) || 3,
          morningReportTime: morningReportTime || "09:00",
          endOfDayReportTime: endOfDayReportTime || "19:00",
          missedCheckInTime: missedCheckInTime || "12:00",
          clickupApiToken: clickupApiToken || null,
          clickupWorkspaceId: clickupWorkspaceId || null,
          clickupSpaceId: clickupSpaceId || null,
          clickupFolderId: clickupFolderId || null,
          clickupListId: clickupListId || null,
          clickupEnabled: clickupEnabled === 'on',
          updatedBy: req.session?.userId
        }
      });
    } else {
      // Don't save masked tokens - keep existing if token contains "..."
      const isMaskedTelegram = telegramBotToken && telegramBotToken.includes('...');
      const isMaskedClickUp = clickupApiToken && clickupApiToken.includes('...');

      settings = await prisma.botSettings.update({
        where: { id: settings.id },
        data: {
          telegramBotToken: isMaskedTelegram ? settings.telegramBotToken : (telegramBotToken || settings.telegramBotToken),
          botEnabled: botEnabled === 'on',
          timezoneOffset: parseInt(timezoneOffset) || 3,
          morningReportTime: morningReportTime || "09:00",
          endOfDayReportTime: endOfDayReportTime || "19:00",
          missedCheckInTime: missedCheckInTime || "12:00",
          clickupApiToken: isMaskedClickUp ? settings.clickupApiToken : (clickupApiToken || settings.clickupApiToken),
          clickupWorkspaceId: clickupWorkspaceId || settings.clickupWorkspaceId,
          clickupSpaceId: clickupSpaceId || settings.clickupSpaceId,
          clickupFolderId: clickupFolderId || settings.clickupFolderId,
          clickupListId: clickupListId || settings.clickupListId,
          clickupEnabled: clickupEnabled === 'on',
          updatedBy: req.session?.userId
        }
      });
    }

    // If token is provided, update .env file
    if (telegramBotToken && telegramBotToken !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(__dirname, '..', '.env');

      try {
        let envContent = fs.readFileSync(envPath, 'utf8');

        // Update or add TELEGRAM_BOT_TOKEN
        if (envContent.includes('TELEGRAM_BOT_TOKEN=')) {
          envContent = envContent.replace(
            /TELEGRAM_BOT_TOKEN=.*/,
            `TELEGRAM_BOT_TOKEN="${telegramBotToken}"`
          );
        } else {
          envContent += `\nTELEGRAM_BOT_TOKEN="${telegramBotToken}"`;
        }

        fs.writeFileSync(envPath, envContent);
      } catch (error) {
        console.error('Failed to update .env file:', error);
      }
    }

    req.session.message = {
      type: 'success',
      text: 'Bot settings updated successfully! Restart the bot to apply changes.'
    };

    res.redirect('/config/bot');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Test bot connection (admin only)
router.post('/bot/test', requireAdmin, async (req, res) => {
  try {
    const settings = await getBotSettings();
    const botToken = settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken || botToken === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
      req.session.message = {
        type: 'error',
        text: 'Bot token not configured'
      };
      return res.redirect('/config/bot');
    }

    // Test bot connection by getting bot info
    const https = require('https');
    const url = `https://api.telegram.org/bot${botToken}/getMe`;

    https.get(url, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          const result = JSON.parse(data);

          if (result.ok) {
            req.session.message = {
              type: 'success',
              text: `✅ Bot connected successfully! Bot username: @${result.result.username}`
            };
          } else {
            req.session.message = {
              type: 'error',
              text: `❌ Connection failed: ${result.description || 'Invalid bot token'}`
            };
          }
          res.redirect('/config/bot');
        } catch (error) {
          req.session.message = {
            type: 'error',
            text: '❌ Failed to parse response'
          };
          res.redirect('/config/bot');
        }
      });
    }).on('error', (error) => {
      req.session.message = {
        type: 'error',
        text: `❌ Connection error: ${error.message}`
      };
      res.redirect('/config/bot');
    });
  } catch (error) {
    console.error(error);
    req.session.message = {
      type: 'error',
      text: `❌ Error: ${error.message}`
    };
    res.redirect('/config/bot');
  }
});

// Test ClickUp connection (admin only)
router.post('/clickup/test', requireAdmin, async (req, res) => {
  try {
    const settings = await getBotSettings();
    const clickupToken = settings.clickupApiToken;

    if (!clickupToken) {
      req.session.message = {
        type: 'error',
        text: 'ClickUp API token not configured'
      };
      return res.redirect('/config/bot');
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(clickupToken);

    try {
      const user = await clickup.getUser();
      req.session.message = {
        type: 'success',
        text: `✅ ClickUp connected successfully! User: ${user.user.username}`
      };
    } catch (error) {
      req.session.message = {
        type: 'error',
        text: `❌ ClickUp connection failed: ${error.message}`
      };
    }

    res.redirect('/config/bot');
  } catch (error) {
    console.error(error);
    req.session.message = {
      type: 'error',
      text: `❌ Error: ${error.message}`
    };
    res.redirect('/config/bot');
  }
});

// Get ClickUp workspaces (admin only)
router.get('/clickup/workspaces', requireAdmin, async (req, res) => {
  try {
    const settings = await getBotSettings();
    if (!settings.clickupApiToken) {
      return res.status(400).json({ error: 'ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(settings.clickupApiToken);
    const workspaces = await clickup.getWorkspaces();

    res.json(workspaces);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get ClickUp spaces (admin only)
router.get('/clickup/spaces/:workspaceId', requireAdmin, async (req, res) => {
  try {
    const settings = await getBotSettings();
    if (!settings.clickupApiToken) {
      return res.status(400).json({ error: 'ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(settings.clickupApiToken);
    const spaces = await clickup.getSpaces(req.params.workspaceId);

    res.json(spaces);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get ClickUp lists (admin only)
router.get('/clickup/lists/:spaceId', requireAdmin, async (req, res) => {
  try {
    const settings = await getBotSettings();
    if (!settings.clickupApiToken) {
      return res.status(400).json({ error: 'ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(settings.clickupApiToken);
    const lists = await clickup.getSpaceLists(req.params.spaceId);

    res.json(lists);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
