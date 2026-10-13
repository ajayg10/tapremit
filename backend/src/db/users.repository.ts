import { db } from './db';
import { v4 as uuidv4 } from 'uuid';

export interface User {
  id: string;
  handle: string;
  display_name: string;
  phone: string | null;
  wallet_address: string | null;
  created_at: string;
}

export const usersRepo = {
  create: (user: { handle: string; display_name: string; phone?: string; wallet_address?: string | null }): User => {
    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO users (id, handle, display_name, phone, wallet_address)
      VALUES (@id, @handle, @display_name, @phone, @wallet_address)
    `);
    
    try {
      stmt.run({
        id,
        handle: user.handle,
        display_name: user.display_name,
        phone: user.phone || null,
        wallet_address: user.wallet_address || null,
      });
      return usersRepo.getById(id)!;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        if (user.phone && error.message.includes('phone')) {
          try {
            stmt.run({
              id,
              handle: user.handle,
              display_name: user.display_name,
              phone: null,
              wallet_address: user.wallet_address || null,
            });
            return usersRepo.getById(id)!;
          } catch (retryError: any) {
             if (retryError.code === 'SQLITE_CONSTRAINT_UNIQUE') {
               throw { status: 409, message: 'Registration failed due to a conflict' };
             }
             throw retryError;
          }
        }
        throw { status: 409, message: 'Registration failed due to a conflict' };
      }
      throw error;
    }
  },

  setWalletAddress: (id: string, walletAddress: string): boolean => {
    const stmt = db.prepare('UPDATE users SET wallet_address = ? WHERE id = ?');
    const result = stmt.run(walletAddress, id);
    return result.changes > 0;
  },

  getById: (id: string): User | undefined => {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  },

  getByHandle: (handle: string): User | undefined => {
    return db.prepare('SELECT * FROM users WHERE handle = ?').get(handle) as User | undefined;
  },

  getByPhone: (phone: string): User | undefined => {
    return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as User | undefined;
  },
};
