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

## Bộ lệnh CLI

```bash
tre init                                # tạo ~/.tre-mem/ + chạy migration
tre status [path]                       # project / branch / số lượng tag cho cwd
tre backfill [path] [--project SLUG]    # tag lịch sử qua git reflog
tre search "<query>" [--branch B] [--k 10]
tre pin <observation_id> [--note "..."]
tre graduate <observation_id>           # promote fact từ branch → project-wide
tre list-branches [--project SLUG]
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
