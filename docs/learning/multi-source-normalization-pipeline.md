# 多源文档归一化管道架构

> gov-subsidy-tool 数据采集 → OKF Markdown 转换全流程

---

## 总览

```
                          ┌──────────────────────────────┐
                          │        OKF Markdown           │
                          │   YAML frontmatter + 正文      │
                          │   verified/  │  issues/       │
                          └──────────────┬───────────────┘
                                         ▲
                      ┌──────────────────┴──────────────────┐
                      │           质量分级 & 元数据推断       │
                      │  ┌─────────┐  ┌──────────────────┐  │
                      │  │ 质量判定  │  │   元数据推断       │  │
                      │  │verified/ │  │ policy_type      │  │
                      │  │issues/   │  │ region/tags      │  │
                      │  └─────────┘  │ timestamp/desc    │  │
                      │               └──────────────────┘  │
                      └──────────────────┬──────────────────┘
                                         ▲
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
    ┌─────────┴─────────┐    ┌──────────┴──────────┐    ┌─────────┴─────────┐
    │   HTML 管道        │    │   MarkItDown 管道    │    │   Vision 管道      │
    │  (网页主力)         │    │  (文档/附件)          │    │  (图片 OCR)        │
    │                    │    │                      │    │                    │
    │ readability-lxml   │    │ MarkItDown           │    │ Qwen Vision        │
    │ html2text          │    │  ├ pymupdf (PDF)     │    │   API 调用          │
    │ 编码修复            │    │  ├ python-docx       │    │                    │
    │ 表格清洗            │    │  ├ openpyxl (XLSX)   │    │ 返回结构化文本      │
    │ 附件递归下载         │    │  └ pptx/图片         │    │ + 表格数据          │
    └─────────┬──────────┘    └──────────┬──────────┘    └─────────┬──────────┘
              │                          │                          │
    ┌─────────┴──────────┐    ┌─────────┴──────────┐    ┌─────────┴──────────┐
    │  抓取层             │    │  格式嗅探            │    │  图片附件发现       │
    │                    │    │  URL后缀 → MIME     │    │  {.png/.jpg/...}   │
    │ Playwright         │    │  → 文件扩展名        │    │                    │
    │  (动态JS页面)       │    │                      │    │                    │
    │ httpx + 编码探测    │    │                      │    │                    │
    │  (静态页面)         │    │                      │    │                    │
    └─────────┬──────────┘    └─────────┬──────────┘    └─────────┬──────────┘
              │                          │                          │
    ┌─────────┴──────────────────────────┴──────────────────────────┴─────────┐
    │                          源数据识别                                      │
    │                                                                         │
    │  URL 分析: .html? .pdf? .docx? .png?   │   Content-Type 嗅探            │
    │  路由到对应管道                         │  application/pdf → PDF管道     │
    │                                        │  text/html → HTML管道          │
    └────────────────────────────────────────┬────────────────────────────────┘
                                             ▲
                          ┌──────────────────┴──────────────────┐
                          │           爬虫采集层                  │
                          │                                      │
                          │  ┌────────────┐  ┌───────────────┐  │
                          │  │ gov_search  │  │  Excel 导入    │  │
                          │  │ _scraper    │  │  (人工整理)    │  │
                          │  │             │  │               │  │
                          │  │ Playwright  │  │ openpyxl 解析  │  │
                          │  │ Crawl4AI    │  │ 批量URL导入    │  │
                          │  └────────────┘  └───────────────┘  │
                          └──────────────────┬──────────────────┘
                                             ▲
                          ┌──────────────────┴──────────────────┐
                          │           数据源                     │
                          │                                      │
                          │  31省+15市 政府网站                   │
                          │  .gov.cn 域名下的:                    │
                          │  政策通知 / 办事指南 / 政策解读        │
                          │  HTML网页 / PDF附件 / Word文件        │
                          └──────────────────────────────────────┘
```

---

## 主干流程（时序）

```
爬虫采集                     归一化管道                        产出
───────                     ──────────                        ────

政府网站 ──→ URL ──→ convert_url_to_okf()
                          │
                     [URL后缀识别]
                     ┌──────┼──────┐
                     ▼      ▼      ▼
                  .html   .pdf   .docx
                     │      │      │
                     │      └──────┴──→ _convert_doc_url_to_okf()
                     │                        │
                     │                   MarkItDown 转换
                     │                        │
                     ▼                        ▼
              Playwright/httpx           Markdown 正文
                     │                        │
                     ▼                        │
              readability 正文提取              │
                     │                        │
                     ▼                        │
              html2text → MD                  │
                     │                        │
                     └────────┬───────────────┘
                              │
                              ▼
                      [元数据推断]
                      policy_type / region / tags / timestamp
                              │
                              ▼
                      [质量分级]
                     ┌────────┴────────┐
                     ▼                 ▼
                 verified/          issues/
              (HTML正文>200字)    (PDF/低质量/SPA)
                     │                 │
                     ▼                 ▼
                  OKF Markdown     OKF Markdown
                  + index.md       + 人工复核标记
                  + log.md
```

---

## 三大管道对比

| 维度       | HTML 管道                      | MarkItDown 管道          | Vision 管道        |
| -------- | ---------------------------- | ---------------------- | ---------------- |
| **适用格式** | .html 网页                     | .pdf/.docx/.xlsx/.pptx | .png/.jpg 等图片    |
| **核心引擎** | readability-lxml + html2text | MarkItDown (Microsoft) | Qwen Vision API  |
| **抓取方式** | Playwright 渲染 / httpx 直取     | httpx 下载原始文件           | 从 HTML 附件中发现     |
| **质量**   | 高（正文提取成熟）                    | 中（PDF不稳定，进issues）      | 低（OCR有损，进issues） |
| **表格处理** | fix_tables() 清洗              | 各parser原生提取            | Qwen 视觉识别        |
| **编码问题** | GBK/UTF-8 双编码修复              | 无须处理（二进制）              | 无须处理             |

---

## 质量分级决策树

```
                    ┌─────────────┐
                    │  转换完成    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ 来源是 PDF?  │──── 是 ──→ issues/pdf_doc
                    └──────┬──────┘
                           │ 否
                    ┌──────▼──────┐
                    │ 来源是图片?  │──── 是 ──→ issues/pdf_doc
                    └──────┬──────┘
                           │ 否
                    ┌──────▼──────┐
                    │ 正文 < 200字?│──── 是 ──→ issues/low_quality
                    └──────┬──────┘
                           │ 否
                    ┌──────▼──────┐
                    │ 是纯列表页?  │──── 是 ──→ issues/list_page
                    └──────┬──────┘
                           │ 否
                    ┌──────▼──────┐
                    │ 是SPA页面?   │──── 是 ──→ issues/spa_page
                    └──────┬──────┘
                           │ 否
                    ┌──────▼──────┐
                    │ 仅含图片?    │──── 是 ──→ issues/image_only
                    └──────┬──────┘
                           │ 否
                           ▼
                     ✅ verified/
```

---

## 关键依赖

```
Python 包                 用途
────────────────────────────────────────
readability-lxml          HTML 正文自动识别（Mozilla 开源）
html2text                 HTML → Markdown 结构化转换
markitdown                PDF/DOCX/XLSX/PPTX → Markdown（Microsoft 开源）
pymupdf                   PDF 文本提取底层
beautifulsoup4            HTML 解析
playwright                动态页面渲染（Chromium 内核）
crawl4ai                  AI 辅助网页抓取
openpyxl                  Excel 读写
httpx                     异步 HTTP 客户端
Qwen Vision API           图片 OCR + 视觉理解（内网部署）
```

---

## 练手实践：开源数据集搭建归一化管道

### 推荐数据集

| 数据集 | 规模 | 源格式 | 用途 |
|--------|------|--------|------|
| **Common Crawl** | PB级（可下载几百MB片段） | WARC/HTML | 网页正文提取，最接近本项目的 HTML 管道 |
| **Wikipedia Dump** | 每月快照 | WikiText/XML | 结构化文档解析，对比正文提取效果 |
| **arXiv 论文** | 250万篇 | PDF + LaTeX | PDF→Markdown 转换，含公式/表格 |
| **Natural Questions** | 30万问答对 | JSON | QA 对→结构化规则，对应本体平台 Extract 阶段 |
| **SQuAD** | 10万问答对 | JSON | 从段落中提取问答，练习问答→规则推导 |
| **MultiNERD** | 34万命名实体 | JSON | 多格式标注归一化，练习 schema 统一 |
| **GovInfo (美国)** | 政府公报 | XML/PDF/HTML | API 规范，适合还原政务场景但避开中文 .gov.cn 乱码 |

### 搭建流程（~200行代码）

```
┌─────────────────────────────────────────────────────────┐
│                    多源数据采集                           │
│                                                         │
│  Common Crawl WARC → trafilatura     → 正文             │
│  Wikipedia XML     → mwparserfromhell → 正文             │
│  arXiv PDF         → pymupdf          → 正文             │
│  Natural Questions → 原生 JSON        → 问答对           │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │   正文提取（三引擎对比）   │
              │                         │
              │   trafilatura           │
              │   readability-lxml      │
              │   boilerpy3             │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │   归一化为 Markdown       │
              │                         │
              │   html2text / markitdown │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │   质量分级                │
              │                         │
              │   正文>200字 → verified  │
              │   正文<200字 → issues    │
              │   PDF来源   → issues    │
              └────────────┬────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   OKF 格式 Markdown     │
              │   YAML frontmatter     │
              │   + 结构化正文          │
              │   verified/ │ issues/  │
              └────────────────────────┘
```

### 引擎对比实验

| 维度 | trafilatura | readability-lxml | boilerpy3 |
|------|------------|-----------------|-----------|
| 中文支持 | 一般 | 需自行处理编码 | 较好 |
| 表格保留 | ✅ | ❌ 常丢弃 | ✅ |
| 速度 | 快 | 中等 | 慢 |
| 动态页面 | 不支持 | 不支持 | 不支持 |
| 适合场景 | 新闻/博客 | 通用网页 | 论坛/评论 |

### 快速上手

```bash
pip install warcio trafilatura readability-lxml boilerpy3 html2text markitdown pymupdf datasets

# 1. Common Crawl → Markdown
wget https://data.commoncrawl.org/crawl-data/CC-MAIN-2024-10/segments/1707947479857.60/warc/CC-MAIN-20240221073711-20240221103711-00000.warc.gz

from warcio import ArchiveIterator
from trafilatura import extract

with open('file.warc.gz', 'rb') as f:
    for record in ArchiveIterator(f):
        if record.rec_type == 'response':
            html = record.content_stream().read()
            text = extract(html)
            if text and len(text) > 200:
                # 写入 verified/
                pass

# 2. Natural Questions → 结构化问答（对应 Extract 阶段）
from datasets import load_dataset
nq = load_dataset('natural_questions', split='train[:1000]')
for item in nq:
    question = item['question']['text']
    answer = item['annotations']['short_answers'][0]['text']
    # 构建 QA 对，模拟本体平台 Extract 输出

# 3. arXiv PDF → Markdown（对应 MarkItDown 管道）
from markitdown import MarkItDown
md = MarkItDown()
result = md.convert('hep-th-2401.00001.pdf')
print(result.text_content)
```

所有数据集免费，代码开源友好，可作为数据处理管道的独立项目展示。
