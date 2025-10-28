// 首先加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import axios from 'axios';
import { connectDB } from './database';
import { wechatLogin, authMiddleware } from './wechat-auth';
import { WechatLoginParams } from './wechat-auth';

// 从环境变量中读取API端点配置
const API_ENDPOINT = process.env.API_ENDPOINT || 'https://api.apiyi.com/v1/chat/completions';

// 创建Express应用实例
const app = express();
// 从环境变量中读取端口配置
const PORT = process.env.PORT || 3000;

// 初始化数据库连接
// connectDB().catch(err => {
//   console.error('数据库初始化失败:', err);
//   // 数据库连接失败不阻止服务器启动，但会记录错误
// });

// 中间件设置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 微信登录路由
app.post('/api/wechat/login', async (req: Request, res: Response) => {
  try {
    const params: WechatLoginParams = req.body;
    
    // 参数验证
    if (!params.code) {
      return res.status(400).json({ success: false, message: '缺少必要参数code' });
    }
    
    // 调用微信登录逻辑
    const result = await wechatLogin(params);
    
    if (result.success) {
      return res.json(result);
    } else {
      return res.status(401).json(result);
    }
  } catch (error) {
    console.error('微信登录接口错误:', error);
    return res.status(500).json({ 
      success: false, 
      message: error instanceof Error ? error.message : '服务器内部错误' 
    });
  }
});

// 测试需要认证的路由
app.get('/api/user/info', authMiddleware(), (req: Request, res: Response) => {
  // @ts-ignore
  const userInfo = req.user;
  return res.json({
    success: true,
    message: '已成功认证',
    user: userInfo
  });
});

// 接收图片链接的POST请求
app.post('/process-image', (req: Request, res: Response) => {
  console.log('收到处理图片的POST请求');
  
  // 从请求体中获取图片链接
  const { imageUrl } = req.body;
  
  // 验证参数
  if (!imageUrl) {
    return res.status(400).json({ 
      success: false, 
      message: '缺少必要参数: imageUrl' 
    });
  }
  
  // 验证URL格式（简单验证）
  try {
    new URL(imageUrl);
  } catch (error) {
    return res.status(400).json({ 
      success: false, 
      message: '无效的图片链接格式' 
    });
  }
  
  // 这里可以添加图片处理逻辑
  console.log('接收到的图片链接:', imageUrl);
  
  // 返回成功响应
  res.json({
    success: true,
    message: '图片链接接收成功',
    data: {
      imageUrl: imageUrl,
      timestamp: new Date().toISOString()
    }
  });
});

// 图片编辑接口转发
app.post('/edit-image', async (req: Request, res: Response) => {
  console.log('收到图片编辑请求');
  const API_KEY = process.env.API_KEY || '';
  
  try {
    // 从请求体中获取参数
    const { instruction, imageUrls } = req.body;
    
    // 验证必要参数
    if (!instruction) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数: instruction' 
      });
    }
    
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数: imageUrls（必须是非空数组）' 
      });
    }
    
    // 验证所有图片URL格式
    for (const url of imageUrls) {
      try {
        new URL(url);
      } catch (error) {
        return res.status(400).json({ 
          success: false, 
          message: `无效的图片链接格式: ${url}` 
        });
      }
    }
    
    // 构建转发请求体
    const requestBody = {
      model: 'gemini-2.5-flash-image',
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: instruction
            },
            ...imageUrls.map(url => ({
              type: 'image_url',
              image_url: {
                url: url
              }
            }))
          ]
        }
      ]
    };
    
    console.log('转发到API的请求体:', JSON.stringify(requestBody, null, 2));
    
    // 发送请求到目标API
    const response = await axios.post(API_ENDPOINT, requestBody, {
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // 返回API响应
    res.json({
      success: true,
      message: '图片编辑请求处理成功',
      data: response.data
    });
    
  } catch (error: any) {
    console.error('图片编辑请求失败:', error.message || error);
    
    // 处理错误响应
    if (error.response) {
      // 服务器返回了错误状态码
      res.status(error.response.status || 500).json({
        success: false,
        message: 'API调用失败',
        error: error.response.data || error.message
      });
    } else if (error.request) {
      // 请求已发送但没有收到响应
      res.status(504).json({
        success: false,
        message: 'API请求超时或无响应',
        error: 'Network Error'
      });
    } else {
      // 其他错误
      res.status(500).json({
        success: false,
        message: '服务器内部错误',
        error: error.message || 'Unknown Error'
      });
    }
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器正在运行，访问地址: http://localhost:${PORT}`);
});