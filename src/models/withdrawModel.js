const { DataTypes } = require("sequelize");
const { legacySequelize } = require("../config/legacyDatabase");
const Joi = require("joi");

// 提现记录模型
const WxWithdrawRecord = legacySequelize.define(
  "wx_withdraw_record",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    member_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: "会员ID",
    },
    openid: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "微信用户唯一标识",
    },
    out_bill_no: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "商户转账单号",
    },
    transfer_bill_no: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "微信转账单号",
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: "提现金额",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "PROCESSING",
      comment: "状态：PROCESSING-处理中，SUCCESS-成功，FAILED-失败",
    },
    remark: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "备注",
    },
    create_time: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "创建时间",
    },
    update_time: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "更新时间",
    },
    order_amount_total: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: "订单总金额",
    },
    commission_rate: {
      type: DataTypes.DECIMAL(5, 4),
      allowNull: false,
      comment: "分成比例",
    },
    related_orders: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "关联的订单编号，JSON格式",
    },
    related_trans_ids: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "关联的微信交易ID，JSON格式",
    },
  },
  {
    tableName: "wx_withdraw_record",
    timestamps: false,
    indexes: [
      {
        name: "idx_member_id",
        fields: ["member_id"],
      },
      {
        name: "idx_openid",
        fields: ["openid"],
      },
      {
        name: "idx_out_bill_no",
        fields: ["out_bill_no"],
      },
      {
        name: "idx_status",
        fields: ["status"],
      },
    ],
  }
);

// 提现请求验证 schema
const withdrawRequestSchema = Joi.object({
  testMode: Joi.boolean().default(false),
  remark: Joi.string().allow("").optional(),
});

// 生成提现单号
const generateWithdrawBillNo = () => {
  return `WD${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
};

module.exports = {
  WxWithdrawRecord,
  withdrawRequestSchema,
  generateWithdrawBillNo,
}; 