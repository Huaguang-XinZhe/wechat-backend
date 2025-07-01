const express = require("express");
const router = express.Router();

const User = require("../models/MemoryUser");

// 获取系统状态
router.get("/status", (req, res) => {
  const userStats = User.getStats();

  res.json({
    success: true,
    message: "系统状态信息",
    data: {
      mode: "内存存储模式",
      database: "已禁用",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV,
      users: userStats,
      timestamp: new Date().toISOString(),
    },
  });
});

// 获取所有用户（仅开发环境）
router.get("/users", (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({
      success: false,
      message: "此接口仅在开发环境可用",
      code: 403,
    });
  }

  const users = User.getAllUsers();

  res.json({
    success: true,
    message: "用户列表",
    data: {
      users: users.map((user) => ({
        id: user.id,
        openid: user.openid,
        nickname: user.nickname,
        login_count: user.login_count,
        last_login_at: user.last_login_at,
        created_at: user.created_at,
        invite_code: user.invite_code,
        invite_from: user.invite_from,
        inviter_id: user.inviter_id,
      })),
      total: users.length,
    },
  });
});

// 获取邀请码统计信息（仅开发环境）
router.get("/invite-codes", (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({
      success: false,
      message: "此接口仅在开发环境可用",
      code: 403,
    });
  }

  const inviteCodeStats = User.getInviteCodeStats();

  res.json({
    success: true,
    message: "邀请码统计信息",
    data: inviteCodeStats,
  });
});

// 测试邀请码验证（仅开发环境）
router.post("/test-invite-code", async (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({
      success: false,
      message: "此接口仅在开发环境可用",
      code: 403,
    });
  }

  const { inviteCode } = req.body;

  if (!inviteCode) {
    return res.status(400).json({
      success: false,
      message: "邀请码不能为空",
      code: 400,
    });
  }

  try {
    const validation = await User.validateInviteCode(inviteCode);

    res.json({
      success: true,
      message: "邀请码验证结果",
      data: {
        inviteCode,
        ...validation,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "验证失败",
      error: error.message,
    });
  }
});

// 清空所有数据（仅开发环境）
router.delete("/clear", (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({
      success: false,
      message: "此接口仅在开发环境可用",
      code: 403,
    });
  }

  User.clearAll();

  res.json({
    success: true,
    message: "所有数据已清空",
    data: {
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = router;
