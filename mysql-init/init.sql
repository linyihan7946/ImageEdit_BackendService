-- 创建用户表
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  openid VARCHAR(100) NOT NULL UNIQUE,
  nickname VARCHAR(50) DEFAULT '微信用户',
  avatar_url VARCHAR(255),
  last_login_time DATETIME,
  status TINYINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 创建编辑记录表
CREATE TABLE IF NOT EXISTS edit_records (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,
  prompt TEXT NOT NULL,
  input_images TEXT,
  output_image TEXT,
  status TINYINT DEFAULT 0,
  cost DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 创建用户余额表
CREATE TABLE IF NOT EXISTS user_balances (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL UNIQUE,
  balance DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 创建索引以提高查询性能
CREATE INDEX idx_edit_records_user_id ON edit_records(user_id);
CREATE INDEX idx_edit_records_created_at ON edit_records(created_at);
CREATE INDEX idx_users_openid ON users(openid);

-- 插入测试数据（可选）
INSERT INTO users (openid, nickname, avatar_url, last_login_time, status) 
VALUES ('test_openid_123', '测试用户', 'https://example.com/avatar.jpg', NOW(), 0)
ON DUPLICATE KEY UPDATE nickname = VALUES(nickname), avatar_url = VALUES(avatar_url);

-- 初始化测试用户的余额
INSERT INTO user_balances (user_id, balance) 
VALUES (LAST_INSERT_ID(), 0) 
ON DUPLICATE KEY UPDATE balance = VALUES(balance);

-- 创建.env.example文件用于本地开发
CREATE TABLE IF NOT EXISTS system_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  config_key VARCHAR(50) NOT NULL UNIQUE,
  config_value TEXT,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 插入系统配置默认值
INSERT INTO system_config (config_key, config_value, description) VALUES
('max_daily_usage', '3', '每日最大免费使用次数'),
('token_expiry', '86400', 'Token过期时间（秒）'),
('api_timeout', '30000', 'API请求超时时间（毫秒）')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);