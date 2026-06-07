# tre-mem 🎋

[![CI](https://github.com/rumitvn/tre-mem/actions/workflows/ci.yml/badge.svg)](https://github.com/rumitvn/tre-mem/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tre-mem?cacheSeconds=3600)](https://www.npmjs.com/package/tre-mem)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

> _Tre — bộ rễ chung cho codebase của bạn._

> 🇬🇧 English version: [README.md](./README.md)

Tre là hình ảnh thân thuộc của làng quê Việt Nam — biểu tượng của sự **bền
bỉ, gắn bó, và gốc rễ**. Lũy tre xanh là nhiều thân tre vươn lên từ chung một
bộ rễ, đung đưa riêng trong gió nhưng đứng vững cùng nhau qua mọi cơn bão.
Các branch của một codebase cũng lớn lên như vậy: mỗi branch là một feature
riêng, nhưng tất cả đều từ một dòng history chung.

<img width="1376" height="768" alt="Gemini_Generated_Image_39r50l39r50l39r5" src="https://github.com/user-attachments/assets/231a353f-8725-42dd-90c5-c2ffddd46570" />

Đó cũng là điều `tre-mem` mang đến cho AI assistant của bạn: mỗi branch có
tiếng nói riêng, nhưng gốc rễ chung của codebase vẫn vẹn nguyên. Một tầng
memory branch-aware đặt trên [claude-mem](https://github.com/thedotmack/claude-mem),
để Claude Code / Cursor / Gemini CLI hiểu đúng **feature bạn đang làm**,
không chỉ _repo bạn đang ở_.

`tre-mem` là sidecar của claude-mem. Nó **không** fork hay chỉnh sửa claude-mem —
chỉ thêm một adapter read-only, tag mọi observation theo git branch nó được sinh
ra, rồi expose API retrieval 3-signal (semantic + branch + recency) qua MCP để
Claude Code / Cursor / Gemini CLI nhìn thấy context theo branch thay vì memory
flat theo repo.

> **Điểm nhấn:** pin một quyết định, chạy **một lệnh**, là nó đã nằm trong git của
> cả team. Đồng đội chạy `git pull` và AI của họ đã biết — **không cần server,
> không API key, không bắt buộc GitHub.** Nhảy thẳng tới [Memory nhóm](#memory-nhóm--đẩy-memory-của-bạn-lên-git-tính-năng-đinh).

<p align="center">
  <b><a href="#vì-sao-cần-tre-mem">Vì sao</a></b> ·
  <b><a href="#cài-đặt">Cài đặt</a></b> ·
  <b><a href="#dùng-từ-claude-code-luồng-thực-tế-hằng-ngày">Dùng hằng ngày</a></b> ·
  <b><a href="#memory-nhóm--đẩy-memory-của-bạn-lên-git-tính-năng-đinh">Memory nhóm</a></b> ·
  <b><a href="#xem-trực-quan--dashboard-nhóm-v05">Dashboard</a></b> ·
  <b><a href="#vượt-ra-ngoài-claude-code--đa-công-cụ-v06">Đa công cụ</a></b> ·
  <b><a href="#mcp-tools">MCP tools</a></b> ·
  <b><a href="#bộ-lệnh-cli">CLI</a></b> ·
  <b><a href="#license">License</a></b>
</p>

## Vì sao cần tre-mem

claude-mem ingest session rất tốt nhưng index flat theo project. Đổi từ
`feature/payment` sang `fix/auth-jwt-expiry` thì assistant vẫn thấy lẫn lộn
Stripe webhook với JWT context. tre-mem xử lý điều đó:

- **Tag branch live** qua chokidar watcher trên `.git/HEAD`.
- **Backfill lịch sử** qua `git reflog` để observation cũ cũng có branch.
- **Rerank 3-signal**: semantic (FTS5/BM25), branch locality, recency-trong-branch,
  cộng thêm pin boost cho fact muốn ghim vào branch.
- **MCP server** expose 9 tool để Claude Code gọi retrieval branch-aware, đồng thời
  curate, công bố và thu hồi memory — trực tiếp.

Trên chính repo tre-mem, rerank nâng precision@10 từ **0.19** (FTS5 baseline thuần)
lên **0.97**. Xem [BENCHMARK.md](./docs/BENCHMARK.md) để biết chi tiết harness.

## Cài đặt

```bash
# 1. Cài đặt
npm i -g tre-mem      # hoặc: pnpm add -g tre-mem

# 2. Khởi tạo sidecar DB ở ~/.tre-mem/
tre init

# 3. Backfill branch tag cho observation cũ của claude-mem (chạy mỗi repo)
cd /duong/dan/toi/repo
tre backfill
```

Yêu cầu:

- Node 20+
- claude-mem đã cài và đang ingest (tre đọc từ `~/.claude-mem/claude-mem.db`)
- `git` trong PATH

## Đăng ký MCP server với Claude Code

Cách khuyến nghị:

```bash
claude mcp add -s user tre-mem -- tre mcp
```

(hoặc, nếu bạn clone từ source và `tre` chưa có trong PATH, trỏ thẳng vào CLI
đã build: `claude mcp add -s user tre-mem -- node /abs/path/to/tre-mem/dist/cli.js mcp`)

Kiểm tra trong Claude Code bằng `/mcp`. Sẽ thấy:

```
tre-mem · connected · 9 tools
```

## Đăng ký SessionStart hook (tùy chọn nhưng nên có)

Refresh `branch_state` mỗi khi Claude Code mở session, để retrieval luôn biết
branch nào đang active kể cả giữa các chu kỳ watcher. Xem [docs/HOOKS.md](./docs/HOOKS.md)
để có snippet đăng ký và bảng troubleshooting. Tóm tắt: thêm vào
`~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "tre hook session-start" }]
      }
    ]
  }
}
```

## Dùng từ Claude Code (luồng thực tế hằng ngày)

Bạn hiếm khi gõ `tre` thủ công. tre-mem đăng ký một MCP server **và** một
SessionStart hook, nên vòng lặp thật sự là: **Claude hiển thị ngữ cảnh theo
branch khi mở phiên, còn bạn chọn lọc bằng cách trò chuyện với nó.** Phần CLI bên
dưới chỉ là lối thoát thủ công.

### Bạn thấy gì khi một phiên bắt đầu

Khi đã đăng ký hook, mỗi phiên Claude Code mở ra cùng một digest theo branch
(`systemMessage` của hook, hiển thị màu trong terminal). Thấy nó hiện ra nghĩa là
nó đang chạy:

```text
[tre-mem] recent context · feature/payment · shop · 4:12pm
Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
tagged: 38 on branch · 232 on project · imported: 1pin/0grad · source: startup

📌 Pinned on this branch
#411 ⚖️ Simulator Mock Features Strategy: File Download and MQTT Playgrounds [shared]
   ↳ vì sao chọn mock MQTT + download thay vì gọi thẳng staging

#412 🔵 CardApi Endpoints for Student, Deny, and Blackcard List Synchronization
#410 🔵 Simulator Web Infrastructure and API Routing for New Features
```

Khối `📌 Pinned` đẩy các quyết định đã chọn lọc — kèm ghi chú giải thích _vì sao_
— lên đầu. `[shared]` nghĩa là pin đến từ `git push` của đồng đội và được tự động
import trong phiên này. Dòng `imported: 1pin/0grad` xác nhận việc import đã xảy ra.

### Chọn lọc bằng cách nói với Claude, không phải CLI

Việc pin là chủ đích theo thiết kế — một pin được **boost 1.0** khi tìm kiếm (luôn
ở đầu), nên nếu _mọi thứ_ đều tự pin thì chẳng còn gì nổi bật. Nhưng bạn điều
khiển nó bằng ngôn ngữ tự nhiên qua các MCP tool `pin_fact` / `graduate_fact`;
Claude còn có thể tự viết ghi chú giúp bạn:

| Bạn nói với Claude…                                            | Claude gọi…                                    |
| -------------------------------------------------------------- | ---------------------------------------------- |
| "Pin quyết định này cho cả team: mình dùng Stripe webhook v3." | `pin_fact` (ghi chú trên branch hiện tại)      |
| "Nhớ lý do chọn MQTT thay vì polling — chia sẻ cho team."      | `pin_fact` trên quyết định ⚖️ then chốt        |
| "Ngữ cảnh của branch này là gì?" / "Mình đã quyết gì về X?"    | `get_branch_context` → xếp hạng, pin lên đầu   |
| "Cho xem timeline của feature này."                            | `get_branch_timeline`                          |
| "Branch này đã merge — đưa các quyết định lên phạm vi repo."   | `graduate_fact` (hoặc Action lúc merge tự làm) |

Sau đó chạy `tre share` (một lệnh: export + commit + push) và đồng đội tự động
thừa hưởng pin trong phiên kế tiếp — hiện trong digest của họ với nhãn `[shared]`
như trên.

## Bộ lệnh CLI

```bash
tre init                                # tạo ~/.tre-mem/ + chạy migration
tre status [path]                       # project / branch / số lượng tag cho cwd
tre backfill [path] [--project SLUG]    # tag lịch sử qua git reflog
tre search "<query>" [--branch B] [--k 10]
tre pin <observation_id> [--note "..."]
tre graduate <observation_id>           # promote fact từ branch → project-wide
tre list-branches [--project SLUG]
tre logs [--tail 50 | --all] [--level warn] [--path]  # log chẩn đoán cục bộ
tre mcp                                 # khởi động MCP server (stdio)

# --- chia sẻ cho nhóm ---
tre share [--branch B | --all] [--message M] [--no-push] [--no-commit]  # đẩy memory lên git (một bước)
tre export [--branch B | --all] [--force] [--dry-run]   # cấp thấp: chỉ ghi pin → .tre-mem/
tre import [--from .tre-mem] [--force]                   # kéo pin của đồng đội về
tre graduate-pr <PR# | branch> [--dry-run]               # graduate một branch đã merge (mọi provider)
tre graduate-merge                                       # graduate branch vừa merge (hook post-merge)
tre setup claude-code [--auto-inject] [--with-hook]      # nối hook (+ hook graduate-on-merge cục bộ)
tre hook session-start | user-prompt-submit              # Claude Code gọi
```

`tre search` in top-K kèm score breakdown để thấy rõ vì sao mỗi hit có rank đó:

```
tre-mem search "stripe webhook"
  project: shop
  branch:  feature/payment
  k:       10 (returned 4)

  [1.800] #938  feat(stripe): retry handler for failed charges
         sem 0.40  branch 0.40  rec 0.20  pin 1.00
  [0.600] #1034 BMOtpTextView keyboard handling
         sem 0.40  branch 0.00  rec 0.20  pin 0.00
  ...
```

## MCP tools

| Tool                  | Input                                | Output                                         |
| --------------------- | ------------------------------------ | ---------------------------------------------- |
| `get_branch_context`  | `query`, `project?`, `branch?`, `k?` | Top-K observations, kèm breakdown rerank       |
| `get_branch_timeline` | `branch`, `project?`, `limit?`       | Feed theo thời gian cho 1 branch               |
| `list_branches`       | `project?`                           | Các branch kèm số lượng tag                    |
| `pin_fact`            | `observation_id`, `branch?`, `note?` | Ghim fact vào branch (boost = 1.0)             |
| `graduate_fact`       | `observation_id`                     | Promote fact từ branch lên scope project       |
| `unpin_fact`          | `observation_id`, `branch?`          | Gỡ pin (ghi tombstone nếu đã chia sẻ)          |
| `ungraduate_fact`     | `observation_id`                     | Gỡ fact đã graduate (tombstone nếu đã chia sẻ) |
| `export_memory`       | `branch?`, `all?`, `force?`          | Ghi `.tre-mem/` + commit cục bộ (không push)   |
| `get_share_status`    | `project?`                           | Số lượng pending / shared / graduated          |

Sau khi assistant pin hoặc graduate một fact, nó có thể gọi **`export_memory`** để
công bố: lệnh này ghi các file `.tre-mem/` và tạo một **commit git cục bộ** — nó
**không bao giờ** push, nên bạn tự review rồi `git push` khi sẵn sàng (tool trả về
đúng câu lệnh cần chạy). Lệnh fail-closed với secret: một lần export bị chặn chỉ báo
_loại_ secret khớp, không bao giờ lộ giá trị.

Khi một fact lỗi thời — feedback PR của leader, bug phát hiện ở QC — assistant gọi
**`unpin_fact`** hoặc **`ungraduate_fact`** để thu hồi. Nếu fact đã được chia sẻ,
lệnh này ghi một **tombstone** vào `.tre-mem/`; ở lần `git pull` kế tiếp mọi clone
của đồng đội tự động bỏ nó. Để _sửa_ một fact, ungraduate cái cũ rồi `graduate_fact`
observation đã sửa.

## Memory xuyên nhiều clone

Nếu bạn clone cùng một repo vào nhiều thư mục (ví dụ `app`, `app-2`, `app-3`) để
làm song song nhiều branch, tre-mem **hợp nhất memory của chúng** — chúng được nhận
diện là một project nhờ chung `remote.origin.url`. `tre status` hiển thị `remote:`
chuẩn và các `linked clones`. Mặc định bật; đặt `TRE_MEM_CROSS_CLONE=0` để giữ từng
thư mục độc lập. Định dạng `.tre-mem/` được commit không đổi, nên đồng đội không bị
ảnh hưởng.

## Log chẩn đoán

tre-mem ghi một file log JSONL nhỏ (chỉ ghi nối thêm) tại `~/.tre-mem/tre-mem.log` để
bạn xem nó đã làm gì trên máy và chia sẻ khi cần gỡ lỗi. File **chỉ chứa số liệu và
metadata** — tên branch/project, số lượng sự kiện, id, thời lượng, lớp + thông điệp lỗi.
Nó **không bao giờ** ghi nội dung query, prompt, hay nội dung pin/note, nên file an toàn
để gửi đi.

```bash
tre logs                 # 50 dòng JSONL gần nhất
tre logs --all           # toàn bộ file (tiện để thu thập cuối ngày)
tre logs --level warn    # chỉ cảnh báo + lỗi
tre logs --component mcp # chỉ sự kiện MCP
tre logs --path          # in đường dẫn file (để cat / copy)
tre logs --clear         # xóa rỗng log (và xóa bản backup .1)
```

| Biến môi trường     | Mặc định                     | Ý nghĩa                                      |
| ------------------- | ---------------------------- | -------------------------------------------- |
| `TRE_MEM_LOG`       | bật                          | đặt `0`/`false`/`off` để tắt logging         |
| `TRE_MEM_LOG_LEVEL` | `info`                       | mức tối thiểu: `debug`/`info`/`warn`/`error` |
| `TRE_MEM_LOG_FILE`  | `<TRE_MEM_HOME>/tre-mem.log` | ghi đè đường dẫn tuyệt đối                   |

File tự xoay vòng sang `tre-mem.log.1` khi vượt 5 MB, nên không bao giờ phình vô hạn.

## Memory nhóm — đẩy memory của bạn lên git (tính năng đinh)

Đây chính là thứ tre-mem _sinh ra để làm_. Pin một quyết định, chạy **một lệnh**, là
nó đã nằm trong git của cả team. Đồng đội chạy `git pull` và AI của họ đã biết —
Claude Code, Codex, Gemini, Cursor, dùng gì cũng được. **Không cần server, không API
key, không bắt buộc GitHub**: GitHub, GitLab, Bitbucket, hay một bare remote trần
trụi — miễn là git thì chạy được.

```
   alice@laptop                          bob@laptop
   ~/.tre-mem/  (private sidecar)         ~/.tre-mem/  (private sidecar)
        │ tre share                             ▲ tre import (auto on SessionStart)
        ▼                                       │
   repo/.tre-mem/  ── git push ── git pull ── repo/.tre-mem/
        (merge=union: two sharers never conflict — git keeps both)
```

```bash
# alice, trên feature/payment
tre pin 1234 --note "use Stripe webhook v3"
tre share                                # export + git add + commit + push — một bước

# bob
git pull                                 # tre import tự chạy ở phiên kế tiếp của bob
#   → AI của bob giờ hiện pin của alice, gắn nhãn [shared]
```

Đó là toàn bộ vòng lặp. `tre share` ghi các fact đã chọn lọc của bạn vào `.tre-mem/`,
commit, rồi push; nếu branch chưa có upstream nó in ra đúng câu `git push -u …`.
(`tre export` vẫn là primitive cấp thấp "chỉ ghi file" nếu bạn muốn tự lái git.)

Các đặc điểm chính:

- **Một lệnh, mọi git host.** `tre share` bên dưới chỉ là git thuần — chạy với
  GitHub, GitLab, Bitbucket, hay một bare remote. Không khóa vào provider nào.
- **Chỉ pin + fact đã graduated được chia sẻ.** Observation thô vẫn riêng tư trong
  `~/.claude-mem/` của từng người.
- **Redaction fail-closed.** Việc chia sẻ từ chối ghi secret phát hiện được (private
  key, API token, JWT…) trừ khi bạn truyền `--force` (lúc đó thay chúng bằng
  `[REDACTED:*]`). File `.tre-mem/.shareignore` theo từng repo thêm được glob.
- **Xung đột "giữ cả hai".** `.tre-mem/.gitattributes` đặt `*.jsonl merge=union`, nên
  hai đồng đội chia sẻ cùng lúc không bao giờ dính merge conflict — git giữ cả hai
  phía và `tre import` khử trùng lặp khi đọc.
- **Graduate khi merge, không cần CI.** `tre setup … --with-hook` cài một git hook
  `post-merge` cục bộ, promote pin của branch đã merge thành fact phạm vi repo — trên
  mọi provider. Thích CI hơn? Vài dòng YAML GitLab/Bitbucket/bất kỳ runner nào gọi
  `tre graduate-pr` làm điều tương tự. Không có GitHub Action khóa vào vendor.

Hướng dẫn đầy đủ: [docs/TEAM-WORKFLOW.md](./docs/TEAM-WORKFLOW.md). Nâng cấp từ v0.1 là
tự động — xem [docs/MIGRATION-v1-v2.md](./docs/MIGRATION-v1-v2.md).

## Xem trực quan — dashboard nhóm (v0.5)

Phase 2 đưa memory đi qua git; **v0.5 cho cả nhóm _nhìn thấy_ nó.** Chạy `tre web`
để mở dashboard cục bộ, chỉ-đọc: cây nhánh (branch graph), các quyết định đã pin,
fact đã graduated, và những gì chưa được chia sẻ — cập nhật trực tiếp khi repo và
sidecar thay đổi. Không tài khoản, không cloud; chỉ bind `127.0.0.1`.

```bash
tre web                 # khởi động + mở trình duyệt (Ctrl-C để dừng)
tre web --background    # chạy nền; quản lý bằng `tre web status` / `tre web stop`
```

- **Branch graph** — mỗi nhánh kèm số observation đã tag, số pin, lần hoạt động
  gần nhất, và `HEAD` hiện tại.
- **Team memory** — ai đã pin gì và vì sao, kèm các fact đã graduated, với nhãn
  `shared via git ✓` / `not shared yet`.
- **Search** — theo nhánh, kèm phân rã điểm theo từng tín hiệu.
- **Live** — phản ứng khi đổi nhánh, khi đồng đội `git pull` / `tre import`, và khi
  pin được ghi từ terminal khác (SSE).

Hoạt động cả khi **không có claude-mem** (chế độ shared-memory-only: pin +
graduated từ sidecar/`.tre-mem/`, tìm kiếm substring). Hướng dẫn đầy đủ:
[docs/WEB-UI.md](./docs/WEB-UI.md).

## Thương hiệu & thiết kế — xanh tre (v0.8)

`tre` nghĩa là _bamboo_ (cây tre), nên từ v0.8 tre-mem **trông** như tre. Dashboard
được đổi tông sang xanh jade làm màu chính trên nền giấy dó ngả xanh, với một bảng
màu "lũy tre" thống nhất cho branch graph (cả light + dark đều có chủ đích); digest
lúc SessionStart và CLI cũng ngả xanh — `🎋 tre-mem · recent context …`. Toàn bộ bộ
nhận diện — bảng màu OKLCH kèm ánh xạ sang ANSI cho terminal, chú giải spine ngữ
nghĩa, typography và chuyển động — được ghi lại như nguồn chân lý duy nhất trong
[docs/BRAND.md](./docs/BRAND.md).

## Vượt ra ngoài Claude Code — đa công cụ (v0.6)

tre-mem nói **MCP**, nên memory nhóm chia sẻ qua git đi tới mọi harness lớn. Cấu
hình tất cả cùng lúc:

```bash
tre setup --all                # claude-code (repo) + mọi harness đã cài
tre setup --all --auto-inject  # bật cả inject context theo từng prompt
```

Hoặc từng cái: `tre setup codex` · `codex-desktop` · `gemini` · `cursor` ·
`antigravity`. Mỗi lệnh đăng ký MCP server của tre-mem (và với Codex/Gemini thêm
hook SessionStart + prompt tùy chọn) — idempotent, không ghi đè cấu hình khác.

**Hai tầng:** _consume_ (memory nhóm + xếp hạng theo nhánh) chạy trên mọi harness
qua MCP của tre-mem; _ingest_ (ghi observation) là việc của **claude-mem**, và
claude-mem v13+ ingest từ Claude Code, Codex, Gemini, Cursor, Antigravity vào một
DB chung. Vì vậy tìm kiếm branch-aware đầy đủ có sẵn ở bất cứ máy nào đã cài +
đang ingest claude-mem — chạy `tre doctor` để xem chế độ máy này (`full` /
`shared-only`) và tình trạng ingest. Hướng dẫn: [docs/CROSS-TOOL.md](./docs/CROSS-TOOL.md).

## Kiến trúc

```
Claude Code / Cursor / Gemini CLI
              │ (MCP stdio)
              ▼
   tre-mem MCP server (TS)
              │
   ┌──────────┴──────────────┐
   │  Retrieval engine        │   3-signal rerank
   │  (semantic + branch + recency)
   └──────┬──────────────┬────┘
          │              │
   ┌──────▼─────┐  ┌─────▼────────────┐
   │ tre-mem.db │  │ claude-mem.db     │  ← READ-ONLY (better-sqlite3)
   │ (sidecar)  │  │ observations, FTS5│
   │ branch_tag │  │ session_summaries │
   │ branch_pin │  └───────────────────┘
   │ graduated  │
   └────────────┘
          ▲
   ┌──────┴───────────┐
   │  Git watcher      │  chokidar trên .git/HEAD theo từng repo
   │  + reflog backfill│
   └───────────────────┘
```

Năm module: `adapter/` (reader cho claude-mem), `git/` (watcher + resolver +
reflog), `store/` (sidecar DB + repo), `retrieval/` (3-signal + rerank),
`mcp/` (server + tools). Xem [CLAUDE.md](./CLAUDE.md) và [PLAN.md](./PLAN.md)
để biết toàn bộ thiết kế.

## Trạng thái

**Hiện tại: v0.10.0 — export do agent điều khiển + memory xuyên nhiều clone.** Được
phủ bởi **366 tests**, xanh trên Node 20 + 22. [CHANGELOG.md](./CHANGELOG.md) theo
dõi từng release; [PLAN.md](./PLAN.md) là chỉ mục roadmap.

Đã ship tới nay:

| Version    | Chủ đề                                                                              |
| ---------- | ----------------------------------------------------------------------------------- |
| **v0.10**  | `export_memory` do agent điều khiển + hợp nhất memory xuyên clone (theo git remote) |
| **v0.9**   | "The Grove" — đồ thị contributor + bảng xếp hạng + i18n tiếng Việt đầy đủ           |
| **v0.8**   | Bộ nhận diện xanh tre (web + terminal), `docs/BRAND.md` làm SSOT                    |
| **v0.7**   | "Chia sẻ, rõ như ban ngày" — `tre share` một lệnh, graduate-on-merge cục bộ         |
| **v0.6**   | Đa công cụ — Codex / Gemini / Cursor / Antigravity qua MCP                          |
| **v0.5**   | Dashboard nhóm cục bộ (`tre web`) — branch graph + memory nhóm, live (SSE)          |
| **v0.2–4** | Chia sẻ nhóm git-native — export/import, redaction, graduate branch                 |
| **v0.1**   | Retrieval branch-aware (rerank 3-signal) + MCP server                               |

Ngoài phạm vi (hiện tại):

- Sync hosted / cloud (tre-mem giữ local-first; git là phương tiện vận chuyển)
- Mã hóa memory cho repo nhạy cảm (BYO-key)
- Ingest độc lập — ghi observation là việc của **claude-mem**, không phải của tre-mem

## License

MIT. Xem [LICENSE](./LICENSE).

---

🎋 _Làm với tình thương, từ một bụi tre nhỏ. Cảm ơn bạn đã ghé thăm._
