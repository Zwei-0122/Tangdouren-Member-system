# 糖豆人手工工作室 官网 + Tangdouren Club 会员系统

这是 [糖豆人手工工作室官网](https://github.com/KeMiaoDaDi/Tangdouren) 的一份完整副本，包含 **Tangdouren Club 会员系统**的完整实现。克隆下来装好依赖、填好环境变量、在 Supabase 执行两个迁移，就能在本地跑起来。

技术栈：Next.js 16（App Router）、TypeScript、Supabase、Tailwind CSS。

## 会员系统做了什么

- 会员身份：邮箱即身份，不设密码；顾客扫桌上的二维码即可加入或登录，设备会记住身份
- 到店进度：按伦敦自然日去重，同一天多次到店只算 1 次
- 奖励引擎：每 10 个计入进度的到店为一轮，第 2 次发 £2 抵用券、第 5 次 £5、第 8 次本人 85 折加朋友 9 折、第 10 次 VIP Month；第二轮门槛落在 12 / 15 / 18 / 20
- VIP Month：30 天（含首尾），不自动激活、不自动续期，生效期间进度暂停、其他奖励不失效、结算自动 85 折
- 结算接入：店员在结算面板选择会员奖励，金额由服务端计算并复核，撤销结算可回退未使用的奖励

## 怎么跑起来

先读 **[docs/会员系统交付说明.md](docs/会员系统交付说明.md)**，里面有完整步骤、口径解释、验证情况和未完成项。三步概览：

```bash
# 1. 环境变量（不进仓库）
#    建 .env.local，填 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
#    SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_APP_URL

# 2. 把 supabase/migrations/016_members.sql 与 017_member_settlement.sql
#    按顺序在 Supabase 的 SQL Editor 里执行一次（顺序不能反）

# 3. 起服务（用 localhost，不要用 127.0.0.1）
npm install
npm run dev -- -p 3002
```

验证：

```bash
node --experimental-strip-types --test tests/member.test.ts
npx tsc --noEmit
npm run build
```

数据库层验收脚本在 `docs/verify_member_system.sql`（26 项，全程一个事务，最后 ROLLBACK，不留数据）。

## 当前状态

| 项 | 状态 |
| --- | --- |
| 会员系统代码（顾客端 + 后台） | 完成 |
| 单元测试 32 项 | 通过 |
| 类型检查、构建 | 通过 |
| 迁移 | 已在测试库执行成功，52 项校验通过；线上库由店主侧执行 `docs/上线迁移-一次执行.sql` |
| 后台交互人工点测 | 未做 |
| PRD 10.3 朋友直接使用 9 折的 UI | 未做（API 已支持） |

细节见 [docs/会员系统交付说明.md](docs/会员系统交付说明.md)。
