-- 创建用户表
CREATE TABLE IF NOT EXISTS user (
  id INT PRIMARY KEY AUTO_INCREMENT,
  openid VARCHAR(100) NOT NULL UNIQUE,
  nickname VARCHAR(50) DEFAULT '微信用户',
  avatar_url VARCHAR(255),
  last_login_time DATETIME,
  status TINYINT DEFAULT 0,
  register_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建编辑记录表
CREATE TABLE IF NOT EXISTS edit_record (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,
  prompt TEXT NOT NULL,
  input_images TEXT,
  output_image TEXT,
  status TINYINT DEFAULT 0,
  cost DECIMAL(10,2) DEFAULT 0,
  created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建用户余额表
CREATE TABLE IF NOT EXISTS user_balance (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL UNIQUE,
  balance DECIMAL(10,2) DEFAULT 0,
  updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建索引以提高查询性能
CREATE INDEX idx_edit_record_user_id ON edit_record(user_id);
CREATE INDEX idx_edit_record_created_at ON edit_record(created_time);
CREATE INDEX idx_user_openid ON user(openid);
CREATE INDEX idx_user_balance_user_id ON user_balance(user_id);
CREATE INDEX idx_system_config_key ON system_config(config_key);

-- 初始化测试用户的余额
INSERT INTO user_balance (user_id, balance) 
VALUES (LAST_INSERT_ID(), 0) 
ON DUPLICATE KEY UPDATE balance = VALUES(balance);

-- 创建系统配置表
CREATE TABLE IF NOT EXISTS system_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  config_key VARCHAR(50) NOT NULL UNIQUE,
  config_value TEXT,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 插入系统配置默认值
INSERT INTO system_config (config_key, config_value, description) VALUES
('max_daily_usage', '3', '每日最大免费使用次数'),
('token_expiry', '86400', 'Token过期时间（秒）'),
('api_timeout', '30000', 'API请求超时时间（毫秒）')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);