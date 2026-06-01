// Supabase 客户端 — 缺少环境变量时优雅降级为 no-op，不阻塞主应用
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

let _supabase: SupabaseClient<Database> | null = null;
let _initFailed = false;

function tryCreateClient(): SupabaseClient<Database> | null {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || (typeof process !== 'undefined' && process.env?.SUPABASE_URL);
  const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || (typeof process !== 'undefined' && process.env?.SUPABASE_PUBLISHABLE_KEY);

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    if (!_initFailed) {
      console.warn('[Supabase] 环境变量未配置，在线统计和 Presence 功能将不可用');
      _initFailed = true;
    }
    return null;
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== 'undefined' ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    }
  });
}

// 生成一个安全的 no-op Proxy：任何方法调用都返回 resolved Promise，避免报错
function createNoOpProxy(): SupabaseClient<Database> {
  const noopAsync = () => Promise.resolve({ data: null, error: null });
  const noopChannel = {
    on: () => noopChannel,
    subscribe: () => noopChannel,
    untrack: () => noopChannel,
    track: () => Promise.resolve(noopChannel),
    presenceState: () => ({}),
  };

  return new Proxy({} as SupabaseClient<Database>, {
    get(_, prop) {
      if (prop === 'channel') return () => noopChannel;
      if (prop === 'from') return () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: noopAsync,
            single: noopAsync,
          }),
        }),
        update: () => ({
          eq: noopAsync,
        }),
        insert: noopAsync,
      });
      if (prop === 'removeChannel') return () => {};
      // 其他属性返回自身以支持链式调用
      return new Proxy(() => Promise.resolve({ data: null, error: null }), {
        apply: () => Promise.resolve({ data: null, error: null }),
        get: (_, p2) => {
          if (p2 === 'then') return undefined; // 避免 thenable 误判
          return () => noopAsync;
        },
      });
    },
  });
}

// 惰性初始化：首次访问时尝试创建客户端，失败则返回 no-op
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_, prop, receiver) {
    if (!_supabase && !_initFailed) {
      _supabase = tryCreateClient();
    }
    const client = _supabase || createNoOpProxy();
    return Reflect.get(client, prop, receiver);
  },
});
