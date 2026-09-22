# GitHub 访问失败排查与修复（本机 hosts）

> 类型：开发环境 / 工具配置（非业务文档）
> 适用：本机 Windows 上 `git` / `gh` 访问 `github.com` 失败
> 记录：Coco，2026-09-23
> 关联：`AGENTS.md` 第 10 条（网络失败重试上限）；触发场景见 `bugs/bug-00022-tie-candidate-wrong-answer.md`（A011 推送与发起 PR）

## 现象

`git push` / `git fetch` 反复失败，报错形如：

```
fatal: unable to access 'https://github.com/youkinn/dev-docs.git/':
Failed to connect to github.com:443 after 21064 ms: Could not connect to server
```

极易被误判为「GitHub 挂了」或「本机断网」，实际两者都不是。

## 定位

按「断网 → GitHub 故障 → 本机解析 / 路由」的顺序逐层排除：

| 检查 | 命令 | 本次读数 | 结论 |
|------|------|----------|------|
| 外网是否通 | `Test-NetConnection www.baidu.com -Port 443` | `True` | 不是断网 |
| 域名是否解析 | `Resolve-DnsName github.com -Type A` | `20.205.243.166` | 解析正常 |
| 目标端口 | `Test-NetConnection github.com -Port 443` | **`False`** | 卡在 TCP 层 |
| 其他 GitHub 端点 | `api.github.com` / `codeload.github.com` / `ssh.github.com` 的 443 | 全 `True` | 不是 GitHub 整体不可用 |
| 代理 | `git config --get http.proxy`、系统代理开关 | 空 / 关闭 | 不是代理问题 |
| 换 IP 直连 | `Test-NetConnection 140.82.114.3 -Port 443` | `True` | **只有解析出的那个 IP 不通** |
| TLS 能否走通 | `curl.exe --resolve github.com:443:140.82.114.3 -sS -o NUL -w "%{http_code}" "https://github.com/youkinn/dev-docs.git/info/refs?service=git-upload-pack"` | `200` | 换 IP 后完整可用 |

**根因**：本机 `hosts` 里装有 **GitHub520** 的托管块（`# GitHub520 Host Start` … `# GitHub520 Host End`），把 `github.com` 钉在 `20.205.243.166`；该 IP 已不可达（TCP 443 超时），而 GitHub 的 `140.82.x.x` 段正常。即：**不是断网、不是 GitHub 故障，是 hosts 里的 IP 过期。**

## 修复

只改 `github.com` 一行映射（`C:\Windows\System32\drivers\etc\hosts`，需管理员权限）：

```
# 修改前
20.205.243.166                github.com
# 修改后
140.82.114.3                  github.com
```

刷 DNS 缓存：

```powershell
ipconfig /flushdns
Resolve-DnsName github.com -Type A   # 期望返回脚本选定的 IP
```

改完 `git push` 与 `gh pr create` 立即恢复。

### 一键脚本（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fix-github-hosts.ps1 [-DryRun]
```

做的事：按候选表探测可用 IP（先 TCP 预筛 3 s，再用 `curl --resolve` 做 **TLS 实测** —— 实测发现「TCP 能握手、TLS 被卡死」的 IP 仍不可用，只测 TCP 会误选）→ 当前 IP 可用就直接退出 → 否则备份 hosts、只改 `github.com` 一行、刷 DNS → **只输出一行结论**。`-DryRun` 只报选定结果、不改文件。

## 验证

- `Resolve-DnsName github.com -Type A` → 脚本选定的 IP（本次 `140.82.112.3`）
- `git push origin <分支>` 成功（本次 `dev-docs` 推至 `83db091`）
- `gh pr create` 成功（本次 `mcp-orchestrator#18`、`dev-docs#27`）

## 风险与已知约束

1. **会复发**：GitHub520 有定时同步，下次同步会把它自己那套（含已失效的 `20.205.243.166`）写回，覆盖本次修改。复发时跑上面的脚本即可（或按「修复」手动重做），也可停掉 GitHub520 的自动更新任务。
2. **IP 会变，且阻断是间歇性的**：实测 2026-09-23 当天 `140.82.114.3`、`140.82.113.3` 先后失效，而同一时刻其他 GitHub IP 仍通 —— 不要写死单一 IP，用脚本重新探测。
3. **只改一行**：本次 `api.github.com` / `codeload.github.com` 等条目实测正常，未动；不要顺手全量替换。
4. **影响范围是整机**：hosts 是机器级配置，影响本机所有程序对 `github.com` 的解析。

## 备份与回滚

改动前的 hosts 已备份至 `C:\Users\YEXIN\hosts.bak-20260923`；脚本每次改动也会另存一份到 `%TEMP%\hosts.bak-<时间戳>`。回滚：覆盖回 `C:\Windows\System32\drivers\etc\hosts`，再 `ipconfig /flushdns`。