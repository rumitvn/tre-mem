# tre-mem 🎋

> _Tre — bộ rễ chung cho codebase của bạn._

> 🇬🇧 English version: [README.md](./README.md)

Tre là hình ảnh thân thuộc của làng quê Việt Nam — biểu tượng của sự **bền
bỉ, gắn bó, và gốc rễ**. Lũy tre xanh là nhiều thân tre vươn lên từ chung một
bộ rễ, đung đưa riêng trong gió nhưng đứng vững cùng nhau qua mọi cơn bão.
Các branch của một codebase cũng lớn lên như vậy: mỗi branch là một feature
riêng, nhưng tất cả đều từ một dòng history chung.

```
                  ╲╱           ╲╱           ╲╱
                  ╱╲           ╱╲           ╱╲
                 ╱  ╲         ╱  ╲         ╱  ╲
                 │  │         │  │         │  │
                 ├──┤         ├──┤         ├──┤    ← đốt tre
                 │  │         │  │         │  │
                 ├──┤         ├──┤         ├──┤
                 │  │         │  │         │  │
                 ├──┤         ├──┤         ├──┤
                 │  │         │  │         │  │
              ═══╧══╧═════════╧══╧═════════╧══╧═══
                  ╲      ╲    │    ╱      ╱
                   ╲______╲___│___╱______╱
                      gốc chung · shared roots
                      các branch của một codebase
```

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

## Vì sao cần tre-mem

claude-mem ingest session rất tốt nhưng index flat theo project. Đổi từ
`feature/payment` sang `fix/auth-jwt-expiry` thì assistant vẫn thấy lẫn lộn
Stripe webhook với JWT context. tre-mem xử lý điều đó:

- **Tag branch live** qua chokidar watcher trên `.git/HEAD`.
- **Backfill lịch sử** qua `git reflog` để observation cũ cũng có branch.
- **Rerank 3-signal**: semantic (FTS5/BM25), branch locality, recency-trong-branch,
  cộng thêm pin boost cho fact muốn ghim vào branch.
- **MCP server** expose 5 tool để Claude Code gọi retrieval branch-aware trực tiếp.

Trên chính repo tre-mem, rerank nâng precision@10 từ **0.19** (FTS5 baseline thuần)
lên **0.97**. Xem [BENCHMARK.md](./BENCHMARK.md) để biết chi tiết harness.

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
tre-mem · connected · 5 tools
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

Sau đó `tre export && git push` (hoặc để GitHub Action graduate lúc merge) và đồng
đội tự động thừa hưởng pin trong phiên kế tiếp — hiện trong digest của họ với nhãn
`[shared]` như trên.

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
tre hook session-start                  # Claude Code gọi, đọc JSON qua stdin
tre mcp                                 # khởi động MCP server (stdio)
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

| Tool                  | Input                                | Output                                   |
| --------------------- | ------------------------------------ | ---------------------------------------- |
| `get_branch_context`  | `query`, `project?`, `branch?`, `k?` | Top-K observations, kèm breakdown rerank |
| `get_branch_timeline` | `branch`, `project?`, `limit?`       | Feed theo thời gian cho 1 branch         |
| `list_branches`       | `project?`                           | Các branch kèm số lượng tag              |
| `pin_fact`            | `observation_id`, `branch?`, `note?` | Ghim fact vào branch (boost = 1.0)       |
| `graduate_fact`       | `observation_id`                     | Promote fact từ branch lên scope project |

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

## Xem trực quan — dashboard nhóm (v0.5)

Phase 2 đưa memory đi qua git; **v0.5 cho cả nhóm _nhìn thấy_ nó.** Chạy `tre web`
để mở dashboard cục bộ, chỉ-đọc: cây nhánh (branch graph), các quyết định đã pin,
fact đã graduated, và những gì đang chờ export — cập nhật trực tiếp khi repo và
sidecar thay đổi. Không tài khoản, không cloud; chỉ bind `127.0.0.1`.

```bash
tre web                 # khởi động + mở trình duyệt (Ctrl-C để dừng)
tre web --background    # chạy nền; quản lý bằng `tre web status` / `tre web stop`
```

- **Branch graph** — mỗi nhánh kèm số observation đã tag, số pin, lần hoạt động
  gần nhất, và `HEAD` hiện tại.
- **Team memory** — ai đã pin gì và vì sao, kèm các fact đã graduated, với nhãn
  `shared` / `pending export`.
- **Search** — theo nhánh, kèm phân rã điểm theo từng tín hiệu.
- **Live** — phản ứng khi đổi nhánh, khi đồng đội `git pull` / `tre import`, và khi
  pin được ghi từ terminal khác (SSE).

Hoạt động cả khi **không có claude-mem** (chế độ shared-memory-only: pin +
graduated từ sidecar/`.tre-mem/`, tìm kiếm substring). Hướng dẫn đầy đủ:
[docs/WEB-UI.md](./docs/WEB-UI.md).

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

MVP — slice retrieval + MCP của Tuần 2 đã ship. E2E live verify trên một
project đa-branch thật; cùng một query, top-1 đổi đúng theo branch như kỳ vọng.
[CHANGELOG.md](./CHANGELOG.md) theo dõi release.

Out of scope cho MVP (defer V2):

- Team sync / cloud
- Dashboard UI
- Ingest độc lập từ Cursor / Gemini CLI / Codex
- Auto graduate fact khi merge PR

## License

MIT. Xem [LICENSE](./LICENSE).

---

🎋 _Làm với tình thương, từ một bụi tre nhỏ. Cảm ơn bạn đã ghé thăm._
