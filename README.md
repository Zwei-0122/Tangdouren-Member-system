# 糖豆人会员系统 · 整合包

这个包**只含会员系统的改动**，用来贴到现有的官网（主站）仓库上。里面没有整站副本，也没有本地环境、测试数据与依赖。

| 项 | 值 |
| --- | --- |
| 基线 | `KeMiaoDaDi/Tangdouren` 的 `main`，提交 `7836e6b` |
| 已在干净基线上实测 | 补丁 `git am` 全部干净应用；bundle fetch 后与本仓库开发分支**文件树哈希完全一致**（`3800cd22`） |
| 应用后实测 | 单测 33 项通过、`tsc --noEmit` 无输出、`npm run build` 通过 |
| 改动规模 | 37 个文件：新增 24 个、改动 13 个 |

## 一句话顺序

1. 先执行数据库迁移
2. 再应用代码改动（补丁或 bundle，二选一）
3. 验证

---

## 一、数据库迁移（必须最先做）

把 `docs/上线迁移-一次执行.sql` 的**全部内容**粘进 Supabase 的 SQL Editor，按一次 **Run**。

- 这是 `supabase/migrations/016_members.sql` 与 `017_member_settlement.sql` 的合并版，顺序已排好，可以重复执行。
- 会弹 `Potential issue detected / destructive operations`，这是正常的，点 **Run query** 继续。它删的只有旧的 5 参数版结算函数、以及两张新表上刚建的约束，**不动任何现有数据**。
- 看到 `Success. No rows returned` 就是完成了，不到一分钟。
- **迁移没执行完，会员功能不可用；计时、预约、结算、优惠券等现有路径不受影响**（这是刻意设计的，迁移可以挑不忙的时候跑）。
- 店主视角的操作说明在 `docs/给店主的一页说明.md`，可以直接转发给他。

## 二、应用代码改动（二选一）

### 路线 A：补丁系列（推荐，改动逐条可读）

```bash
cd 主站仓库
git checkout main
git am /path/to/tangdouren-membership/patches/*.patch
```

8 个补丁按序应用，保留原提交信息与作者。

> PowerShell / CMD 下 `*` 不会被展开，会报 `fatal: could not open 'patches/*.patch' for reading`。
> 改用 Git Bash 打开照样能跑，或走路线 B，或按 `0001…0008` 逐个文件名应用。

### 路线 B：bundle（一条命令，任何 shell 都一样）

```bash
cd 主站仓库
git fetch /path/to/Tangdouren-membership.bundle refs/heads/main:membership
git merge membership
```

bundle 是**增量**包：主站仓库必须已经含有基线提交 `7836e6b`，否则 fetch 会报缺对象。

---

## 三、改动清单

### 新增 24 个文件

| 路径 | 作用 |
| --- | --- |
| `supabase/migrations/016_members.sql` | 建 `members` 表；给 `timer_sessions` 加 `member_id`、`reward_eligible` 两列 |
| `supabase/migrations/017_member_settlement.sql` | 建 `member_rewards`、`member_benefits` 两张表、`member_visit_days` 视图、六个函数；把 `settle_timer_session` 从 5 参数扩到 8 参数（老调用照旧可用） |
| `lib/member/member.ts` | 会员纯逻辑：邮箱归一、到店日期口径、奖励档位与轮次、折扣计算、月卡日期与状态 |
| `lib/member/service.ts` | 会员数据访问：身份查询、会员页数据、奖励可用性、结算前的会员信息 |
| `lib/member/client.ts` | 浏览器端「记住这台设备」的会员身份（不是凭证，每次进页面都回服务端重查） |
| `components/member/MemberProgressBar.tsx` | 十格进度条，2/5/8/10 是奖励节点，带说明（电脑悬停、手机点开） |
| `app/(site)/self-timer/club/page.tsx` | 顾客的会员页：进度、奖励、到店记录、激活月卡 |
| `app/api/member/join/route.ts` | 加入会员 |
| `app/api/member/lookup/route.ts` | 已有会员按邮箱识别 |
| `app/api/member/dashboard/route.ts` | 会员页数据 |
| `app/api/member/activate-vip/route.ts` | 激活 VIP 月卡 |
| `app/api/admin/members/route.ts` | 后台会员列表 |
| `app/api/admin/members/[id]/route.ts` | 后台会员详情、挂订单、核销/转赠、激活月卡、停用 |
| `app/(admin)/dashboard/members/page.tsx` | 后台会员列表页 |
| `app/(admin)/dashboard/members/[id]/page.tsx` | 后台会员详情页 |
| `tests/member.test.ts` | 会员单元测试 33 项 |
| `README.md` | 仓库根 README（主站原先没有 README，一并补上） |
| `docs/` 下 7 个 | 交付说明、给店主的一页说明、迁移一次性脚本、三个验收脚本 |

### 改动 13 个既有文件

这些文件主站里本来就有。如果你那边也动过同一个文件，重点看这几处：

| 文件 | 改了什么 |
| --- | --- |
| `lib/timer/selfService.ts` | 开始计时时按邮箱解析会员并写入归属；查不到或已停用一律按普通顾客继续，不阻断计时 |
| `app/api/self-timer/start/route.ts` | 接收可选的 `memberEmail`（留空 = 不以会员身份开始） |
| `app/(site)/self-timer/page.tsx` | 加会员入口与加入/登录三个界面；表单按会员身份开始；会员相关文案只在中文界面出现 |
| `app/(site)/booking/page.tsx` | 预约第 4 步加「顺便加入糖豆人会员」勾选框（仅中文界面），提交时带上 `joinClub` |
| `app/api/bookings/route.ts` | 勾选后随预约建会员；英文提交（`lang === 'en'`）即使带 `joinClub` 也不建会员 |
| `lib/email/templates/confirmation.ts` | 确认邮件补一句会员身份（只中文版） |
| `lib/i18n/translations.ts` | 预约页第 4 步与成功提示的会员文案 |
| `lib/coupon/service.ts` | 会员相关错误码的中文文案（与 `lib/member/service.ts` 一致） |
| `app/api/admin/timers/[id]/route.ts` | 结算接口：接收折扣来源（不用券 / 用券 / 会员奖励 / VIP 月卡）与会员参数，回传该单会员信息 |
| `app/api/admin/timers/route.ts` | 计时列表附带会员姓名（单独查一次，不做 join：迁移未执行的环境里没有 `member_id` 列） |
| `app/(admin)/dashboard/timers/[id]/page.tsx` | 结算面板：会员折扣、奖励选择、VIP 提示、柜台上改用其他优惠 |
| `app/(admin)/dashboard/timers/page.tsx` | 计时列表加会员列 |
| `components/admin/Sidebar.tsx` | 后台侧栏加入「会员」入口 |

---

## 四、环境变量与依赖

**都不需要新增。**

- `package.json`、`package-lock.json` 未改动，没有新依赖，不需要 `npm install` 新包。
- 新增代码里没有引用任何新的环境变量，主站现有的四个够用：
  `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_APP_URL`。

## 五、验证

```bash
node --test tests/member.test.ts    # 会员 33 项，应全过（全仓 77 项）
npx tsc --noEmit                    # 应无输出
npm run build                       # 应 Compiled successfully
```

可选（需要 service key 的机器 / 本地 dev server）：

- `docs/verify_via_api.py`：64 项真实数据校验，输出 `通过 64/64`
- `docs/场景演练_via_api.py`：96 项按店里真实流程走一遍（散客不填邮箱、同一天来两次、跨夜单、忘填邮箱补挂、用券、撤销、VIP 到期、20 次老顾客、顾客页看到什么），跑完自动清场

浏览器里走一遍：`/self-timer` → 会员入口 → 填注册邮箱加入 → `/self-timer/club` 看进度与奖励；后台 `/dashboard/members` 看会员列表与详情。

## 六、有意没放进去的

- 本地的 `.env.local`、`node_modules`、`.next`（这些本来就不该进仓库）
- 我们测试库里的测试会员数据（`demo.a@` / `demo.b@tangdouren.test`），主站不需要
- 没有任何图片、二进制或站点素材改动

---

## 附：这个会员系统的既定口径

维护时会问到「为什么这么定」，先写在这里（都是业主 2026-09-16 / 09-17 拍板的）：

| 情况 | 规则 |
| --- | --- |
| VIP 月卡生效期间能不能用别的优惠 | 默认按 VIP 的 85 折结算；柜台可以点「改用其他优惠」，选一张券或一项会员奖励替代（当次放弃 VIP，剩余天数不顺延）。只有「不使用优惠」被拦，不允许 VIP 会员按原价结账 |
| VIP 期间到店算不算奖励进度 | 算。那 30 天的到店照常累积进度，攒满 10 次一样解锁下一张月卡（同一时间只有一张生效，第二张要等当前这张到期后再手动激活） |
| 能不能把已经结算的订单补挂到会员 | 能。但只记「这一单是他来的」：不加奖励进度、不退折扣、不补发奖励、不动已收金额；已经属于别的会员的订单不能改归属 |
| 英文界面 | 暂不开放会员制度：入口、计时表单的会员身份、预约页勾选都不出现；服务端在 `/api/bookings` 另按 `lang === 'zh'` 拦一道 |
| 会员怎么识别 | 邮箱即身份，不设密码、不发会员码；扫桌上的码输注册邮箱即可，设备会记住。金额与资格一律服务端按数据库核验，改页面或截图骗不过去 |

细节（包括与 PRD v1 的四处差异、迁移做了什么、验证情况与未完成项）见 `docs/会员系统交付说明.md`。
