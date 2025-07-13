-- 微信用户扩展表
CREATE TABLE IF NOT EXISTS `ums_member_wechat` (
  `openid` varchar(100) NOT NULL COMMENT '微信用户唯一标识', -- 主键
  `invite_code` varchar(10) DEFAULT NULL COMMENT '用户邀请码',
  `invite_from` varchar(10) DEFAULT NULL COMMENT '注册时使用的邀请码',
  `inviter_id` bigint(20) DEFAULT NULL COMMENT '邀请人ID',
  PRIMARY KEY (`openid`),
  KEY `idx_invite_code` (`invite_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT='微信用户扩展表';

-- 创建微信支付交易记录表
CREATE TABLE IF NOT EXISTS `wx_payment_transaction` (
  `order_sn` varchar(64) NOT NULL COMMENT '订单编号',
  `transaction_id` varchar(64) NOT NULL COMMENT '微信支付交易号',
  PRIMARY KEY (`order_sn`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COMMENT='微信支付交易记录表';

