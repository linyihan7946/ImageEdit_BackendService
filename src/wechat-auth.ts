import axios from 'axios';
import { UserBalanceModel, UserModel } from './models';
import { User } from './models';

/**
 * 微信小程序登录请求参数
 */
export interface WechatLoginParams {
  code: string;
  userInfo?: {
    nickname?: string;
    avatarUrl?: string;
  };
}

/**
 * 微信登录响应结果
 */
export interface WechatLoginResult {
  openid: string;
  session_key: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  success: boolean;
  user?: {
    id: number;
    openid: string;
    nickname?: string;
    avatar_url?: string;
  };
  token?: string;
  message?: string;
}

/**
 * 微信认证类
 */
class WechatAuth {
  private appId: string;
  private appSecret: string;
  private tokenExpiry: number;

  constructor() {
    this.appId = process.env.WECHAT_APPID || '';
    this.appSecret = process.env.WECHAT_APPSECRET || '';
    this.tokenExpiry = parseInt(process.env.TOKEN_EXPIRY || '86400', 10); // 默认24小时
  }

  /**
   * 验证微信登录code
   * @param code 微信登录code
   * @returns 微信登录结果
   */
  private async verifyWechatCode(code: string): Promise<WechatLoginResult> {
    try {
      const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${this.appId}&secret=${this.appSecret}&js_code=${code}&grant_type=authorization_code`;
      const response = await axios.get<WechatLoginResult>(url);
      
      if (response.data.errcode) {
        throw new Error(`微信验证失败: ${response.data.errmsg || '未知错误'}`);
      }
      
      return response.data;
    } catch (error) {
      console.error('微信code验证失败:', error);
      throw new Error('微信验证服务暂时不可用');
    }
  }

  /**
   * 生成用户token
   * @param userId 用户ID
   * @param openid 用户openid
   * @returns 生成的token
   */
  private generateToken(userId: number, openid: string): string {
    // 这里简化实现，实际项目中应该使用JWT等安全的token生成方式
    const payload = {
      userId,
      openid,
      timestamp: Date.now(),
      expiry: Date.now() + this.tokenExpiry * 1000
    };
    
    // 实际项目中应该使用密钥进行签名
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * 解析用户token
   * @param token 用户token
   * @returns 解析后的token信息
   */
  public parseToken(token: string): { userId: number; openid: string; expiry: number } | null {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const payload = JSON.parse(decoded);
      
      // 检查token是否过期
      if (payload.expiry < Date.now()) {
        return null;
      }
      
      return { userId: payload.userId, openid: payload.openid, expiry: payload.expiry };
    } catch (error) {
      console.error('token解析失败:', error);
      return null;
    }
  }

  /**
   * 微信小程序登录
   * @param params 登录参数
   * @returns 登录响应
   */
  public async login(params: WechatLoginParams): Promise<LoginResponse> {
    try {
      // 1. 验证微信code
      const wechatResult = await this.verifyWechatCode(params.code);
      const { openid } = wechatResult;

      if (!openid) {
        return { success: false, message: '获取微信openid失败' };
      }

      // 2. 查询数据库中是否已存在该用户
      let user = await UserModel.findByOpenid(openid);
      console.log('查询用户openid:', openid);
      console.log('查询用户结果:', user);

      let isNewUser = false;

      // 3. 如果用户不存在，则创建新用户
      if (!user) {
        // 构建用户数据
        const userData = {
          openid,
          nickname: params.userInfo?.nickname || '微信用户',
          avatar_url: params.userInfo?.avatarUrl,
          last_login_time: new Date(),
          status: 0 // 正常状态
        };
        
        // 创建用户记录
        const newUserId = await UserModel.create(userData);
        console.log('新用户注册成功，用户ID:', newUserId);
        
        // 获取创建的用户信息
        user = await UserModel.findById(newUserId);
        
        if (!user) {
          return { success: false, message: '创建用户失败' };
        }
        
        isNewUser = true;
        
        // 4. 初始化新用户的余额记录
        try {
          await UserBalanceModel.init(user.id);
          console.log('用户余额初始化成功，用户ID:', user.id);
        } catch (balanceError) {
          console.error('用户余额初始化失败:', balanceError);
          // 余额初始化失败不影响用户登录
        }
      } else {
        // 5. 如果用户已存在，更新用户信息（如果有）
        const updateData: Partial<User> = {};
        
        if (params.userInfo?.nickname) {
          updateData.nickname = params.userInfo.nickname;
        }
        
        if (params.userInfo?.avatarUrl) {
          updateData.avatar_url = params.userInfo.avatarUrl;
        }
        
        // 更新最后登录时间
        updateData.last_login_time = new Date();
        
        // 只有在有数据需要更新时才调用update方法
        if (Object.keys(updateData).length > 0) {
          await UserModel.update(user.id, updateData);
          console.log('用户信息更新成功，用户ID:', user.id);
          // 重新获取更新后的用户信息
          user = await UserModel.findById(user.id);
        }
      }

      // 6. 生成token和返回登录结果
      if (!user) {
        return {
          success: false,
          message: '获取用户信息失败'
        };
      }
      
      const token = this.generateToken(user.id, user.openid);

      // 7. 返回登录结果
      return {
        success: true,
        user: {
          id: user.id,
          openid: user.openid,
          nickname: user.nickname,
          avatar_url: user.avatar_url
        },
        token,
        message: isNewUser ? '注册成功' : '登录成功'
      };
    } catch (error) {
      console.error('微信登录失败:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '登录失败，请重试'
      };
    }
  }

  /**
   * 验证用户token中间件
   * @returns 中间件函数
   */
  public authMiddleware() {
    return (req: any, res: any, next: any) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(401).json({ success: false, message: '未提供认证令牌' });
      }
      
      const tokenInfo = this.parseToken(token);
      
      if (!tokenInfo) {
        return res.status(401).json({ success: false, message: '无效或过期的令牌' });
      }
      
      // 将用户信息存储在请求对象中
      req.user = {
        userId: tokenInfo.userId,
        openid: tokenInfo.openid
      };
      
      next();
    };
  }
}

// 导出微信认证实例
export const wechatAuth = new WechatAuth();

// 导出常用函数
export const wechatLogin = async (params: WechatLoginParams): Promise<LoginResponse> => wechatAuth.login(params);
export const parseToken = (token: string): { userId: number; openid: string; expiry: number } | null => wechatAuth.parseToken(token);
export const authMiddleware = () => wechatAuth.authMiddleware();