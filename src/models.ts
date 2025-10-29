import { queryDB, insertDB, updateDB, deleteDB, transactionDB } from './database';

/**
 * 用户表类型定义
 */
export interface User {
  id: number;
  openid: string;
  nickname?: string;
  avatar_url?: string;
  register_time: Date;
  last_login_time?: Date;
  status: number; // 0 - 正常，1 - 封禁
}

/**
 * 编辑记录表类型定义
 */
export interface EditRecord {
  id: number;
  user_id: number;
  prompt: string;
  input_images: string;
  output_image?: string;
  status: number; // 0 - 处理中，1 - 成功，2 - 失败
  cost: number;
  created_time: Date;
  completed_time?: Date;
}

/**
 * 用户余额表类型定义
 */
export interface UserBalance {
  id: number;
  user_id: number;
  balance: number;
  updated_time: Date;
}

/**
 * 扣款记录表类型定义
 */
export interface DeductRecord {
  id: number;
  user_id: number;
  edit_record_id: number;
  amount: number;
  balance_after: number;
  created_time: Date;
  remark?: string;
}

// 用户表操作
export const UserModel = {
  /**
   * 根据ID获取用户
   */
  async findById(id: number): Promise<User | null> {
    const results = await queryDB('SELECT * FROM user WHERE id = ?', [id]);
    return results.length > 0 ? results[0] as User : null;
  },

  /**
   * 根据openid获取用户
   */
  async findByOpenid(openid: string): Promise<User | null> {
    const results = await queryDB('SELECT * FROM user WHERE openid = ?', [openid]);
    return results.length > 0 ? results[0] as User : null;
  },

  /**
   * 创建新用户
   */
  async create(data: Omit<User, 'id' | 'register_time'>): Promise<number> {
    return await insertDB('user', {
      ...data,
      register_time: new Date()
    });
  },

  /**
   * 更新用户信息
   */
  async update(id: number, data: Partial<User>): Promise<number> {
    // 移除id字段，避免更新
    const updateData = { ...data };
    delete updateData.id;
    
    return await updateDB('user', updateData, `id = ${id}`);
  },

  /**
   * 更新用户最后登录时间
   */
  async updateLastLogin(id: number): Promise<number> {
    return await updateDB('user', { last_login_time: new Date() }, `id = ${id}`);
  },

  /**
   * 禁用/启用用户
   */
  async updateStatus(id: number, status: number): Promise<number> {
    return await updateDB('user', { status }, `id = ${id}`);
  }
};

// 编辑记录表操作
export const EditRecordModel = {
  /**
   * 根据ID获取记录
   */
  async findById(id: number): Promise<EditRecord | null> {
    const results = await queryDB('SELECT * FROM edit_record WHERE id = ?', [id]);
    return results.length > 0 ? results[0] as EditRecord : null;
  },

  /**
   * 获取用户的编辑记录列表
   */
  async findByUserId(userId: number, limit: number = 20, offset: number = 0): Promise<EditRecord[]> {
    const results = await queryDB(
      'SELECT * FROM edit_record WHERE user_id = ? ORDER BY created_time DESC LIMIT ? OFFSET ?',
      [userId, limit, offset]
    );
    return results as EditRecord[];
  },

  /**
   * 创建新的编辑记录
   */
  async create(data: Omit<EditRecord, 'id' | 'created_time'>): Promise<number> {
    return await insertDB('edit_record', {
      ...data,
      created_time: new Date()
    });
  },

  /**
   * 更新编辑记录状态
   */
  async updateStatus(id: number, status: number, outputImage?: string): Promise<number> {
    const updateData: any = { status };
    if (outputImage) updateData.output_image = outputImage;
    if (status !== 0) updateData.completed_time = new Date();
    
    return await updateDB('edit_record', updateData, `id = ${id}`);
  },

  /**
   * 获取处理中的记录
   */
  async findProcessing(limit: number = 10): Promise<EditRecord[]> {
    const results = await queryDB(
      'SELECT * FROM edit_record WHERE status = 0 ORDER BY created_time ASC LIMIT ?',
      [limit]
    );
    return results as EditRecord[];
  },

  /**
   * 获取用户今日编辑次数
   */
  async getUserTodayCount(userId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const results = await queryDB(
      'SELECT COUNT(*) as count FROM edit_record WHERE user_id = ? AND created_time >= ?',
      [userId, today]
    );
    
    return results[0]?.count || 0;
  }
};

// 用户余额表操作
export const UserBalanceModel = {
  /**
   * 获取用户余额
   */
  async findByUserId(userId: number): Promise<UserBalance | null> {
    const results = await queryDB('SELECT * FROM user_balance WHERE user_id = ?', [userId]);
    return results.length > 0 ? results[0] as UserBalance : null;
  },

  /**
   * 初始化用户余额
   */
  async init(userId: number): Promise<number> {
    // 检查是否已存在
    const existing = await this.findByUserId(userId);
    if (existing) return existing.id;
    
    // 创建新记录
    const balanceId = await insertDB('user_balance', {
      user_id: userId,
      balance: 0.00,
      updated_time: new Date()
    });
    console.log('用户余额记录创建成功，ID:', balanceId);
    return balanceId;
  },

  /**
   * 更新用户余额
   */
  async update(userId: number, balance: number): Promise<number> {
    // 尝试更新，如果不存在则插入
    const updated = await updateDB('user_balance', { 
      balance, 
      updated_time: new Date() 
    }, `user_id = ${userId}`);
    
    // 如果没有更新任何记录，则插入新记录
    if (updated === 0) {
      return await this.init(userId);
    }
    
    return updated;
  },

  /**
   * 增加用户余额
   */
  async add(userId: number, amount: number): Promise<number> {
    // 先确保记录存在
    await this.init(userId);
    
    // 使用SQL直接增加余额，避免并发问题
    const results = await queryDB(
      `UPDATE user_balance SET balance = balance + ?, updated_time = NOW() WHERE user_id = ?`,
      [amount, userId]
    );
    
    const affectedRows = Array.isArray(results) ? 0 : (results as any).affectedRows || 0;
    console.log(`用户余额增加成功，用户ID: ${userId}，增加金额: ${amount}，影响行数: ${affectedRows}`);
    return affectedRows;
  },

  /**
   * 减少用户余额（事务安全）
   */
  async deduct(userId: number, amount: number, editRecordId: number, remark?: string): Promise<boolean> {
    try {
      return await transactionDB(async () => {
        // 检查余额是否足够
        const balanceInfo = await this.findByUserId(userId);
        if (!balanceInfo || balanceInfo.balance < amount) {
          throw new Error('余额不足');
        }
        
        const newBalance = balanceInfo.balance - amount;
        
        // 更新余额
        await updateDB('user_balance', { 
          balance: newBalance, 
          updated_time: new Date() 
        }, `user_id = ${userId}`);
        
        // 记录扣款
        await insertDB('deduct_record', {
          user_id: userId,
          edit_record_id: editRecordId,
          amount,
          balance_after: newBalance,
          created_time: new Date(),
          remark: remark || '图片编辑消耗'
        });
        
        return true;
      });
    } catch (error) {
      console.error('余额扣除失败:', error);
      return false;
    }
  }
};

// 扣款记录表操作
export const DeductRecordModel = {
  /**
   * 根据ID获取扣款记录
   */
  async findById(id: number): Promise<DeductRecord | null> {
    const results = await queryDB('SELECT * FROM deduct_record WHERE id = ?', [id]);
    return results.length > 0 ? results[0] as DeductRecord : null;
  },

  /**
   * 获取用户的扣款记录列表
   */
  async findByUserId(userId: number, limit: number = 20, offset: number = 0): Promise<DeductRecord[]> {
    const results = await queryDB(
      'SELECT * FROM deduct_record WHERE user_id = ? ORDER BY created_time DESC LIMIT ? OFFSET ?',
      [userId, limit, offset]
    );
    return results as DeductRecord[];
  },

  /**
   * 获取编辑记录相关的扣款记录
   */
  async findByEditRecordId(editRecordId: number): Promise<DeductRecord | null> {
    const results = await queryDB('SELECT * FROM deduct_record WHERE edit_record_id = ?', [editRecordId]);
    return results.length > 0 ? results[0] as DeductRecord : null;
  },

  /**
   * 获取用户今日扣款总额
   */
  async getUserTodayTotal(userId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const results = await queryDB(
      'SELECT SUM(amount) as total FROM deduct_record WHERE user_id = ? AND created_time >= ?',
      [userId, today]
    );
    
    return results[0]?.total || 0;
  }
};

/**
 * 事务操作：创建编辑记录并扣除余额
 */
export async function createEditWithDeduct(
  userId: number,
  prompt: string,
  inputImages: string[],
  cost: number
): Promise<{ success: boolean; editRecordId?: number; message?: string }> {
  try {
    return await transactionDB(async (connection) => {
      // 1. 检查余额是否足够
      const balanceQuery = 'SELECT balance FROM user_balance WHERE user_id = ? FOR UPDATE';
      const balanceResults = await queryDB(balanceQuery, [userId]);
      
      if (balanceResults.length === 0) {
        throw new Error('用户余额记录不存在');
      }
      
      const currentBalance = balanceResults[0].balance;
      if (currentBalance < cost) {
        throw new Error('余额不足');
      }
      
      // 2. 创建编辑记录
      const inputImagesStr = inputImages.join(',');
      const editRecordId = await EditRecordModel.create({
        user_id: userId,
        prompt,
        input_images: inputImagesStr,
        status: 0, // 处理中
        cost
      });
      
      // 3. 扣除余额
      const deductSuccess = await UserBalanceModel.deduct(
        userId,
        cost,
        editRecordId,
        `图片编辑消耗 - 记录ID: ${editRecordId}`
      );
      
      if (!deductSuccess) {
        throw new Error('余额扣除失败');
      }
      
      return { success: true, editRecordId };
    });
  } catch (error) {
    console.error('创建编辑记录并扣款失败:', error);
    return { success: false, message: error instanceof Error ? error.message : '操作失败' };
  }
}