const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const { recordUsageEvent } = require('~/server/services/SanSuoUsage');

const router = express.Router();
router.post('/events', requireJwtAuth, async (req, res) => {
  try {
    const result = await recordUsageEvent({
      ...(req.body || {}),
      userId: req.user?.id,
    });
    res.status(result.skipped ? 400 : 202).json(result);
  } catch (_error) {
    res.status(500).json({ message: '使用事件记录失败' });
  }
});

module.exports = router;
