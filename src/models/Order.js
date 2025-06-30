const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Order = sequelize.define(
  "Order",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    order_no: {
      type: DataTypes.STRING(50),
      unique: true,
      allowNull: false,
      comment: "订单号",
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "用户ID",
    },
    openid: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "微信用户标识",
    },
    goods_name: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: "商品名称",
    },
    goods_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "商品ID",
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: "订单金额（元）",
    },
    currency: {
      type: DataTypes.STRING(10),
      defaultValue: "CNY",
      comment: "货币类型",
    },
    status: {
      type: DataTypes.ENUM(
        "pending",
        "paid",
        "cancelled",
        "refunded",
        "failed"
      ),
      defaultValue: "pending",
      comment:
        "订单状态：pending-待支付，paid-已支付，cancelled-已取消，refunded-已退款，failed-支付失败",
    },
    payment_method: {
      type: DataTypes.STRING(20),
      defaultValue: "wechat_pay",
      comment: "支付方式",
    },
    prepay_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "微信预支付交易会话标识",
    },
    transaction_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "微信支付订单号",
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "支付时间",
    },
    cancelled_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "取消时间",
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "订单过期时间",
    },
    remark: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "备注",
    },
    client_ip: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "客户端IP",
    },
    notify_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "支付结果通知地址",
    },
  },
  {
    tableName: "orders",
    comment: "订单表",
    indexes: [
      {
        unique: true,
        fields: ["order_no"],
      },
      {
        fields: ["user_id"],
      },
      {
        fields: ["openid"],
      },
      {
        fields: ["status"],
      },
      {
        fields: ["transaction_id"],
      },
      {
        fields: ["created_at"],
      },
    ],
  }
);

// 实例方法
Order.prototype.isPaid = function () {
  return this.status === "paid";
};

Order.prototype.canCancel = function () {
  return this.status === "pending";
};

Order.prototype.canRefund = function () {
  return this.status === "paid";
};

// 类方法
Order.findByOrderNo = function (orderNo) {
  return this.findOne({ where: { order_no: orderNo } });
};

Order.findByTransactionId = function (transactionId) {
  return this.findOne({ where: { transaction_id: transactionId } });
};

Order.findUserOrders = function (userId, options = {}) {
  const { page = 1, limit = 10, status } = options;
  const offset = (page - 1) * limit;

  const where = { user_id: userId };
  if (status) {
    where.status = status;
  }

  return this.findAndCountAll({
    where,
    limit,
    offset,
    order: [["created_at", "DESC"]],
  });
};

// 生成订单号
Order.generateOrderNo = function () {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `WX${timestamp}${random}`;
};

module.exports = Order;
