// 首先加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import { wechatLogin, authMiddleware } from './wechat-auth';
import { WechatLoginParams } from './wechat-auth';
import { setupEditImageRoute, setupEditImageNewRoute, setupGeminiImageGenerateRoute } from './edit-image';
import { setupCosAuthRoute } from './cos-auth';
import { EditRecordModel } from './models';
import userRouter from './routes/user';
import bodyParser from 'body-parser';
import uploadRouter from './routes/upload';
import configRouter from './routes/config';
import balanceRouter from './routes/balance';



// 创建Express应用实例
const app = express();
// 从环境变量中读取端口配置
const PORT = process.env.PORT || 3000;

// 中间件设置
// 只使用bodyParser来处理请求体，避免重复解析导致stream is not readable错误
// 增加请求体大小限制到100MB
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

// 移除了express.json和express.urlencoded，避免与bodyParser冲突

// 使用上传路由
app.use('/api', uploadRouter);
app.use('/api', configRouter);
app.use('/api', balanceRouter);

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
setupGeminiImageGenerateRoute(app);

// 设置COS授权路由
setupCosAuthRoute(app);

// 用户相关路由
app.use('/api/user', userRouter);





// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器正在运行，访问地址: http://localhost:${PORT}`);
});


// base64ToImage函数已移至edit-image.ts中