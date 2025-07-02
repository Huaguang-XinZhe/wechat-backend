const { DataTypes } = require("sequelize");
const { legacySequelize } = require("../../config/legacyDatabase");

const UmsMember = legacySequelize.define(
  "UmsMember",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    member_level_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    username: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "用户名",
    },
    password: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "密码",
    },
    nickname: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "昵称",
    },
    phone: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "手机号码",
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "帐号启用状态:0->禁用；1->启用",
      defaultValue: 1,
    },
    create_time: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "注册时间",
      defaultValue: DataTypes.NOW,
    },
    icon: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "头像",
    },
    gender: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "性别：0->未知；1->男；2->女",
      defaultValue: 0,
    },
    birthday: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "生日",
    },
    city: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "所做城市",
    },
    job: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "职业",
    },
    personalized_signature: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: "个性签名",
    },
    source_type: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "用户来源",
      defaultValue: 1, // 1 表示微信小程序
    },
    integration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "积分",
      defaultValue: 0,
    },
    growth: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "成长值",
      defaultValue: 0,
    },
    luckey_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "剩余抽奖次数",
      defaultValue: 0,
    },
    history_integration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "历史积分数量",
      defaultValue: 0,
    },
  },
  {
    tableName: "ums_member",
    timestamps: false, // 不使用 Sequelize 的 createdAt 和 updatedAt
  }
);

module.exports = UmsMember;
