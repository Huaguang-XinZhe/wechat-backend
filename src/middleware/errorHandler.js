const logger = require("../utils/logger");

// 全局错误处理中间件
function errorHandler(err, req, res, next) {
  let error = { ...err };
  error.message = err.message;

  // 记录错误日志
  logger.error(`Error: ${error.message}`, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    stack: err.stack,
  });

  // Sequelize 验证错误
  if (err.name === "SequelizeValidationError") {
    const message = err.errors.map((error) => error.message).join(", ");
    error = {
      message,
      statusCode: 400,
    };
  }

  // Sequelize 唯一约束错误
  if (err.name === "SequelizeUniqueConstraintError") {
    const message = "数据已存在，请检查输入";
    error = {
      message,
      statusCode: 400,
    };
  }

  // JWT 错误
  if (err.name === "JsonWebTokenError") {
    const message = "无效的访问令牌";
    error = {
      message,
      statusCode: 401,
    };
  }

  // JWT 过期错误
  if (err.name === "TokenExpiredError") {
    const message = "访问令牌已过期";
    error = {
      message,
      statusCode: 401,
    };
  }

  // Joi 验证错误
  if (err.isJoi) {
    const message = err.details[0].message;
    error = {
      message: message.replace(/"/g, ""),
      statusCode: 400,
    };
  }

  // 微信 API 错误
  if (err.errcode) {
    const message = getWechatErrorMessage(err.errcode);
    error = {
      message,
      statusCode: 400,
      wechatError: {
        errcode: err.errcode,
        errmsg: err.errmsg,
      },
    };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "服务器内部错误",
    code: error.statusCode || 500,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    ...(error.wechatError && { wechatError: error.wechatError }),
  });
}

// 微信错误码转换
function getWechatErrorMessage(errcode) {
  const errorMessages = {
    40001: "AppSecret 错误或者 AppSecret 不属于这个小程序",
    40002: "请确保 grant_type 字段值为 client_credential",
    40013: "不合法的 AppID",
    40029: "code 无效",
    45011: "API 调用太频繁，请稍候再试",
    40163: "code 已被使用",
    // 支付相关错误
    ORDERPAID: "商户订单已支付",
    SYSTEMERROR: "系统错误",
    INVALID_REQUEST: "参数错误",
    NOAUTH: "商户无权限",
    AMOUNT_LIMIT: "金额超限",
  };

  return errorMessages[errcode] || `微信接口错误: ${errcode}`;
}

module.exports = errorHandler;
