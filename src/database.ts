import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

// 加载环境变量
dotenv.config();

/**
 * 数据库配置接口
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  waitForConnections?: boolean;
  connectionLimit?: number;
  queueLimit?: number;
  charset?: string;  // 字符集配置
}

/**
 * 基础数据库操作类
 * 提供数据库连接、查询、插入、更新和删除等基本操作
 * 使用mysql2连接池实现高效连接管理
 */
export class Database {
  private config: DatabaseConfig;
  private pool: mysql.Pool | null = null;

  constructor() {
    // 从环境变量加载数据库配置
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'image_edit',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4'  // 添加UTF-8字符集支持，确保能正确处理中文等多字节字符
    };
  }

  /**
   * 获取数据库连接池
   */
  private async getPool(): Promise<mysql.Pool> {
    if (!this.pool) {
      this.pool = mysql.createPool(this.config);
      // 测试连接
      const connection = await this.pool.getConnection();
      connection.release();
    }
    return this.pool;
  }

  /**
   * 连接到数据库
   */
  async connect(): Promise<boolean> {
    try {
      console.log('正在连接数据库...', {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user
      });
      
      // 创建连接池
      await this.getPool();
      console.log('数据库连接池创建成功');
      return true;
    } catch (error) {
      console.error('数据库连接失败:', error);
      return false;
    }
  }

  /**
   * 断开数据库连接
   */
  async disconnect(): Promise<void> {
    try {
      if (this.pool) {
        await this.pool.end();
        this.pool = null;
        console.log('数据库连接池已关闭');
      }
    } catch (error) {
      console.error('断开数据库连接失败:', error);
    }
  }

  /**
   * 执行查询操作
   * @param query 查询语句
   * @param params 查询参数（可选）
   * @returns 查询结果数组
   */
  async query<T = any>(query: string, params?: any[]): Promise<T[]> {
    if (!query || typeof query !== 'string') {
      throw new Error('查询语句不能为空且必须是字符串');
    }

    try {
      const pool = await this.getPool();
      
      const startTime = Date.now();
      console.log('执行查询:', { query, params });
      
      // 执行实际的数据库查询
      const [rows] = await pool.execute(query, params || []);
      
      const endTime = Date.now();
      console.log('查询执行成功，耗时:', endTime - startTime, 'ms');
      
      return rows as T[];
    } catch (error) {
      console.error('查询失败:', error, { query, params });
      
      // 增强错误信息
      const enhancedError = new Error(`数据库查询失败: ${(error as Error).message}`);
      (enhancedError as any).originalError = error;
      (enhancedError as any).query = query;
      (enhancedError as any).params = params;
      
      throw enhancedError;
    }
  }

  /**
   * 执行插入操作
   * @param table 表名
   * @param data 要插入的数据
   * @returns 插入的自增ID
   */
  async insert(table: string, data: Record<string, any>): Promise<number> {
    try {
      const pool = await this.getPool();
      
      console.log('执行插入:', { table, data });
      
      // 构建插入语句
      const columns = Object.keys(data);
      const placeholders = columns.map(() => '?').join(', ');
      const values = Object.values(data);
      
      const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
      const [result] = await pool.execute(query, values);
      
      // 返回插入的ID
      return (result as any).insertId;
    } catch (error) {
      console.error('插入失败:', error);
      throw error;
    }
  }

  /**
   * 执行更新操作
   * @param table 表名
   * @param data 要更新的数据
   * @param condition 更新条件
   * @returns 更新影响的行数
   */
  async update(table: string, data: Record<string, any>, condition: string): Promise<number> {
    try {
      const pool = await this.getPool();
      
      console.log('执行更新:', { table, data, condition });
      
      // 构建更新语句
      const setClause = Object.keys(data)
        .map(key => `${key} = ?`)
        .join(', ');
      const values = Object.values(data);
      
      const query = `UPDATE ${table} SET ${setClause} WHERE ${condition}`;
      const [result] = await pool.execute(query, values);
      
      // 返回影响的行数
      return (result as any).affectedRows;
    } catch (error) {
      console.error('更新失败:', error);
      throw error;
    }
  }

  /**
   * 执行删除操作
   * @param table 表名
   * @param condition 删除条件
   * @returns 删除影响的行数
   */
  async delete(table: string, condition: string): Promise<number> {
    try {
      const pool = await this.getPool();
      
      console.log('执行删除:', { table, condition });
      
      // 执行删除语句
      const query = `DELETE FROM ${table} WHERE ${condition}`;
      const [result] = await pool.execute(query);
      
      // 返回影响的行数
      return (result as any).affectedRows;
    } catch (error) {
      console.error('删除失败:', error);
      throw error;
    }
  }

  /**
   * 执行事务
   * @param operations 事务操作函数，接收一个连接对象
   * @returns 事务执行结果
   */
  async transaction<T>(operations: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    let connection: mysql.PoolConnection | null = null;
    
    try {
      // 获取连接
      connection = await pool.getConnection();
      // 开始事务
      await connection.beginTransaction();
      console.log('开始事务');
      
      // 执行事务操作
      const result = await operations(connection);
      
      // 提交事务
      await connection.commit();
      console.log('事务提交成功');
      
      return result;
    } catch (error) {
      // 出错时回滚事务
      if (connection) {
        await connection.rollback();
        console.error('事务回滚:', error);
      }
      throw error;
    } finally {
      // 释放连接
      if (connection) {
        connection.release();
      }
    }
  }
}

// 创建数据库实例
export const db = new Database();

// 导出常用的数据库操作函数
export const connectDB = async (): Promise<boolean> => db.connect();
export const disconnectDB = async (): Promise<void> => db.disconnect();
export const queryDB = async <T = any>(query: string, params?: any[]): Promise<T[]> => db.query<T>(query, params);
export const insertDB = async (table: string, data: Record<string, any>): Promise<number> => db.insert(table, data);
export const updateDB = async (table: string, data: Record<string, any>, condition: string): Promise<number> => db.update(table, data, condition);
export const deleteDB = async (table: string, condition: string): Promise<number> => db.delete(table, condition);
export const transactionDB = async <T>(operations: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> => db.transaction(operations);