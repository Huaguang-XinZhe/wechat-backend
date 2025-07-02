const express = require("express");
const router = express.Router();
const UserAdapterService = require("../services/userAdapterService");
const logger = require("../utils/logger");
const { noVerifyAuthMiddleware } = require("../middleware/auth");

// 获取系统状态
router.get("/status", (req, res) => {
  const userStats = UserAdapterService.getStats();

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
router.get("/users", async (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({
      success: false,
      message: "此接口仅在开发环境可用",
      code: 403,
    });
  }

  try {
    // 这里只显示前 20 个用户
    const users = await UserAdapterService.listUsers(20);

    res.json({
      success: true,
      message: "获取用户列表成功",
      data: {
        users: users.map((user) => ({
          id: user.id,
          openid: user.openid,
          nickname: user.nickname,
          phone_number: user.phone_number,
          invite_code: user.invite_code,
          invite_from: user.invite_from,
        })),
      },
    });
  } catch (error) {
    logger.error("调试接口错误:", error);
    res.status(500).json({
      success: false,
      message: "服务器内部错误",
      code: 500,
    });
  }
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

  const inviteCodeStats = UserAdapterService.getInviteCodeStats();

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
    const validation = await UserAdapterService.validateInviteCode(inviteCode);

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

  UserAdapterService.clearAll();

  res.json({
    success: true,
    message: "所有数据已清空",
    data: {
      timestamp: new Date().toISOString(),
    },
  });
});

// 清空所有用户数据
router.delete("/users", async (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({
      success: false,
      message: "此操作仅在开发环境下可用",
      code: 403,
    });
  }

  try {
    // 在适配器中实现清空操作（只在开发环境中）
    await UserAdapterService.clearAllDevelopmentUsers();

    res.json({
      success: true,
      message: "已清空所有用户数据",
    });
  } catch (error) {
    logger.error("清空用户数据失败:", error);
    res.status(500).json({
      success: false,
      message: "服务器内部错误",
      code: 500,
    });
  }
});

// 添加一个新的调试 token 的路由
router.post("/token", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "缺少 token 参数",
        code: 400,
      });
    }

    // 尝试解码 token 不验证签名
    const jwt = require("jsonwebtoken");
    const decoded = jwt.decode(token, { complete: true });

    // 检查 token 是否过期
    let isExpired = false;
    if (decoded && decoded.payload && decoded.payload.exp) {
      const now = Math.floor(Date.now() / 1000);
      isExpired = decoded.payload.exp < now;
    }

    // 返回 token 信息
    res.json({
      success: true,
      message: "Token 解析成功",
      data: {
        token,
        header: decoded ? decoded.header : null,
        payload: decoded ? decoded.payload : null,
        signature: decoded ? decoded.signature : null,
        isExpired,
        now: Math.floor(Date.now() / 1000),
        expiresIn:
          decoded && decoded.payload.exp
            ? decoded.payload.exp - Math.floor(Date.now() / 1000)
            : null,
      },
    });
  } catch (error) {
    console.error("Token 解析失败:", error);
    res.status(500).json({
      success: false,
      message: `Token 解析失败: ${error.message}`,
      code: 500,
    });
  }
});

// 添加一个测试认证的路由
router.get("/current-user", noVerifyAuthMiddleware, async (req, res) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      message: "当前用户信息获取成功",
      data: {
        user: {
          id: user.id,
          openid: user.openid,
          nickname: user.nickname,
          avatar_url: user.avatar_url,
          phone_number: user.phone_number,
          login_count: user.login_count || 0,
          invite_code: user.invite_code,
          invite_from: user.invite_from,
        },
      },
    });
  } catch (error) {
    console.error("获取当前用户信息失败:", error);
    res.status(500).json({
      success: false,
      message: `获取当前用户信息失败: ${error.message}`,
      code: 500,
    });
  }
});

// 添加一个测试查找用户的路由
router.post("/find-user", async (req, res) => {
  try {
    const { openid } = req.body;

    if (!openid) {
      return res.status(400).json({
        success: false,
        message: "缺少 openid 参数",
        code: 400,
      });
    }

    const UserAdapterService = require("../services/userAdapterService");
    const user = await UserAdapterService.findUserByOpenid(openid);

    if (user) {
      res.json({
        success: true,
        message: "用户查找成功",
        data: {
          user: {
            id: user.id,
            openid: user.openid,
            nickname: user.nickname,
            avatar_url: user.avatar_url,
            phone_number: user.phone_number,
            login_count: user.login_count || 0,
            invite_code: user.invite_code,
            invite_from: user.invite_from,
          },
        },
      });
    } else {
      res.status(404).json({
        success: false,
        message: "用户不存在",
        code: 404,
      });
    }
  } catch (error) {
    console.error("查找用户失败:", error);
    res.status(500).json({
      success: false,
      message: `查找用户失败: ${error.message}`,
      code: 500,
    });
  }
});

// 非开发环境下，所有调试路由都返回 403
router.all("*", (req, res) => {
  res.status(403).json({
    success: false,
    message: "调试接口仅在开发环境可用",
    code: 403,
  });
});

module.exports = router;
