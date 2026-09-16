-- ============================================================
-- 修复：为 timer_sessions 与 blocked_time_slots 启用 RLS
--
-- 背景：008 与 011 建表时未启用 Row Level Security，而 Supabase 默认
--       会把 public schema 新表的全部权限授予 anon。前端使用的
--       publishable key 是公开的（打进浏览器 bundle），因此任何人
--       都能直接用该 key 读取、篡改、删除计时订单与封禁时段数据。
--       该问题已通过 publishable key 实测复现确认。
--
-- 说明：应用访问这两张表时全部走 service role（lib/supabase/admin.ts
--       的 createAdminClient），service role 天然绕过 RLS，因此这里
--       只启用 RLS、不建任何策略即 anon / authenticated 完全无权访问，
--       应用行为保持不变。
-- ============================================================

ALTER TABLE timer_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_time_slots ENABLE ROW LEVEL SECURITY;
