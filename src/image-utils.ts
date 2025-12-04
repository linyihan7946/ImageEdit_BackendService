import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

/**
 * 将 Base64 字符串保存为本地图片
 * @param {string} base64Str - Base64 字符串（可带格式头，如 data:image/png;base64,xxx）
 * @param {string} outputPath - 输出图片路径（含文件名，如 ./images/test.png）
 * @returns {Promise} - 保存成功/失败的Promise
 */
export function base64ToImage(base64Str: string, outputPath: string): Promise<string> {
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
 * 将图片URL转换为Base64字符串
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<string>} - Base64字符串（包含格式头，如 data:image/png;base64,xxx）
 */
export async function imageUrlToBase64(imageUrl: string): Promise<string> {
  try {
    // 发送GET请求获取图片数据
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    // 从响应头获取Content-Type
    const contentType = response.headers['content-type'] || 'image/jpeg';
    
    // 将响应数据转换为Buffer
    const buffer = Buffer.from(response.data, 'binary');
    
    // 将Buffer转换为Base64字符串
    const base64String = buffer.toString('base64');
    
    // 返回带格式头的Base64字符串
    return `data:${contentType};base64,${base64String}`;
  } catch (error) {
    throw new Error(`图片URL转Base64失败：${error instanceof Error ? error.message : String(error)}`);
  }
}


/**
 * 根据URL获取图片的MIME类型
 * @param url 图片URL地址
 * @returns string 图片的MIME类型，如image/jpeg, image/png等
 */
export const getImageMimeTypeFromUrl = (url: string): string => {
  if (!url || typeof url !== 'string') {
    return 'image/jpeg'; // 默认返回JPEG格式
  }
  
  try {
    // 解析URL，移除查询参数
    // 微信小程序环境不支持原生URL构造函数，手动解析
    let pathname = url.split('?')[0]; // 去掉查询参数
    if (pathname.indexOf('://') > -1) {
      // 带协议，取path部分
      pathname = '/' + pathname.split('/').slice(3).join('/');
    }
    
    // 获取文件扩展名
    const parts = pathname.split('.');
    if (parts.length < 2) {
      return 'image/jpeg'; // 默认返回JPEG格式
    }
    
    const extension = parts.pop()?.toLowerCase() || '';
    
    // 根据扩展名映射到MIME类型
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml',
      'tif': 'image/tiff',
      'tiff': 'image/tiff'
    };
    
    // 返回对应的MIME类型，如果没有匹配的则返回默认值
    return mimeTypes[extension] || 'image/jpeg';
  } catch (error) {
    console.error('解析图片URL获取MIME类型失败:', error);
    return 'image/jpeg'; // 解析失败时返回默认值
  }
};