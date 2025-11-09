// 首先加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import { wechatLogin, authMiddleware } from './wechat-auth';
import { WechatLoginParams } from './wechat-auth';
import { setupEditImageRoute, setupEditImageNewRoute } from './edit-image';
import { setupCosAuthRoute } from './cos-auth';
import bodyParser from 'body-parser';
// const bodyParser = require('body-parser');



// 创建Express应用实例
const app = express();
// 从环境变量中读取端口配置
const PORT = process.env.PORT || 3000;

// 中间件设置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 增加请求体大小限制 (默认是100kb)
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

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

// 设置图片编辑路由
setupEditImageRoute(app);
setupEditImageNewRoute(app);

// 设置COS授权路由
setupCosAuthRoute(app);

// 接收Base64图片并上传到COS的路由
app.post('/api/upload-base64-to-cos', async (req: Request, res: Response) => {
  try {
    console.log('收到Base64图片上传请求');
    
    // 从请求体中获取参数
    const { imageBase64, imageType = 'jpg' } = req.body;
    
    // 参数验证
    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: imageBase64'
      });
    }
    
    // 检查请求体大小（用于调试大文件）
    const requestSize = JSON.stringify(req.body).length;
    console.log(`请求体大小: ${(requestSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Base64字符串长度: ${imageBase64.length}`);
    
    // 验证Base64格式
    if (!/^([A-Za-z0-9+/=]|data:image\/[^;]+;base64,)+$/.test(imageBase64)) {
      return res.status(400).json({
        success: false,
        message: '无效的Base64字符串格式'
      });
    }
    
    // 处理大Base64数据
    // 对于超大Base64，添加处理逻辑
    if (imageBase64.length > 10 * 1024 * 1024) { // 10MB
      console.warn('警告: 接收到超大Base64数据，可能需要优化处理');
    }
    
    // 导入cos-upload模块
    const { cosUploader } = require('./cos-upload');
    
    // 上传Base64到COS
    console.log('开始上传Base64数据到COS...');
    const fileUrl = await cosUploader.uploadBase64(
      imageBase64,
      `.${imageType}`,
      {
        contentType: `image/${imageType}`,
        // 对于大数据，可以添加进度回调
        onProgress: (progressData: { loaded: number; total: number; speed: number }) => {
          const percent = ((progressData.loaded / progressData.total) * 100).toFixed(2);
          const speed = (progressData.speed / 1024).toFixed(2); // KB/s
          console.log(`上传进度: ${percent}%, 速度: ${speed} KB/s`);
        }
      }
    );
    
    console.log('Base64上传成功，生成的文件URL:', fileUrl);
    
    // 返回成功响应
    return res.json({
      success: true,
      message: 'Base64图片上传到COS成功',
      data: {
        fileUrl: fileUrl,
        timestamp: new Date().toISOString(),
        base64Length: imageBase64.length
      }
    });
    
  } catch (error) {
    console.error('Base64图片上传到COS失败:', error);
    
    // 处理不同类型的错误
    if (error instanceof Error) {
      if (error.message.includes('Base64')) {
        return res.status(400).json({
          success: false,
          message: `Base64处理失败: ${error.message}`
        });
      } else if (error.message.includes('COS')) {
        return res.status(500).json({
          success: false,
          message: `COS上传失败: ${error.message}`
        });
      }
    }
    
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '服务器内部错误',
      error: error
    });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器正在运行，访问地址: http://localhost:${PORT}`);
});


// base64ToImage函数已移至edit-image.ts中