const express = require("express");
const Joi = require("joi");
const router = express.Router();

const UserAdapterService = require("../services/userAdapterService");
const wechatService = require("../services/wechatService");
const {
  authMiddleware,
  noVerifyAuthMiddleware,
} = require("../middleware/auth");
const logger = require("../utils/logger");
const LegacyApiService = require("../services/legacyApiService");

// 登录验证 schema
const loginSchema = Joi.object({
  code: Joi.string().required(),
  inviteCode: Joi.string().allow("", null),
});

// 手机号登录 schema
const phoneLoginSchema = Joi.object({
  code: Joi.string().required(),
  encryptedData: Joi.string().required(),
  iv: Joi.string().required(),
  inviteCode: Joi.string().allow("", null),
});

// 邀请码验证 schema
const validateInviteCodeSchema = Joi.object({
  inviteCode: Joi.string().required().messages({
    "string.empty": "邀请码不能为空",
    "any.required": "邀请码是必需的",
  }),
});

// 用户资料更新 schema
const updateProfileSchema = Joi.object({
  nickname: Joi.string().optional(),
  avatar_url: Joi.string().optional(),
  phone_number: Joi.string()
    .pattern(/^1[3-9]\d{9}$/)
    .optional(),
});

// 格式化用户信息返回数据
function formatUserResponse(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatar_url: user.avatar_url,
    phone_number: user.phone_number,
    login_count: user.login_count || 0,
    last_login_at: user.last_login_at,
  };
}

// 微信登录
router.post("/login", async (req, res, next) => {
  try {
    const { code, inviteCode } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "缺少必要参数",
        code: 400,
      });
    }

    // 通过 code 获取微信用户信息
    const wechatAuth = await wechatService.code2Session(code);
    if (!wechatAuth || !wechatAuth.openid) {
      logger.error("获取微信用户信息失败:", wechatAuth);
      return res.status(400).json({
        success: false,
        message: "获取微信用户信息失败",
        code: 400,
      });
    }

    // 查找或创建用户
    let user = await UserAdapterService.findUserByOpenid(wechatAuth.openid);

    if (!user) {
      // 处理邀请码
      let userData = {
        openid: wechatAuth.openid,
        is_active: true,
      };

      // 如果提供了邀请码，验证并设置
      if (inviteCode) {
        const inviteValidation = await UserAdapterService.validateInviteCode(
          inviteCode
        );
        if (!inviteValidation.valid) {
          logger.warn(`无效的邀请码: ${inviteCode}`);
          // 邀请码无效时仍然继续，但不设置邀请关系
        } else {
          logger.info(`使用邀请码: ${inviteCode}`);
          userData.invite_from = inviteCode;
        }
      }

      // 创建新用户
      user = await UserAdapterService.createOrUpdateUser(userData);
    }

    // 使用老后端登录接口获取 token
    const loginResult = await LegacyApiService.login(user.openid, "member123");

    if (!loginResult.success) {
      logger.error("老后端登录失败:", loginResult.message);
      return res.status(401).json({
        success: false,
        message: "登录失败: " + loginResult.message,
        code: 401,
      });
    }

    // 返回登录结果
    res.json({
      success: true,
      message: "登录成功",
      data: {
        token: loginResult.token,
        tokenHead: loginResult.tokenHead,
        userInfo: formatUserResponse(user),
        isNewUser: user.isNewUser || false,
        inviteCode: user.invite_code,
        inviteFrom: user.invite_from,
      },
    });
  } catch (error) {
    logger.error("登录失败:", error);
    next(error);
  }
});

// 手机号登录
router.post("/phoneLogin", async (req, res, next) => {
  try {
    // 添加详细的请求体日志
    logger.info(`手机号登录请求体原始内容: ${JSON.stringify(req.body)}`);
    logger.info(`请求头信息: ${JSON.stringify(req.headers)}`);
    logger.info(`请求方法: ${req.method}`);
    logger.info(`请求URL: ${req.url}`);
    
    const { code, encryptedData, iv, inviteCode } = req.body;

    logger.info(
      `手机号登录请求参数: code=${code}, inviteCode=${
        inviteCode || "无"
      }, encryptedData长度=${
        encryptedData ? encryptedData.length : 0
      }, iv长度=${iv ? iv.length : 0}`
    );

    if (!code || !encryptedData || !iv) {
      return res.status(400).json({
        success: false,
        message: "缺少必要参数",
        code: 400,
      });
    }

    // 通过 code 获取微信用户信息
    logger.info(`开始获取微信用户信息: code=${code}`);
    const wechatAuth = await wechatService.code2Session(code);
    if (!wechatAuth || !wechatAuth.openid) {
      logger.error("获取微信用户信息失败:", wechatAuth);
      return res.status(400).json({
        success: false,
        message: "获取微信用户信息失败",
        code: 400,
      });
    }
    logger.info(
      `获取微信用户信息成功: openid=${wechatAuth.openid}, session_key长度=${
        wechatAuth.session_key ? wechatAuth.session_key.length : 0
      }`
    );

    try {
      logger.info(`开始解密手机号数据...`);
      const phoneInfo = await wechatService.decryptData(
        wechatAuth.session_key,
        encryptedData,
        iv
      );

      logger.info(`手机号解密成功: ${JSON.stringify(phoneInfo, null, 2)}`);

      if (!phoneInfo || !phoneInfo.phoneNumber) {
        logger.error(
          `解密成功但未获取到手机号: ${JSON.stringify(phoneInfo, null, 2)}`
        );
        return res.status(400).json({
          success: false,
          message: "获取手机号失败",
          code: 400,
        });
      }

      // 根据 openid 查找用户
      let user = await UserAdapterService.findUserByOpenid(wechatAuth.openid);
      logger.info(
        `根据openid查找用户: ${wechatAuth.openid}, 结果: ${
          user ? "找到用户" : "未找到用户"
        }`
      );

      if (!user) {
        // 尝试根据手机号查找用户
        user = await UserAdapterService.findUserByPhone(phoneInfo.phoneNumber);
        logger.info(
          `根据手机号查找用户: ${phoneInfo.phoneNumber}, 结果: ${
            user ? "找到用户" : "未找到用户"
          }`
        );
      }

      // 如果用户不存在，创建新用户
      if (!user) {
        // 新用户，检查是否需要邀请码
        const requireInviteCode = process.env.REQUIRE_INVITE_CODE === "true";
        logger.info(
          `新用户注册, 是否需要邀请码: ${requireInviteCode}, 提供的邀请码: ${
            inviteCode || "无"
          }`
        );

        if (requireInviteCode && !inviteCode) {
          // 新用户必须提供邀请码才能注册，不能先创建用户
          logger.info(
            `新用户注册需要邀请码: openid=${wechatAuth.openid}, phone=${phoneInfo.phoneNumber}`
          );
          return res.status(400).json({
            success: false,
            message: "新用户注册需要邀请码",
            code: 400,
            data: {
              isNewUser: true,
              needInviteCode: true,
              openid: wechatAuth.openid,
              phoneNumber: phoneInfo.phoneNumber,
            },
          });
        }

        // 验证邀请码（如果提供了的话）
        let inviteValidation = { valid: true };
        if (inviteCode) {
          logger.info(`开始验证邀请码: ${inviteCode}`);
          inviteValidation = await UserAdapterService.validateInviteCode(
            inviteCode
          );
          logger.info(`邀请码验证结果: ${JSON.stringify(inviteValidation)}`);
          if (!inviteValidation.valid) {
            return res.status(400).json({
              success: false,
              message:
                inviteValidation.message ||
                (inviteValidation.isSystemCode
                  ? "系统邀请码已被使用"
                  : "邀请码无效"),
              code: 400,
            });
          }
        }

        // 创建用户
        const userData = {
          openid: wechatAuth.openid,
          phone_number: phoneInfo.phoneNumber,
          is_active: true,
        };

        if (inviteCode) {
          userData.invite_from = inviteCode;
        }

        logger.info(`准备创建用户，userData: ${JSON.stringify(userData)}`);
        user = await UserAdapterService.createOrUpdateUser(userData);
        logger.info(
          `用户创建完成，返回的用户信息: invite_from=${user.invite_from}, invite_code=${user.invite_code}`
        );
      } else {
        // 更新用户手机号
        if (!user.phone_number && phoneInfo.phoneNumber) {
          user = await user.update({
            phone_number: phoneInfo.phoneNumber,
          });
        }
      }

      // 使用老后端登录接口获取 token
      const loginResult = await LegacyApiService.login(
        user.openid,
        "member123"
      );

      if (!loginResult.success) {
        logger.error("老后端登录失败:", loginResult.message);
        return res.status(401).json({
          success: false,
          message: "登录失败: " + loginResult.message,
          code: 401,
        });
      }

      // 返回登录结果
      res.json({
        success: true,
        message: "登录成功",
        data: {
          token: loginResult.token,
          tokenHead: loginResult.tokenHead,
          userInfo: formatUserResponse(user),
          isNewUser: user.isNewUser || false,
          inviteCode: user.invite_code,
          inviteFrom: user.invite_from,
        },
      });
    } catch (error) {
      logger.error("手机号解密失败:", error);
      return res.status(400).json({
        success: false,
        message: "手机号解密失败",
        code: 400,
      });
    }
  } catch (error) {
    logger.error("手机号登录失败:", error);
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
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { inviteCode } = value;

    // 验证邀请码
    const validation = await UserAdapterService.validateInviteCode(inviteCode);

    if (validation.valid) {
      res.json({
        success: true,
        message: "邀请码有效",
        data: {
          valid: true,
          inviteUserInfo: validation.inviteUserInfo,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        message:
          validation.message ||
          (validation.isSystemCode ? "系统邀请码已被使用" : "邀请码无效"),
        code: 400,
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
router.post("/updateProfile", authMiddleware, async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { nickname, avatar_url, phone_number } = value;
    const user = req.user;

    // 更新用户信息
    const updateData = {
      nickname: nickname || user.nickname,
      avatar_url: avatar_url || user.avatar_url,
      phone_number: phone_number || user.phone_number,
    };

    const updatedUser = await UserAdapterService.createOrUpdateUser({
      ...user,
      ...updateData,
    });

    logger.info(`用户资料更新成功: ${user.openid}`);

    res.json({
      success: true,
      message: "用户资料更新成功",
      data: {
        userInfo: formatUserResponse(updatedUser),
      },
    });
  } catch (error) {
    logger.error("用户资料更新失败:", error);
    next(error);
  }
});

// 验证 Token
router.post("/verify", authMiddleware, async (req, res, next) => {
  try {
    const user = req.user;

    // 使用老后端登录接口刷新 token
    const loginResult = await LegacyApiService.login(user.openid, "member123");

    if (!loginResult.success) {
      logger.error("老后端 token 刷新失败:", loginResult.message);
      return res.status(401).json({
        success: false,
        message: "Token 验证失败: " + loginResult.message,
        code: 401,
      });
    }

    res.json({
      success: true,
      message: "Token 验证成功",
      data: {
        token: loginResult.token,
        tokenHead: loginResult.tokenHead,
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
router.get("/inviteStats", noVerifyAuthMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const stats = await UserAdapterService.getInviteStats(userId);

    res.json({
      success: true,
      message: "获取邀请统计成功",
      data: {
        inviteCode: stats.inviteCode,
        invitedCount: stats.invitedCount,
      },
    });
  } catch (error) {
    logger.error("获取邀请统计失败:", error);
    next(error);
  }
});

// 获取邀请提现信息
router.get("/inviteWithdrawInfo", noVerifyAuthMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const withdrawInfo = await UserAdapterService.getInviteWithdrawInfo(userId);

    res.json({
      success: true,
      message: "获取邀请提现信息成功",
      data: {
        inviteCode: withdrawInfo.inviteCode,
        invitedCount: withdrawInfo.invitedCount,
        commissionRate: withdrawInfo.commissionRate,
        totalOrderAmount: withdrawInfo.totalOrderAmount,
        availableCommission: withdrawInfo.availableCommission,
        openid: withdrawInfo.openid
      },
    });
  } catch (error) {
    logger.error("获取邀请提现信息失败:", error);
    next(error);
  }
});

// 申请提现
router.post("/withdrawCommission", noVerifyAuthMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount } = req.body;
    
    // 验证提现金额
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "提现金额无效",
        code: 400,
      });
    }
    
    const requestAmount = parseFloat(amount);
    
    // 获取最小和最大提现金额限制
    const minWithdrawAmount = parseFloat(process.env.MIN_WITHDRAW_AMOUNT || 10);
    const maxWithdrawAmount = parseFloat(process.env.MAX_WITHDRAW_AMOUNT || 5000);
    
    // 验证提现金额是否在允许范围内
    if (requestAmount < minWithdrawAmount) {
      return res.status(400).json({
        success: false,
        message: `提现金额不能低于${minWithdrawAmount}元`,
        code: 400,
      });
    }
    
    if (requestAmount > maxWithdrawAmount) {
      return res.status(400).json({
        success: false,
        message: `提现金额不能超过${maxWithdrawAmount}元`,
        code: 400,
      });
    }
    
    // 获取用户提现信息
    const withdrawInfo = await UserAdapterService.getInviteWithdrawInfo(userId);
    const availableAmount = parseFloat(withdrawInfo.availableCommission);
    
    // 验证可提现金额
    if (requestAmount > availableAmount) {
      return res.status(400).json({
        success: false,
        message: "提现金额超过可提现金额",
        code: 400,
      });
    }
    
    // TODO: 实际的提现处理逻辑，可能需要调用微信支付接口
    // 这里只是模拟成功
    
    res.json({
      success: true,
      message: "提现申请已提交",
      data: {
        withdrawAmount: requestAmount.toFixed(2),
        status: "processing",
        requestTime: new Date().toISOString()
      },
    });
  } catch (error) {
    logger.error("提现申请失败:", error);
    next(error);
  }
});

module.exports = router;
