# 政策本体智能体平台 — 技术学习资料包


## 目录结构

```
ChatGST/
│
├── 📝 学习笔记 ──────────────────────────────────────────
│   ├── 本体智能体架构.md        技术架构全览 (五层模型/依赖拓扑/安全/性能)
│   ├── 本体智能体平台.md        功能与业务分析 (场景/角色/技术-业务匹配度)
│   ├── 多源归一化管道架构.md    数据处理管道详解 + 开源练手方案
│   ├── README-源码索引.md       Bridge 39模块导航
│   ├── 性能.md                性能观测数据
│   └── 项目QA.md              常见问题与解答
│
├── 💻 后端源码 ──────────────────────────────────────────
│   ├── bridge-src/              Bridge 桥接服务 (39个.ts, 530KB)
│   │   ├── 01~14: 入口/配置/类型/本体平台代理/Step2流水线
│   │   ├── 15~19: Agent运行时/模板/Skills/认证/加密
│   │   ├── 20~26: 工作空间/项目管理/持久化/HTTP服务/发布/审计
│   │   └── 27~35: OKF知识格式/规则引擎工具/模板配置
│   │
│   └── 管道核心源码/            数据处理管道 (12个.py, 8193行)
│       ├── gov_policy_to_okf.py 主转换引擎 (2499行)
│       ├── export.py            批处理导出 (1313行)
│       ├── http_utils.py        HTTP工具 (1463行)
│       ├── export_assets.py     附件/图片处理 (920行)
│       ├── llm_relevance.py     LLM预筛 (512行)
│       ├── enrich.py            字段补全 (459行)
│       ├── vision_parser.py     图片OCR (286行)
│       ├── engine.py            Playwright爬虫 (278行)
│       └── ocr_utils/web_capture/region_parser/policy_normalization
│
├── 🎨 前端源码 ──────────────────────────────────────────
│   └── 前端源码/                Vue 3 SPA (39个源文件, ~2500行)
│       ├── api/                 API层 (10文件: auth/project/onto/...)
│       ├── pages/               页面 (11个.vue: Dashboard/Pipeline/...)
│       ├── stores/              状态管理 (Pinia, 6文件)
│       ├── composables/         组合式函数 (useFetch/usePagination/...)
│       ├── components/business/ 业务组件 (19个)
│       └── mocks/json/          Mock数据 (12个JSON)
│
├── ⚙️ 部署运维 ──────────────────────────────────────────
│   └── 部署脚本/               (5个文件)
│       ├── install.sh           Python venv + .whl 安装
│       ├── run.sh               生产启动脚本
│       ├── check_python.sh      精确版本校验 (.so兼容性)
│       ├── gov-policy.service   systemd 服务配置
│       └── nginx.conf.sample    Nginx 反代 + HTTPS
│
├── 📊 数据样例 ──────────────────────────────────────────
│   ├── data-skeleton/           本体知识骨架 (4个JSON)
│   │   ├── concept.json          23个概念 (Baby/Applicant/...)
│   │   ├── operator.json         202个算子 (本市户籍/社保/...)
│   │   ├── meta.json             骨架元信息
│   │   └── manifest.json         策略版本索引
│   │
│   ├── subsidy.db               爬虫元数据 487条 (12省)
│   └── okf_test_output/         归一化管道输出样例 (3条)
│       ├── 上海市_xxx.md         OKF Markdown 样例
│       ├── 北京市_xxx.md
│       └── 吉林省_xxx.md
│
└── 🔐 bridge-src.tar.gz.enc    Bridge源码加密备份 (需密码)
```

## 学习路径建议

| 目标       | 阅读顺序                        |
| -------- | --------------------------- |
| 理解整体架构   | 本体智能体架构.md → README-源码索引.md |
| 理解业务逻辑   | 本体智能体平台.md                  |
| 学数据处理管道  | 多源归一化管道架构.md → 管道核心源码/      |
| 学Agent开发 | bridge-src/ (12-15号文件)      |
| 学Vue前端架构 | 前端源码/                       |
| 学部署运维    | 部署脚本/                       |


