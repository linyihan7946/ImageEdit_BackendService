import { Request, Response, Express } from 'express';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { EditRecordModel } from './models';

// 从环境变量中读取API端点配置
const API_ENDPOINT = process.env.API_ENDPOINT || 'https://api.apiyi.com/v1/chat/completions';

// 确保图片保存目录存在
const IMAGES_DIR = path.join(__dirname, '../images');
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  console.log(`创建图片保存目录: ${IMAGES_DIR}`);
}

/**
 * 将 Base64 字符串保存为本地图片
 * @param {string} base64Str - Base64 字符串（可带格式头，如 data:image/png;base64,xxx）
 * @param {string} outputPath - 输出图片路径（含文件名，如 ./images/test.png）
 * @returns {Promise} - 保存成功/失败的Promise
 */
function base64ToImage(base64Str: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // 移除 Base64 字符串中的格式头（如 data:image/png;base64,）
      const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, '');
      
      // 将 Base64 字符串转换为 Buffer
      const buffer = Buffer.from(base64Data, 'base64');
      
      // 创建输出目录（如果不存在）
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // 写入文件
      fs.writeFile(outputPath, buffer, (err) => {
        if (err) {
          reject(`保存失败：${err.message}`);
        } else {
          resolve(`图片已保存至：${outputPath}`);
        }
      });
    } catch (error) {
      reject(`处理失败：${error}`);
    }
  });
}

/**
 * 设置图片编辑路由
 * @param app Express应用实例
 */
export function setupEditImageRoute(app: Express): void {
  // 图片编辑接口转发
  app.post('/edit-image', async (req: Request, res: Response) => {
    console.log('收到图片编辑请求');
    const API_KEY = process.env.API_KEY || '';
    
    const req1: any = req;
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

      // 保存API响应到本地文件
      const timestamp = Date.now();
      const data = response.data;
      const choices: any[] = data.choices;
      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        const message = choice.message;
        if (!message) {
          continue;
        }
        const content: string = message.content;
        const first = content.indexOf("(");
        const last = content.indexOf(")");
        if (first === -1 || last === -1) {
          continue;
        }
        const base64 = content.substring(first + 1, last);
        console.log("base64:", base64);
        const imagePath = path.join(IMAGES_DIR, 'image_' + timestamp + '_' + i + '.png');
        await base64ToImage(base64, imagePath);
        console.log('图片已保存到:', imagePath);
      }
      
      // 记录操作到数据库
      try {
        // 尝试从请求中获取用户ID，如果没有则使用默认值0表示未登录用户
        const userId = req1.user?.id || 0;
        
        // 创建编辑记录
        const recordId = await EditRecordModel.create({
          user_id: userId,
          prompt: instruction,
          input_images: JSON.stringify(imageUrls),
          status: 1, // 1表示成功
          cost: 0 // 可以根据实际情况设置成本
        });
        
        console.log(`操作已成功记录到数据库，记录ID: ${recordId}`);
      } catch (dbError) {
        console.error('记录操作到数据库失败:', dbError);
        // 数据库错误不影响API响应返回
      }
      
      // 返回API响应
      res.json({
        success: true,
        message: '图片编辑请求处理成功',
        data: response.data
      });
      
    } catch (error: any) {
      console.error('图片编辑请求失败:', error.message || error);
      
      // 记录失败操作到数据库
      try {
        // 尝试从请求中获取用户ID，如果没有则使用默认值0表示未登录用户
        const userId = req1.user?.id || 0;
        
        // 创建失败的编辑记录
        await EditRecordModel.create({
          user_id: userId,
          prompt: req.body.instruction || '',
          input_images: JSON.stringify(req.body.imageUrls || []),
          status: 2, // 2表示失败
          cost: 0
        });
        
        console.log('失败操作已记录到数据库');
      } catch (dbError) {
        console.error('记录失败操作到数据库失败:', dbError);
      }
      
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
}