"""网页渲染采集层。

Crawl4AI 是可选运行时依赖：安装且浏览器可用时返回渲染后 DOM、
媒体和链接；否则自动回退到现有 HTTP 抓取，不影响基本 Markdown 导出。
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from app.config import settings
from app.services.http_utils import fetch_html_sync


@dataclass
class CapturedPage:
    url: str
    final_url: str
    html: str
    links: list[dict[str, Any]] = field(default_factory=list)
    images: list[dict[str, Any]] = field(default_factory=list)
    rendered: bool = False
    capture_method: str = "http"
    warning: str = ""


def _flatten_items(value: Any) -> list[dict[str, Any]]:
    """把 Crawl4AI links/media 的分类字典展平。"""
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if not isinstance(value, dict):
        return []
    result: list[dict[str, Any]] = []
    for items in value.values():
        if isinstance(items, list):
            result.extend(item for item in items if isinstance(item, dict))
    return result


class WebCaptureSession:
    """批量导出时复用同一个 Crawl4AI 浏览器。"""

    def __init__(self, enabled: bool | None = None):
        self.enabled = settings.CRAWL4AI_ENABLED if enabled is None else enabled
        self._crawler = None
        self._run_config_cls = None
        self._cache_mode = None
        self._startup_warning = ""

    async def __aenter__(self) -> "WebCaptureSession":
        if not self.enabled:
            return self
        try:
            from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

            browser_kwargs: dict[str, Any] = {
                "browser_type": "chromium",
                "headless": True,
                "verbose": False,
                "accept_downloads": True,
            }
            if settings.CRAWL4AI_BROWSER_CHANNEL:
                browser_kwargs["chrome_channel"] = settings.CRAWL4AI_BROWSER_CHANNEL
            browser_config = BrowserConfig(**browser_kwargs)
            self._crawler = AsyncWebCrawler(config=browser_config)
            await self._crawler.__aenter__()
            self._run_config_cls = CrawlerRunConfig
            self._cache_mode = CacheMode
            logger.info("Crawl4AI 渲染采集器已启动")
        except Exception as exc:
            self._crawler = None
            self._startup_warning = f"Crawl4AI 不可用，已回退 HTTP 抓取：{type(exc).__name__}: {exc}"
            logger.warning(self._startup_warning)
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._crawler is not None:
            try:
                await self._crawler.__aexit__(exc_type, exc, tb)
            finally:
                self._crawler = None

    async def capture(self, url: str) -> CapturedPage:
        if self._crawler is not None:
            try:
                run_config = self._run_config_cls(
                    cache_mode=self._cache_mode.BYPASS,
                    wait_until="networkidle",
                    page_timeout=settings.EXPORT_PAGE_TIMEOUT_MS,
                    delay_before_return_html=1.0,
                    wait_for_images=True,
                    scan_full_page=True,
                    scroll_delay=0.3,
                    process_iframes=True,
                    remove_overlay_elements=True,
                )
                result = await self._crawler.arun(url=url, config=run_config)
                if not getattr(result, "success", False):
                    raise RuntimeError(getattr(result, "error_message", "渲染失败"))
                html = getattr(result, "html", "") or getattr(result, "cleaned_html", "")
                if not html:
                    raise RuntimeError("渲染结果为空")
                links = _flatten_items(getattr(result, "links", {}))
                media = getattr(result, "media", {}) or {}
                images = media.get("images", []) if isinstance(media, dict) else []
                return CapturedPage(
                    url=url,
                    final_url=str(getattr(result, "url", "") or url),
                    html=html,
                    links=links,
                    images=[item for item in images if isinstance(item, dict)],
                    rendered=True,
                    capture_method="crawl4ai",
                )
            except Exception as exc:
                warning = f"Crawl4AI 渲染失败，已回退 HTTP 抓取：{type(exc).__name__}: {exc}"
                logger.warning(f"{warning}; url={url}")
                return await asyncio.to_thread(self._capture_http, url, warning)
        return await asyncio.to_thread(self._capture_http, url, self._startup_warning)

    @staticmethod
    def _capture_http(url: str, warning: str = "") -> CapturedPage:
        html, final_url = fetch_html_sync(url, timeout=max(30, settings.EXPORT_PAGE_TIMEOUT_MS // 1000))
        return CapturedPage(
            url=url,
            final_url=final_url,
            html=html,
            rendered=False,
            capture_method="http",
            warning=warning,
        )


async def capture_page(url: str, enabled: bool | None = None) -> CapturedPage:
    async with WebCaptureSession(enabled=enabled) as session:
        return await session.capture(url)


def capture_page_sync(url: str, enabled: bool | None = None) -> CapturedPage:
    """供 CLI/单页转换使用的同步包装。"""
    return asyncio.run(capture_page(url, enabled=enabled))
