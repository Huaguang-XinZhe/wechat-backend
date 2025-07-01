const express = require("express");
const jwt = require("jsonwebtoken");
const Joi = require("joi");
const router = express.Router();

// const User = require("../models/User"); // 数据库版本
const User = require("../models/MemoryUser"); // 内存存储版本（单例）
const wechatService = require("../services/wechatService");
const logger = require("../utils/logger");
const { authenticateToken } = require("../middleware/auth");

// 登录验证 schema - 简化版本
const loginSchema = Joi.object({
  code: Joi.string().required().messages({
    "string.empty": "code 不能为空",
    "any.required": "code 是必需的",
  }),
  inviteCode: Joi.string().optional(), // 可选的邀请码
});

// 手机号登录 schema
const phoneLoginSchema = Joi.object({
  code: Joi.string().required().messages({
    "string.empty": "code 不能为空",
    "any.required": "code 是必需的",
  }),
  encryptedData: Joi.string().required().messages({
    "string.empty": "encryptedData 不能为空",
    "any.required": "encryptedData 是必需的",
  }),
  iv: Joi.string().required().messages({
    "string.empty": "iv 不能为空",
    "any.required": "iv 是必需的",
  }),
  inviteCode: Joi.string().optional(), // 可选的邀请码
});

// 邀请码注册 schema - 简化版本
const registerWithInviteCodeSchema = Joi.object({
  openid: Joi.string().required().messages({
    "string.empty": "openid 不能为空",
    "any.required": "openid 是必需的",
  }),
  nickname: Joi.string().optional(),
  avatar_url: Joi.string().optional(),
  phone_number: Joi.string()
    .pattern(/^1[3-9]\d{9}$/)
    .optional(),
  inviteCode: Joi.string().required().messages({
    "string.empty": "邀请码不能为空",
    "any.required": "邀请码是必需的",
  }),
});

// 邀请码验证 schema
const validateInviteCodeSchema = Joi.object({
  inviteCode: Joi.string().required().messages({
    "string.empty": "邀请码不能为空",
    "any.required": "邀请码是必需的",
  }),
});

// 用户资料更新 schema - 简化版本
const updateProfileSchema = Joi.object({
  nickname: Joi.string().optional(),
  avatar_url: Joi.string().optional(),
  phone_number: Joi.string()
    .pattern(/^1[3-9]\d{9}$/)
    .optional(),
});

// 生成 JWT token
function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      openid: user.openid,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );
}

// 格式化用户信息返回数据
function formatUserResponse(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatar_url: user.avatar_url,
    phone_number: user.phone_number,
    login_count: user.login_count,
    last_login_at: user.last_login_at,
  };
}

// 微信登录 - 支持邀请码参数
router.post("/login", async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: 400,
        message: error.details[0].message,
        data: null,
      });
    }

    const { code, inviteCode } = value;

    // 通过 code 获取 openid 和 session_key
    const wechatAuth = await wechatService.code2Session(code);

    // 查找现有用户
    let user = await User.findByOpenid(wechatAuth.openid);

    if (user) {
      // 已注册用户，更新登录信息
      const updateData = {
        session_key: wechatAuth.session_key,
        last_login_at: new Date(),
      };

      await user.update(updateData);
      await User.updateLoginInfo(wechatAuth.openid);

      // 生成 token
      const token = generateToken(user);

      logger.info(`用户登录成功: ${user.openid}`);

      return res.json({
        code: 200,
        message: "登录成功",
        data: {
          isNewUser: false,
          token,
          userInfo: formatUserResponse(user),
          inviteCode: user.invite_code,
          inviteFrom: user.invite_from,
        },
      });
    } else {
      // 新用户
      logger.info(`新用户需要注册: ${wechatAuth.openid}`);

      return res.json({
        code: 200,
        message: "新用户",
        data: {
          isNewUser: true,
          needRegistration: true,
        },
      });
    }
  } catch (error) {
    logger.error("用户登录失败:", error);

    if (error.message.includes("微信接口错误")) {
      return res.status(400).json({
        code: 400,
        message: "微信登录验证失败，请重试",
        data: null,
      });
    }

    next(error);
  }
});

// 手机号一键登录
router.post("/phoneLogin", async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = phoneLoginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: 400,
        message: error.details[0].message,
        data: null,
      });
    }

    const { code, encryptedData, iv, inviteCode } = value;

    // 通过 code 获取 openid 和 session_key
    const wechatAuth = await wechatService.code2Session(code);

    // 解密手机号信息
    const phoneInfo = await wechatService.decryptData(
      wechatAuth.session_key,
      encryptedData,
      iv
    );

    if (!phoneInfo || !phoneInfo.phoneNumber) {
      return res.status(400).json({
        code: 400,
        message: "获取手机号失败",
        data: null,
      });
    }

    // 查找现有用户
    let user = await User.findByOpenid(wechatAuth.openid);

    if (user) {
      // 已注册用户，更新登录信息和手机号
      const updateData = {
        session_key: wechatAuth.session_key,
        last_login_at: new Date(),
        phone_number: phoneInfo.phoneNumber,
      };

      await user.update(updateData);
      await User.updateLoginInfo(wechatAuth.openid);

      // 生成 token
      const token = generateToken(user);

      logger.info(
        `用户手机号登录成功: ${user.openid}, 手机号: ${phoneInfo.phoneNumber}`
      );

      return res.json({
        code: 200,
        message: "登录成功",
        data: {
          isNewUser: false,
          token,
          userInfo: formatUserResponse(user),
          inviteCode: user.invite_code,
          inviteFrom: user.invite_from,
        },
      });
    } else {
      // 新用户，需要注册
      if (!inviteCode) {
        return res.status(400).json({
          code: 400,
          message: "新用户注册需要邀请码",
          data: {
            isNewUser: true,
            needInviteCode: true,
          },
        });
      }

      // 验证邀请码
      const validation = await User.validateInviteCode(inviteCode);
      if (!validation.valid) {
        return res.status(400).json({
          code: 400,
          message: validation.isSystemCode
            ? "系统邀请码已被使用"
            : "邀请码无效",
          data: null,
        });
      }

      // 创建用户
      const defaultNickname = `用户${wechatAuth.openid.slice(-6)}`;

      const userData = {
        openid: wechatAuth.openid,
        session_key: wechatAuth.session_key,
        nickname: defaultNickname,
        avatar_url: "",
        phone_number: phoneInfo.phoneNumber,
        last_login_at: new Date(),
        login_count: 1,
      };

      const newUser = await User.createWithInviteCode(userData, inviteCode);

      // 生成 token
      const token = generateToken(newUser);

      logger.info(
        `用户手机号注册成功: ${newUser.openid}, 手机号: ${phoneInfo.phoneNumber}, 邀请码: ${inviteCode}`
      );

      return res.json({
        code: 200,
        message: "注册成功",
        data: {
          isNewUser: true,
          token,
          userInfo: formatUserResponse(newUser),
          inviteCode: newUser.invite_code,
          inviteFrom: newUser.invite_from,
        },
      });
    }
  } catch (error) {
    logger.error("手机号登录失败:", error);

    if (error.message.includes("微信接口错误")) {
      return res.status(400).json({
        code: 400,
        message: "微信登录验证失败，请重试",
        data: null,
      });
    }

    next(error);
  }
});

// 通过邀请码注册
router.post("/registerWithInviteCode", async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = registerWithInviteCodeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: 400,
        message: error.details[0].message,
        data: null,
      });
    }

    const { openid, nickname, avatar_url, phone_number, inviteCode } = value;

    // 检查用户是否已存在
    const existingUser = await User.findByOpenid(openid);
    if (existingUser) {
      return res.status(400).json({
        code: 400,
        message: "用户已注册，请直接登录",
        data: null,
      });
    }

    // 验证邀请码
    const validation = await User.validateInviteCode(inviteCode);
    if (!validation.valid) {
      return res.status(400).json({
        code: 400,
        message: validation.isSystemCode ? "系统邀请码已被使用" : "邀请码无效",
        data: null,
      });
    }

    // 创建用户
    const defaultNickname = nickname || `用户${openid.slice(-6)}`;

    const userData = {
      openid,
      session_key: "", // 这里可以传入之前获取的 session_key
      nickname: defaultNickname,
      avatar_url: avatar_url || "",
      phone_number: phone_number || "",
      last_login_at: new Date(),
      login_count: 1,
    };

    const user = await User.createWithInviteCode(userData, inviteCode);

    // 生成 token
    const token = generateToken(user);

    logger.info(`用户注册成功: ${user.openid}, 邀请码: ${inviteCode}`);

    res.json({
      code: 200,
      message: "注册成功",
      data: {
        token,
        userInfo: formatUserResponse(user),
        inviteCode: user.invite_code,
        inviteFrom: user.invite_from,
      },
    });
  } catch (error) {
    logger.error("用户注册失败:", error);

    if (error.message === "邀请码无效") {
      return res.status(400).json({
        code: 400,
        message: "邀请码无效",
        data: null,
      });
    }

    next(error);
  }
});

// 验证邀请码
router.post("/validateInviteCode", async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = validateInviteCodeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: 400,
        message: error.details[0].message,
        data: null,
      });
    }

    const { inviteCode } = value;

    // 验证邀请码
    const validation = await User.validateInviteCode(inviteCode);

    if (validation.valid) {
      res.json({
        code: 200,
        message: "邀请码有效",
        data: {
          valid: true,
          inviteUserInfo: validation.inviteUserInfo,
        },
      });
    } else {
      res.json({
        code: 400,
        message: validation.isSystemCode ? "系统邀请码已被使用" : "邀请码无效",
        data: {
          valid: false,
          inviteUserInfo: null,
        },
      });
    }
  } catch (error) {
    logger.error("邀请码验证失败:", error);
    next(error);
  }
});

// 更新用户资料
router.post("/updateProfile", authenticateToken, async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: 400,
        message: error.details[0].message,
        data: null,
      });
    }

    const { nickname, avatar_url, phone_number } = value;
    const userId = req.user.id;

    // 查找用户
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        code: 404,
        message: "用户不存在",
        data: null,
      });
    }

    // 更新用户信息
    const updateData = {
      nickname: nickname || user.nickname,
      avatar_url: avatar_url || user.avatar_url,
      phone_number: phone_number || user.phone_number,
    };

    await user.update(updateData);

    logger.info(`用户资料更新成功: ${user.openid}`);

    res.json({
      code: 200,
      message: "用户资料更新成功",
      data: {
        userInfo: formatUserResponse(user),
      },
    });
  } catch (error) {
    logger.error("用户资料更新失败:", error);
    next(error);
  }
});

// 验证 Token
router.post("/verify", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        code: 404,
        message: "用户不存在",
        data: null,
      });
    }

    res.json({
      success: true,
      message: "Token 验证成功",
      data: {
        userInfo: formatUserResponse(user),
        inviteCode: user.invite_code,
        inviteFrom: user.invite_from,
      },
    });
  } catch (error) {
    logger.error("Token 验证失败:", error);
    next(error);
  }
});

// 获取邀请统计信息
router.get("/inviteStats", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const stats = await User.getInviteStats(userId);
    const invitedUsers = await User.getInvitedUsers(userId);

    res.json({
      success: true,
      message: "获取邀请统计成功",
      data: {
        inviteCode: stats.inviteCode,
        invitedCount: stats.invitedCount,
        invitedUsers,
      },
    });
  } catch (error) {
    logger.error("获取邀请统计失败:", error);
    next(error);
  }
});

module.exports = router;
