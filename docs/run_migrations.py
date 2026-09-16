#!/usr/bin/env python3
# ============================================================
# 在 Supabase 测试项目上执行会员系统的两个迁移，并跑验收检查
#
# 用法：
#   python3 run_migrations.py preflight   # 只看当前库的结构，不改任何东西
#   python3 run_migrations.py migrate     # 依次执行 016、017
#   python3 run_migrations.py verify      # 跑验收检查（全程一个事务，最后 ROLLBACK，不留数据）
#   python3 run_migrations.py all         # preflight + migrate + verify
#
# Token 从 ~/.hermes/secrets/supabase_pat 或环境变量 SUPABASE_ACCESS_TOKEN 读取，绝不打印。
# ============================================================

import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

PROJECT_REF = "rlakqwmedlgpcdasvads"
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
REPO = pathlib.Path.home() / "Desktop/Projects/Tangdouren"
WORKDIR = pathlib.Path(__file__).resolve().parent
TOKEN_FILE = pathlib.Path.home() / ".hermes/secrets/supabase_pat"


def load_token() -> str:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token and TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text().strip()
    if not token:
        sys.exit(f"没有读到 token。把它存到 {TOKEN_FILE}，或设 SUPABASE_ACCESS_TOKEN 环境变量。")
    if not token.startswith("sbp_"):
        print(f"警告：token 不像 Personal Access Token（应以 sbp_ 开头，当前是 {token[:4]}…）")
    return token


def run_sql(token: str, sql: str, label: str):
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        print(f"\n✗ {label} 失败：HTTP {e.code}")
        print(detail[:2000])
        return None
    except Exception as e:  # noqa: BLE001
        print(f"\n✗ {label} 请求异常：{e}")
        return None
    try:
        return json.loads(raw) if raw.strip() else []
    except json.JSONDecodeError:
        return raw


def show_rows(rows, title):
    print(f"\n── {title} ──")
    if not isinstance(rows, list):
        print(rows)
        return
    for r in rows:
        if isinstance(r, dict):
            print("  " + " | ".join(f"{k}={v}" for k, v in r.items()))
        else:
            print("  " + str(r))


PREFLIGHT = """
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('members','member_rewards','member_benefits')) AS member_tables,
  (SELECT count(*) FROM information_schema.views
    WHERE table_schema='public' AND table_name='member_visit_days') AS visit_view,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('settle_timer_session','unsettle_timer_session','ensure_member_rewards',
       'member_vip_active','link_timer_session_to_member','activate_member_vip')) AS member_functions,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='timer_sessions' AND column_name='member_id') AS ts_member_id,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='timer_sessions' AND column_name='reward_eligible') AS ts_reward_eligible,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings' AND column_name='member_id') AS bk_member_id,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='coupons' AND column_name='code') AS coupons_code
"""

NOT_NULLS = """
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='timer_sessions' AND is_nullable='NO'
 ORDER BY ordinal_position
"""


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    token = load_token()

    if mode in ("preflight", "all"):
        show_rows(run_sql(token, PREFLIGHT, "preflight"), "迁移前结构（members 相关应为 0）")
        show_rows(run_sql(token, NOT_NULLS, "timer_sessions 的 NOT NULL 列"), "必填列")

    if mode in ("migrate", "all"):
        for name in ("016_members.sql", "017_member_settlement.sql"):
            path = REPO / "supabase/migrations" / name
            sql = path.read_text(encoding="utf-8")
            print(f"\n▶ 执行 {name}（{len(sql.encode('utf-8'))} 字节）…")
            result = run_sql(token, sql, name)
            if result is None:
                return
            print(f"✓ {name} 执行完成：{result if result else '（无返回）'}")
        show_rows(run_sql(token, PREFLIGHT, "迁移后结构"), "迁移后结构（预期全是 1 / members 表 3）")

    if mode in ("verify", "all"):
        path = WORKDIR / "verify_member_system.sql"
        print(f"\n▶ 跑验收检查 {path.name}（最后会 ROLLBACK，不留测试数据）…")
        rows = run_sql(token, path.read_text(encoding="utf-8"), "验收检查")
        if rows is None:
            return
        if isinstance(rows, list) and rows and isinstance(rows[0], dict) and "结果" in rows[0]:
            ok = sum(1 for r in rows if r.get("结果") == "PASS")
            bad = [r for r in rows if r.get("结果") != "PASS"]
            for r in rows:
                mark = "✔" if r.get("结果") == "PASS" else "✗"
                print(f"  {mark} [{r.get('编号')}] {r.get('检查项')}  期望={r.get('期望')}  实际={r.get('实际')}")
            print(f"\n{ok}/{len(rows)} 项通过")
            if bad:
                print("未通过的项目：")
                for r in bad:
                    print(f"  - {r.get('检查项')}: 期望 {r.get('期望')}，实际 {r.get('实际')}")
        else:
            show_rows(rows, "验收检查原始返回")


if __name__ == "__main__":
    main()
