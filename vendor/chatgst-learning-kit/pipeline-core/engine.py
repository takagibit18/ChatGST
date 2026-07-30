"""爬虫引擎 - 基于Playwright的通用政策采集框架"""
import asyncio
import re
import sys
from datetime import datetime
from typing import Optional
from urllib.parse import quote

from loguru import logger
from playwright.async_api import async_playwright, Page, BrowserContext

from app.config import settings


class PolicyScraper:
    """补贴政策采集引擎"""

    def __init__(self):
        self.browser = None
        self.context: Optional[BrowserContext] = None
        self._playwright = None

    async def start(self):
        """启动浏览器"""
        self._playwright = await async_playwright().start()
        launch_options = {
            "headless": True,
            "args": ["--disable-gpu", "--no-sandbox"],
        }
        # Windows 单 EXE 发布包复用系统预装 Edge，不依赖额外的 Playwright Chromium 目录。
        if sys.platform == "win32":
            launch_options["channel"] = "msedge"
        self.browser = await self._playwright.chromium.launch(**launch_options)
        self.context = await self.browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
        )
        logger.info("浏览器启动完成")

    async def stop(self):
        """关闭浏览器"""
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self._playwright:
            await self._playwright.stop()
        logger.info("浏览器已关闭")

    async def scrape_gov_cn(
        self,
        keyword: str,
        region_level: str = "national",
        max_pages: int = 5,
    ) -> list[dict]:
        """
        采集中国政府网政策搜索结果

        Args:
            keyword: 搜索关键词
            region_level: 层级
            max_pages: 最大翻页数

        Returns:
            政策条目列表
        """
        results = []
        page = await self.context.new_page()

        try:
            for pg in range(1, max_pages + 1):
                url = (
                    f"https://s.www.gov.cn/sousuo/search.shtml"
                    f"?code=18000000&searchWord={quote(keyword)}"
                    f"&pageNo={pg}"
                )
                logger.info(f"正在采集: {url}")

                try:
                    await page.goto(url, timeout=settings.SCRAPER_TIMEOUT * 1000)
                    await page.wait_for_load_state("networkidle", timeout=15000)
                except Exception as e:
                    logger.warning(f"页面加载超时或失败: {e}")
                    continue

                # 解析搜索结果列表
                items = await page.evaluate("""() => {
                    const results = [];
                    // 政府网搜索结果选择器
                    const listItems = document.querySelectorAll('.search_res_list li, .listBox li, .data_list li');
                    listItems.forEach(li => {
                        const a = li.querySelector('a');
                        const dateSpan = li.querySelector('.date, .time, span[class*="date"]');
                        const sourceSpan = li.querySelector('.source, .dep, span[class*="source"]');
                        results.push({
                            title: a ? a.textContent.trim() : '',
                            url: a ? a.href : '',
                            publish_date: dateSpan ? dateSpan.textContent.trim() : '',
                            source: sourceSpan ? sourceSpan.textContent.trim() : '中国政府网',
                        });
                    });
                    return results;
                }""")

                if not items:
                    # 备用选择器
                    items = await self._fallback_parse(page)

                if not items:
                    logger.info(f"第{pg}页无结果，停止翻页")
                    break

                for item in items:
                    item["region_level"] = region_level
                    item["source_site"] = "中国政府网"
                    item["scraped_at"] = datetime.now().isoformat()
                    results.append(item)

                logger.info(f"第{pg}页采集到 {len(items)} 条")

                # 请求间隔
                await asyncio.sleep(settings.SCRAPER_DELAY)

        finally:
            await page.close()

        return results

    async def scrape_custom_site(
        self,
        search_url: str,
        source_name: str,
        keyword: str,
        result_selector: str = "li",
        link_selector: str = "a",
        date_selector: str = ".date, .time",
        max_pages: int = 3,
    ) -> list[dict]:
        """
        通用站点采集（可配置选择器）

        Args:
            search_url: 搜索URL模板，{keyword}为占位符
            source_name: 来源名称
            keyword: 关键词
            result_selector: 结果列表项选择器
            link_selector: 链接选择器
            date_selector: 日期选择器
            max_pages: 最大页数
        """
        results = []
        page = await self.context.new_page()

        try:
            url = search_url.replace("{keyword}", quote(keyword))
            logger.info(f"正在采集 [{source_name}]: {url}")

            await page.goto(url, timeout=settings.SCRAPER_TIMEOUT * 1000)
            await page.wait_for_load_state("domcontentloaded", timeout=15000)

            items = await page.evaluate(f"""() => {{
                const results = [];
                const listItems = document.querySelectorAll('{result_selector}');
                listItems.forEach(li => {{
                    const a = li.querySelector('{link_selector}');
                    const dateEl = li.querySelector('{date_selector}');
                    results.push({{
                        title: a ? a.textContent.trim() : '',
                        url: a ? a.href : '',
                        publish_date: dateEl ? dateEl.textContent.trim() : '',
                        source: '{source_name}',
                    }});
                }});
                return results;
            }}""")

            for item in items:
                item["scraped_at"] = datetime.now().isoformat()
                results.append(item)

        except Exception as e:
            logger.error(f"采集 [{source_name}] 失败: {e}")
        finally:
            await page.close()

        return results

    async def fetch_policy_detail(self, url: str) -> dict:
        """
        抓取政策详情页内容

        Args:
            url: 政策详情页URL

        Returns:
            包含正文内容的字典
        """
        page = await self.context.new_page()
        try:
            await page.goto(url, timeout=settings.SCRAPER_TIMEOUT * 1000)
            await page.wait_for_load_state("domcontentloaded", timeout=10000)

            detail = await page.evaluate("""() => {
                // 尝试多种正文选择器
                const selectors = [
                    '.pages_content', '.article-content', '.text_content',
                    '#content', '.content', '.detail-content',
                    'article', '.zhengwen', '.custom_page'
                ];
                let content = '';
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent.trim().length > 100) {
                        content = el.textContent.trim();
                        break;
                    }
                }
                // 标题
                const titleEl = document.querySelector('h1, .article-title, .title');
                const title = titleEl ? titleEl.textContent.trim() : document.title;

                // 发布日期
                const dateEl = document.querySelector(
                    '.pubtime, .publish-date, .date, meta[name="pubdate"]'
                );
                const pubDate = dateEl
                    ? (dateEl.getAttribute('content') || dateEl.textContent.trim())
                    : '';

                // 来源部门
                const srcEl = document.querySelector(
                    '.source, .pubsource, meta[name="source"]'
                );
                const source = srcEl
                    ? (srcEl.getAttribute('content') || srcEl.textContent.trim())
                    : '';

                return { title, content, publish_date: pubDate, source_department: source };
            }""")

            return detail

        except Exception as e:
            logger.error(f"详情页采集失败 [{url}]: {e}")
            return {"content": "", "error": str(e)}
        finally:
            await page.close()

    async def _fallback_parse(self, page: Page) -> list[dict]:
        """备用解析逻辑"""
        return await page.evaluate("""() => {
            const results = [];
            // 更宽泛的选择器
            const allLinks = document.querySelectorAll('a[href*="zhengce"], a[href*="content"], a[href*="item"]');
            allLinks.forEach(a => {
                const text = a.textContent.trim();
                if (text.length > 10 && text.length < 200) {
                    const parent = a.closest('li, div, tr');
                    const dateEl = parent ? parent.querySelector('.date, .time, span') : null;
                    results.push({
                        title: text,
                        url: a.href,
                        publish_date: dateEl ? dateEl.textContent.trim() : '',
                        source: '中国政府网',
                    });
                }
            });
            return results;
        }""")


# 全局单例
scraper = PolicyScraper()
