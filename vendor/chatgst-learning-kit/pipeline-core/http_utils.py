# -*- coding: utf-8 -*-
"""
http_utils.py — 共享 HTTP 工具模块

统一管理 UA 轮换、网页抓取、编码检测、标题质量判断、地区推断等功能。
enrich.py / gov_policy_to_okf.py / lite_scraper.py 共用，消除重复代码。
"""
import re
import ssl
import random
import asyncio
import aiohttp

from typing import Optional
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from loguru import logger

import httpx

# ── UA 轮换池 ────────────────────────────────────────────────
UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]


def get_random_ua() -> str:
    """随机获取一个 User-Agent"""
    return random.choice(UA_POOL)


def build_headers(referer: Optional[str] = None) -> dict:
    """构建带随机 UA 的请求头"""
    headers = {
        "User-Agent": get_random_ua(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    return headers


# ── 网页抓取 ────────────────────────────────────────────────

def decode_html_bytes(
    content: bytes,
    content_type: str = "",
    apparent_encoding: str = "",
) -> str:
    """按 BOM、HTML meta、HTTP 头和候选编码解码网页字节。

    requests 会把未声明 charset 的 ``text/html`` 默认当成 ISO-8859-1，
    中文 UTF-8 页面因此会变成 ``éè¦`` 一类乱码。这里始终从原始
    字节解码，并优先尊重页面自身的 ``<meta charset>`` 声明。
    """
    if not content:
        return ""

    candidates: list[str] = []

    def add(encoding: str | None) -> None:
        value = (encoding or "").strip().strip('"\'').lower()
        aliases = {
            "utf8": "utf-8",
            "gb2312": "gb18030",
            "gbk": "gb18030",
        }
        value = aliases.get(value, value)
        if value and value not in candidates:
            candidates.append(value)

    if content.startswith(b"\xef\xbb\xbf"):
        add("utf-8-sig")
    elif content.startswith((b"\xff\xfe", b"\xfe\xff")):
        add("utf-16")

    # charset 声明只含 ASCII，可在尚未确定正文编码时安全扫描。
    head = content[:8192].decode("ascii", errors="ignore")
    meta_match = re.search(
        r"<meta[^>]+charset\s*=\s*['\"]?\s*([a-zA-Z0-9._-]+)",
        head,
        re.I,
    )
    if not meta_match:
        meta_match = re.search(
            r"<meta[^>]+content\s*=\s*['\"][^'\"]*charset\s*=\s*([a-zA-Z0-9._-]+)",
            head,
            re.I,
        )
    if meta_match:
        add(meta_match.group(1))

    header_match = re.search(r"charset\s*=\s*['\"]?\s*([a-zA-Z0-9._-]+)", content_type, re.I)
    header_encoding = header_match.group(1) if header_match else ""
    # Latin-1 常常只是 requests 对 text/html 的默认猜测，放到 UTF-8 后。
    if header_encoding.lower() not in {"iso-8859-1", "latin-1", "latin1"}:
        add(header_encoding)
    add("utf-8")
    add(apparent_encoding)
    add(header_encoding)
    add("gb18030")

    for encoding in candidates:
        try:
            return content.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return content.decode("utf-8", errors="replace")


def _detect_encoding(resp: httpx.Response) -> str:
    """检测响应内容的编码，返回解码后的文本。"""
    return decode_html_bytes(
        resp.content,
        resp.headers.get("content-type", ""),
        getattr(resp, "encoding", "") or "",
    )


def fetch_html_sync(url: str, timeout: int = 30, referer: Optional[str] = None) -> tuple[str, str]:
    """同步抓取网页，返回 (html, final_url)，SSL 错误时自动降级重试

    支持功能：
    - 随机 UA 轮换
    - 可选 Referer 头
    - SSL 降级重试（应对 DH_KEY_TOO_SMALL 等弱密码套件问题）
    - 自动编码检测
    """
    headers = build_headers(referer=referer)
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout, verify=False) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
    except (httpx.ConnectError, ssl.SSLError, OSError):
        ctx = ssl.create_default_context()
        ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with httpx.Client(follow_redirects=True, timeout=timeout, verify=ctx) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()

    html = _detect_encoding(resp)
    return html, str(resp.url)


def fetch_raw_sync(url: str, timeout: int = 30, referer: Optional[str] = None) -> httpx.Response:
    """同步抓取返回原始 Response，SSL 降级同上"""
    headers = build_headers(referer=referer)
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout, verify=False) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            return resp
    except (httpx.ConnectError, ssl.SSLError, OSError):
        ctx = ssl.create_default_context()
        ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with httpx.Client(follow_redirects=True, timeout=timeout, verify=ctx) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            return resp


async def fetch_html_async(url: str, timeout: int = 30, referer: Optional[str] = None,
                           max_retries: int = 3) -> tuple[str, str]:
    """异步抓取网页，返回 (html, final_url)，支持重试退避

    特性：随机 UA、Referer、SSL 降级、429/503/412 指数退避重试
    """
    headers = build_headers(referer=referer)
    last_error = None

    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=timeout, verify=False) as client:
                resp = await client.get(url, headers=headers)
                # 遇到反爬状态码，退避重试
                if resp.status_code in (429, 503, 412):
                    wait = (2 ** attempt) + random.uniform(0, 1)
                    import asyncio as _asyncio
                    await _asyncio.sleep(wait)
                    # 换一个 UA
                    headers["User-Agent"] = get_random_ua()
                    continue
                resp.raise_for_status()
                html = _detect_encoding(resp)
                return html, str(resp.url)
        except (httpx.ConnectError, ssl.SSLError, OSError) as e:
            last_error = e
            # SSL 降级重试
            try:
                ctx = ssl.create_default_context()
                ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                async with httpx.AsyncClient(follow_redirects=True, timeout=timeout, verify=ctx) as client:
                    resp = await client.get(url, headers=headers)
                    if resp.status_code in (429, 503, 412):
                        wait = (2 ** attempt) + random.uniform(0, 1)
                        import asyncio as _asyncio
                        await _asyncio.sleep(wait)
                        headers["User-Agent"] = get_random_ua()
                        continue
                    resp.raise_for_status()
                    html = _detect_encoding(resp)
                    return html, str(resp.url)
            except (httpx.ConnectError, ssl.SSLError, OSError) as e2:
                last_error = e2
                if attempt < max_retries - 1:
                    import asyncio as _asyncio
                    await _asyncio.sleep(2 ** attempt)
                    headers["User-Agent"] = get_random_ua()
                    continue
        except httpx.HTTPStatusError as e:
            last_error = e
            if attempt < max_retries - 1:
                import asyncio as _asyncio
                await _asyncio.sleep(2 ** attempt)
                headers["User-Agent"] = get_random_ua()
                continue

    raise last_error or Exception(f"Failed to fetch {url} after {max_retries} retries")


# ── 标题质量判断 ──────────────────────────────────────────────

def is_bad_title(text: str) -> bool:
    """判断是否为不良标题（面包屑导航、网站名、过短、纯数字等）"""
    breadcrumb_patterns = [
        r"当前位置", r"您的位置", r"首页\s*[>＞→]",
        r"^(首页|主页|Home)",
        r"^\s*(首页\s*[>＞→]\s*)+",
    ]
    for pat in breadcrumb_patterns:
        if re.search(pat, text):
            return True
    if re.search(r"^(政府|门户|网站|官网|首页)$", text):
        return True
    # 行政区划占位符（中文和英文括号，含顿号列举）
    if re.search(r"省[（(][区].*?[市][）)]|市[（(][州区县].*?[）)]", text):
        return True
    # 纯部门名（不包含政策关键词）
    if re.search(r"^[\u4e00-\u9fff（）]+(部门|单位|机构|委员会)$", text):
        return True
    if len(text) < 4:
        return True
    if re.match(r"^[\d\s\w]+$", text) and not re.search(r"[\u4e00-\u9fff]", text):
        return True
    return False


# ── URL → 地区推断 ────────────────────────────────────────────

URL_REGION_MAP = {
    # 国家层面
    "www.gov.cn": "国家层面",

    # 直辖市
    "beijing.gov.cn": "北京市",
    "bjrd.gov.cn": "北京市",
    "shanghai.gov.cn": "上海市",
    "sh.gov.cn": "上海市",
    "tj.gov.cn": "天津市",
    "cq.gov.cn": "重庆市",

    # 省级
    "heb.gov.cn": "河北省",
    "hebei.gov.cn": "河北省",
    "hbzwfw.gov.cn": "河北省",
    "shanxi.gov.cn": "山西省",
    "nmg.gov.cn": "内蒙古自治区",
    "huhhot.gov.cn": "内蒙古自治区呼和浩特市",
    "ordos.gov.cn": "内蒙古自治区鄂尔多斯市",
    "baotou.gov.cn": "内蒙古自治区包头市",
    "wuhai.gov.cn": "内蒙古自治区乌海市",
    "chifeng.gov.cn": "内蒙古自治区赤峰市",
    "tongliao.gov.cn": "内蒙古自治区通辽市",
    "wlcb.gov.cn": "内蒙古自治区乌兰察布市",
    "bayannur.gov.cn": "内蒙古自治区巴彦淖尔市",
    "alashan.gov.cn": "内蒙古自治区阿拉善盟",
    "xlmq.gov.cn": "内蒙古自治区锡林郭勒盟",
    "hlbe.gov.cn": "内蒙古自治区呼伦贝尔市",
    "ln.gov.cn": "辽宁省",
    "liaoning.gov.cn": "辽宁省",
    "jl.gov.cn": "吉林省",
    "jilin.gov.cn": "吉林省",
    "hlj.gov.cn": "黑龙江省",
    "heilongjiang.gov.cn": "黑龙江省",
    "jiangsu.gov.cn": "江苏省",
    "jszwfw.gov.cn": "江苏省",
    "zj.gov.cn": "浙江省",
    "zhejiang.gov.cn": "浙江省",
    "ah.gov.cn": "安徽省",
    "anhui.gov.cn": "安徽省",
    "fujian.gov.cn": "福建省",
    "jx.gov.cn": "江西省",
    "jiangxi.gov.cn": "江西省",
    "jxzwfww.gov.cn": "江西省",
    "xncb.gov.cn": "江西省",
    "sd.gov.cn": "山东省",
    "shandong.gov.cn": "山东省",
    "henan.gov.cn": "河南省",
    "hubei.gov.cn": "湖北省",
    "hunan.gov.cn": "湖南省",
    "gd.gov.cn": "广东省",
    "guangdong.gov.cn": "广东省",
    "gxzf.gov.cn": "广西壮族自治区",
    "hainan.gov.cn": "海南省",
    "sc.gov.cn": "四川省",
    "sichuan.gov.cn": "四川省",
    "guizhou.gov.cn": "贵州省",
    "yn.gov.cn": "云南省",
    "yunnan.gov.cn": "云南省",
    "xz.gov.cn": "西藏自治区",
    "xizang.gov.cn": "西藏自治区",
    "shaanxi.gov.cn": "陕西省",
    "gansu.gov.cn": "甘肃省",
    "qh.gov.cn": "青海省",
    "qinghai.gov.cn": "青海省",
    "nx.gov.cn": "宁夏回族自治区",
    "xinjiang.gov.cn": "新疆维吾尔自治区",

    # 北京市级
    "beijing.gov.cn": "北京市",

    # 河北省市级
    "sjz.gov.cn": "河北省石家庄市",
    "sjzswj.gov.cn": "河北省石家庄市",
    "tangshan.gov.cn": "河北省唐山市",
    "qhd.gov.cn": "河北省秦皇岛市",
    "handan.gov.cn": "河北省邯郸市",
    "xingtai.gov.cn": "河北省邢台市",
    "baoding.gov.cn": "河北省保定市",
    "zjk.gov.cn": "河北省张家口市",
    "chengde.gov.cn": "河北省承德市",
    "cangzhou.gov.cn": "河北省沧州市",
    "langfang.gov.cn": "河北省廊坊市",
    "hengshui.gov.cn": "河北省衡水市",

    # 山西省市级
    "taiyuan.gov.cn": "山西省太原市",
    "datong.gov.cn": "山西省大同市",
    "yangquan.gov.cn": "山西省阳泉市",
    "cz.gov.cn": "山西省长治市",
    "jincheng.gov.cn": "山西省晋城市",
    "shuozhou.gov.cn": "山西省朔州市",
    "jz.gov.cn": "山西省晋中市",
    "yuncheng.gov.cn": "山西省运城市",
    "xinzhou.gov.cn": "山西省忻州市",
    "linfen.gov.cn": "山西省临汾市",
    "lvliang.gov.cn": "山西省吕梁市",

    # 辽宁省市级
    "shenyang.gov.cn": "辽宁省沈阳市",
    "dl.gov.cn": "辽宁省大连市",
    "anshan.gov.cn": "辽宁省鞍山市",
    "fushun.gov.cn": "辽宁省抚顺市",
    "benxi.gov.cn": "辽宁省本溪市",
    "dandong.gov.cn": "辽宁省丹东市",
    "jinzhou.gov.cn": "辽宁省锦州市",
    "yingkou.gov.cn": "辽宁省营口市",
    "fuxin.gov.cn": "辽宁省阜新市",
    "liaoyang.gov.cn": "辽宁省辽阳市",
    "panjin.gov.cn": "辽宁省盘锦市",
    "tieling.gov.cn": "辽宁省铁岭市",
    "chaoyang.gov.cn": "辽宁省朝阳市",
    "hld.gov.cn": "辽宁省葫芦岛市",

    # 吉林省市级
    "cc.gov.cn": "吉林省长春市",
    "jilin.gov.cn": "吉林省吉林市",
    "siping.gov.cn": "吉林省四平市",
    "liaoyuan.gov.cn": "吉林省辽源市",
    "tonghua.gov.cn": "吉林省通化市",
    "baishan.gov.cn": "吉林省白山市",
    "songyuan.gov.cn": "吉林省松原市",
    "baicheng.gov.cn": "吉林省白城市",

    # 黑龙江省市级
    "harbin.gov.cn": "黑龙江省哈尔滨市",
    "qqhe.gov.cn": "黑龙江省齐齐哈尔市",
    "jixi.gov.cn": "黑龙江省鸡西市",
    "hegang.gov.cn": "黑龙江省鹤岗市",
    "shuangyashan.gov.cn": "黑龙江省双鸭山市",
    "daqing.gov.cn": "黑龙江省大庆市",
    "yc.gov.cn": "黑龙江省伊春市",
    "jms.gov.cn": "黑龙江省佳木斯市",
    "qitaihe.gov.cn": "黑龙江省七台河市",
    "mdj.gov.cn": "黑龙江省牡丹江市",
    "heihe.gov.cn": "黑龙江省黑河市",
    "suihua.gov.cn": "黑龙江省绥化市",

    # 江苏省市级
    "nanjing.gov.cn": "江苏省南京市",
    "wuxi.gov.cn": "江苏省无锡市",
    "xuzhou.gov.cn": "江苏省徐州市",
    "changzhou.gov.cn": "江苏省常州市",
    "suzhou.gov.cn": "江苏省苏州市",
    "nt.gov.cn": "江苏省南通市",
    "lyg.gov.cn": "江苏省连云港市",
    "huaian.gov.cn": "江苏省淮安市",
    "yancheng.gov.cn": "江苏省盐城市",
    "yangzhou.gov.cn": "江苏省扬州市",
    "zhenjiang.gov.cn": "江苏省镇江市",
    "taizhou.gov.cn": "江苏省泰州市",
    "suqian.gov.cn": "江苏省宿迁市",

    # 浙江省市级
    "hangzhou.gov.cn": "浙江省杭州市",
    "ningbo.gov.cn": "浙江省宁波市",
    "wenzhou.gov.cn": "浙江省温州市",
    "jiaxing.gov.cn": "浙江省嘉兴市",
    "huzhou.gov.cn": "浙江省湖州市",
    "shaoxing.gov.cn": "浙江省绍兴市",
    "jinhua.gov.cn": "浙江省金华市",
    "qz.gov.cn": "浙江省衢州市",
    "zhoushan.gov.cn": "浙江省舟山市",
    "taizhou.gov.cn": "浙江省台州市",
    "ls.gov.cn": "浙江省丽水市",

    # 安徽省市级
    "hefei.gov.cn": "安徽省合肥市",
    "wuhu.gov.cn": "安徽省芜湖市",
    "bb.gov.cn": "安徽省蚌埠市",
    "huainan.gov.cn": "安徽省淮南市",
    "mas.gov.cn": "安徽省马鞍山市",
    "huaibei.gov.cn": "安徽省淮北市",
    "tl.gov.cn": "安徽省铜陵市",
    "anqing.gov.cn": "安徽省安庆市",
    "hs.gov.cn": "安徽省黄山市",
    "chuzhou.gov.cn": "安徽省滁州市",
    "fuyang.gov.cn": "安徽省阜阳市",
    "sz.gov.cn": "安徽省宿州市",
    "la.gov.cn": "安徽省六安市",
    "bozhou.gov.cn": "安徽省亳州市",
    "chizhou.gov.cn": "安徽省池州市",
    "xuancheng.gov.cn": "安徽省宣城市",

    # 福建省市级
    "fuzhou.gov.cn": "福建省福州市",
    "xm.gov.cn": "福建省厦门市",
    "putian.gov.cn": "福建省莆田市",
    "sm.gov.cn": "福建省三明市",
    "quanzhou.gov.cn": "福建省泉州市",
    "zhangzhou.gov.cn": "福建省漳州市",
    "np.gov.cn": "福建省南平市",
    "longyan.gov.cn": "福建省龙岩市",
    "nd.gov.cn": "福建省宁德市",

    # 江西省市级
    "nanchang.gov.cn": "江西省南昌市",
    "jingdezhen.gov.cn": "江西省景德镇市",
    "px.gov.cn": "江西省萍乡市",
    "jiujiang.gov.cn": "江西省九江市",
    "xinyu.gov.cn": "江西省新余市",
    "yingtan.gov.cn": "江西省鹰潭市",
    "ganzhou.gov.cn": "江西省赣州市",
    "ja.gov.cn": "江西省吉安市",
    "yichun.gov.cn": "江西省宜春市",
    "fuzhoujx.gov.cn": "江西省抚州市",
    "sr.gov.cn": "江西省上饶市",

    # 山东省市级
    "jinan.gov.cn": "山东省济南市",
    "qingdao.gov.cn": "山东省青岛市",
    "zibo.gov.cn": "山东省淄博市",
    "zaozhuang.gov.cn": "山东省枣庄市",
    "dongying.gov.cn": "山东省东营市",
    "yt.gov.cn": "山东省烟台市",
    "weifang.gov.cn": "山东省潍坊市",
    "jining.gov.cn": "山东省济宁市",
    "taian.gov.cn": "山东省泰安市",
    "weihai.gov.cn": "山东省威海市",
    "rizhao.gov.cn": "山东省日照市",
    "linyi.gov.cn": "山东省临沂市",
    "dezhou.gov.cn": "山东省德州市",
    "liaocheng.gov.cn": "山东省聊城市",
    "binzhou.gov.cn": "山东省滨州市",
    "heze.gov.cn": "山东省菏泽市",

    # 河南省市级
    "zz.gov.cn": "河南省郑州市",
    "kaifeng.gov.cn": "河南省开封市",
    "luoyang.gov.cn": "河南省洛阳市",
    "pds.gov.cn": "河南省平顶山市",
    "ay.gov.cn": "河南省安阳市",
    "hebi.gov.cn": "河南省鹤壁市",
    "xx.gov.cn": "河南省新乡市",
    "jiaozuo.gov.cn": "河南省焦作市",
    "puyang.gov.cn": "河南省濮阳市",
    "xuchang.gov.cn": "河南省许昌市",
    "luohe.gov.cn": "河南省漯河市",
    "smx.gov.cn": "河南省三门峡市",
    "nanyang.gov.cn": "河南省南阳市",
    "sq.gov.cn": "河南省商丘市",
    "xinyang.gov.cn": "河南省信阳市",
    "zk.gov.cn": "河南省周口市",
    "zmd.gov.cn": "河南省驻马店市",

    # 湖北省市级
    "wuhan.gov.cn": "湖北省武汉市",
    "huangshi.gov.cn": "湖北省黄石市",
    "shiyan.gov.cn": "湖北省十堰市",
    "yichang.gov.cn": "湖北省宜昌市",
    "xiangyang.gov.cn": "湖北省襄阳市",
    "ez.gov.cn": "湖北省鄂州市",
    "jingmen.gov.cn": "湖北省荆门市",
    "xiaogan.gov.cn": "湖北省孝感市",
    "jingzhou.gov.cn": "湖北省荆州市",
    "huanggang.gov.cn": "湖北省黄冈市",
    "xianning.gov.cn": "湖北省咸宁市",
    "suizhou.gov.cn": "湖北省随州市",
    "qianjiang.gov.cn": "湖北省潜江市",
    "xiantao.gov.cn": "湖北省仙桃市",
    "tianmen.gov.cn": "湖北省天门市",
    "sn.gov.cn": "湖北省神农架林区",

    # 湖南省市级
    "cs.gov.cn": "湖南省长沙市",
    "zhuzhou.gov.cn": "湖南省株洲市",
    "xiangtan.gov.cn": "湖南省湘潭市",
    "hengyang.gov.cn": "湖南省衡阳市",
    "shaoyang.gov.cn": "湖南省邵阳市",
    "yueyang.gov.cn": "湖南省岳阳市",
    "changde.gov.cn": "湖南省常德市",
    "zjj.gov.cn": "湖南省张家界市",
    "yiyang.gov.cn": "湖南省益阳市",
    "chenzhou.gov.cn": "湖南省郴州市",
    "yongzhou.gov.cn": "湖南省永州市",
    "huaihua.gov.cn": "湖南省怀化市",
    "loudi.gov.cn": "湖南省娄底市",

    # 广东省市级
    "gz.gov.cn": "广东省广州市",
    "shenzhen.gov.cn": "广东省深圳市",
    "zhuhai.gov.cn": "广东省珠海市",
    "shantou.gov.cn": "广东省汕头市",
    "foshan.gov.cn": "广东省佛山市",
    "shaoguan.gov.cn": "广东省韶关市",
    "zhanjiang.gov.cn": "广东省湛江市",
    "zhaoqing.gov.cn": "广东省肇庆市",
    "jiangmen.gov.cn": "广东省江门市",
    "maoming.gov.cn": "广东省茂名市",
    "huizhou.gov.cn": "广东省惠州市",
    "meizhou.gov.cn": "广东省梅州市",
    "sw.gov.cn": "广东省汕尾市",
    "heyuan.gov.cn": "广东省河源市",
    "yangjiang.gov.cn": "广东省阳江市",
    "qingyuan.gov.cn": "广东省清远市",
    "dg.gov.cn": "广东省东莞市",
    "zs.gov.cn": "广东省中山市",
    "chaozhou.gov.cn": "广东省潮州市",
    "jieyang.gov.cn": "广东省揭阳市",
    "yunfu.gov.cn": "广东省云浮市",

    # 广西市级
    "nanning.gov.cn": "广西壮族自治区南宁市",
    "liuzhou.gov.cn": "广西壮族自治区柳州市",
    "guilin.gov.cn": "广西壮族自治区桂林市",
    "wuzhou.gov.cn": "广西壮族自治区梧州市",
    "bh.gov.cn": "广西壮族自治区北海市",
    "fcg.gov.cn": "广西壮族自治区防城港市",
    "qinzhou.gov.cn": "广西壮族自治区钦州市",
    "gg.gov.cn": "广西壮族自治区贵港市",
    "yulin.gov.cn": "广西壮族自治区玉林市",
    "baise.gov.cn": "广西壮族自治区百色市",
    "hezhou.gov.cn": "广西壮族自治区贺州市",
    "hc.gov.cn": "广西壮族自治区河池市",
    "laibin.gov.cn": "广西壮族自治区来宾市",
    "chongzuo.gov.cn": "广西壮族自治区崇左市",

    # 海南省级市
    "haikou.gov.cn": "海南省海口市",
    "sanya.gov.cn": "海南省三亚市",
    "sanha.gov.cn": "海南省三沙市",
    "danzhou.gov.cn": "海南省儋州市",

    # 四川省市级
    "cd.gov.cn": "四川省成都市",
    "zigong.gov.cn": "四川省自贡市",
    "pzhs.gov.cn": "四川省攀枝花市",
    "panzhihua.gov.cn": "四川省攀枝花市",
    "luzhou.gov.cn": "四川省泸州市",
    "deyang.gov.cn": "四川省德阳市",
    "mianyang.gov.cn": "四川省绵阳市",
    "guangyuan.gov.cn": "四川省广元市",
    "suining.gov.cn": "四川省遂宁市",
    "neijiang.gov.cn": "四川省内江市",
    "leshan.gov.cn": "四川省乐山市",
    "nanchong.gov.cn": "四川省南充市",
    "ms.gov.cn": "四川省眉山市",
    "yb.gov.cn": "四川省宜宾市",
    "ga.gov.cn": "四川省广安市",
    "dz.gov.cn": "四川省达州市",
    "ya.gov.cn": "四川省雅安市",
    "bz.gov.cn": "四川省巴中市",
    "zy.gov.cn": "四川省资阳市",

    # 贵州省市级
    "guiyang.gov.cn": "贵州省贵阳市",
    "lps.gov.cn": "贵州省六盘水市",
    "zunyi.gov.cn": "贵州省遵义市",
    "anshun.gov.cn": "贵州省安顺市",
    "bijie.gov.cn": "贵州省毕节市",
    "tr.gov.cn": "贵州省铜仁市",

    # 云南省市级
    "km.gov.cn": "云南省昆明市",
    "qj.gov.cn": "云南省曲靖市",
    "ux.gov.cn": "云南省玉溪市",
    "bs.gov.cn": "云南省保山市",
    "zhaotong.gov.cn": "云南省昭通市",
    "lincang.gov.cn": "云南省临沧市",
    "dali.gov.cn": "云南省大理市",

    # 陕西省市级
    "xa.gov.cn": "陕西省西安市",
    "tc.gov.cn": "陕西省铜川市",
    "baoji.gov.cn": "陕西省宝鸡市",
    "xianyang.gov.cn": "陕西省咸阳市",
    "weinanzf.gov.cn": "陕西省渭南市",
    "yanan.gov.cn": "陕西省延安市",
    "hanzhong.gov.cn": "陕西省汉中市",
    "yulin.gov.cn": "陕西省榆林市",
    "ankang.gov.cn": "陕西省安康市",
    "sl.gov.cn": "陕西省商洛市",

    # 甘肃省市级
    "lanzhou.gov.cn": "甘肃省兰州市",
    "jyg.gov.cn": "甘肃省嘉峪关市",
    "jcs.gov.cn": "甘肃省金昌市",
    "by.gov.cn": "甘肃省白银市",
    "tianshui.gov.cn": "甘肃省天水市",
    "wuwei.gov.cn": "甘肃省武威市",
    "zys.gov.cn": "甘肃省张掖市",
    "pingliang.gov.cn": "甘肃省平凉市",
    "jiuquan.gov.cn": "甘肃省酒泉市",
    "qingyang.gov.cn": "甘肃省庆阳市",
    "dn.gov.cn": "甘肃省定西市",
    "longnan.gov.cn": "甘肃省陇南市",

    # 青海省市级
    "xining.gov.cn": "青海省西宁市",

    # 新疆市级
    "wlmq.gov.cn": "新疆维吾尔自治区乌鲁木齐市",
    "klmy.gov.cn": "新疆维吾尔自治区克拉玛依市",

    # ── 县级市 ──────────────────────────────────────────────

    # 河北省县级市
    "xinji.gov.cn": "河北省辛集市",
    "zgz.gov.cn": "河北省晋州市",
    "dingzhou.gov.cn": "河北省定州市",
    "zhuozhou.gov.cn": "河北省涿州市",
    "dingxing.gov.cn": "河北省定兴县",
    "gaobeidian.gov.cn": "河北省高碑店市",
    "qianan.gov.cn": "河北省迁安市",
    "wuans.gov.cn": "河北省武安市",
    "shahe.gov.cn": "河北省沙河市",
    "renzqiu.gov.cn": "河北省任丘市",
    "hejian.gov.cn": "河北省河间市",
    "bazhou.gov.cn": "河北省霸州市",
    "sanhe.gov.cn": "河北省三河市",
    "jizhou.gov.cn": "河北省冀州市",
    "shenzhou.gov.cn": "河北省深州市",
    "gaocheng.gov.cn": "河北省藁城区",
    "luancheng.gov.cn": "河北省栾城区",
    "jingxing.gov.cn": "河北省井陉矿区",
    "xinle.gov.cn": "河北省新乐市",
    "luquan.gov.cn": "河北省鹿泉区",
    "zhangjiakou.gov.cn": "河北省张家口市",
    "pingshan.gov.cn": "河北省平山县",
    "lincheng.gov.cn": "河北省临城县",
    "neiqiu.gov.cn": "河北省内丘县",
    "baixiang.gov.cn": "河北省柏乡县",
    "longyao.gov.cn": "河北省隆尧县",
    "ningjin.gov.cn": "河北省宁晋县",
    "julu.gov.cn": "河北省巨鹿县",
    "xinhe.gov.cn": "河北省新河县",
    "guangzong.gov.cn": "河北省广宗县",
    "pingxiangxian.gov.cn": "河北省平乡县",
    "wei.gov.cn": "河北省威县",
    "qinghe.gov.cn": "河北省清河县",
    "linxi.gov.cn": "河北省临西县",
    "nanhe.gov.cn": "河北省南和县",
    "renxian.gov.cn": "河北省任县",

    # 山西省县级市
    "guzhou.gov.cn": "山西省古交市",
    "gaoping.gov.cn": "山西省高平市",
    "xiaoyi.gov.cn": "山西省孝义市",
    "fenyang.gov.cn": "山西省汾阳市",
    "yuanping.gov.cn": "山西省原平市",
    "houma.gov.cn": "山西省侯马市",
    "huozhou.gov.cn": "山西省霍州市",
    "hejin.gov.cn": "山西省河津市",
    "jiexiu.gov.cn": "山西省介休市",
    "linfen.gov.cn": "山西省临汾市",

    # 内蒙古县级市
    "manzhouli.gov.cn": "内蒙古自治区满洲里市",
    "eerguna.gov.cn": "内蒙古自治区额尔古纳市",
    "genhe.gov.cn": "内蒙古自治区根河市",
    "yakeshi.gov.cn": "内蒙古自治区牙克石市",
    "zhalantun.gov.cn": "内蒙古自治区扎兰屯市",
    "wulanhaote.gov.cn": "内蒙古自治区乌兰浩特市",
    "huolinguole.gov.cn": "内蒙古自治区霍林郭勒市",
    "xilinhot.gov.cn": "内蒙古自治区锡林浩特市",
    "ejina.gov.cn": "内蒙古自治区额济纳旗",

    # 辽宁省县级市
    "xinmin.gov.cn": "辽宁省新民市",
    "wafangdian.gov.cn": "辽宁省瓦房店市",
    "zhuanghe.gov.cn": "辽宁省庄河市",
    "haicheng.gov.cn": "辽宁省海城市",
    "donggang.gov.cn": "辽宁省东港市",
    "fengcheng.gov.cn": "辽宁省凤城市",
    "linghai.gov.cn": "辽宁省凌海市",
    "beizhen.gov.cn": "辽宁省北镇市",
    "dashiqiao.gov.cn": "辽宁省大石桥市",
    "gaizhou.gov.cn": "辽宁省盖州市",
    "dengta.gov.cn": "辽宁省灯塔市",
    "tiaobingshan.gov.cn": "辽宁省调兵山市",
    "kaiyuan.gov.cn": "辽宁省开原市",
    "beipiao.gov.cn": "辽宁省北票市",
    "lingyuan.gov.cn": "辽宁省凌源市",
    "xingcheng.gov.cn": "辽宁省兴城市",

    # 吉林省县级市
    "jiutai.gov.cn": "吉林省九台市",
    "yushu.gov.cn": "吉林省榆树市",
    "dehui.gov.cn": "吉林省德惠市",
    "jiaohe.gov.cn": "吉林省蛟河市",
    "huadian.gov.cn": "吉林省桦甸市",
    "shulan.gov.cn": "吉林省舒兰市",
    "panshi.gov.cn": "吉林省磐石市",
    "gongzhuling.gov.cn": "吉林省公主岭市",
    "meihekou.gov.cn": "吉林省梅河口市",
    "jiyan.gov.cn": "吉林省集安市",
    "linjiang.gov.cn": "吉林省临江市",
    "fuyu.gov.cn": "吉林省扶余市",
    "taonan.gov.cn": "吉林省洮南市",
    "daan.gov.cn": "吉林省大安市",
    "yanji.gov.cn": "吉林省延吉市",
    "tumen.gov.cn": "吉林省图们市",
    "dunhua.gov.cn": "吉林省敦化市",
    "hunchun.gov.cn": "吉林省珲春市",
    "longjing.gov.cn": "吉林省龙井市",
    "helong.gov.cn": "吉林省和龙市",

    # 黑龙江省县级市
    "shangzhi.gov.cn": "黑龙江省尚志市",
    "wuchang.gov.cn": "黑龙江省五常市",
    "ningan.gov.cn": "黑龙江省宁安市",
    "hailin.gov.cn": "黑龙江省海林市",
    "muling.gov.cn": "黑龙江省穆棱市",
    "suifenhe.gov.cn": "黑龙江省绥芬河市",
    "fujin.gov.cn": "黑龙江省富锦市",
    "tongjiang.gov.cn": "黑龙江省同江市",
    "fuyuan.gov.cn": "黑龙江省抚远市",
    "beian.gov.cn": "黑龙江省北安市",
    "wudalianchi.gov.cn": "黑龙江省五大连池市",
    "nenjiang.gov.cn": "黑龙江省嫩江市",
    "hailun.gov.cn": "黑龙江省海伦市",
    "anda.gov.cn": "黑龙江省安达市",
    "zhaodong.gov.cn": "黑龙江省肇东市",
    "tieli.gov.cn": "黑龙江省铁力市",
    "mohe.gov.cn": "黑龙江省漠河市",
    "tahe.gov.cn": "黑龙江省塔河县",
    "huma.gov.cn": "黑龙江省呼玛县",

    # 江苏省县级市
    "jiangyin.gov.cn": "江苏省江阴市",
    "yixing.gov.cn": "江苏省宜兴市",
    "xinyi.gov.cn": "江苏省新沂市",
    "pizhou.gov.cn": "江苏省邳州市",
    "liyang.gov.cn": "江苏省溧阳市",
    "changshu.gov.cn": "江苏省常熟市",
    "zhangjiagang.gov.cn": "江苏省张家港市",
    "kunshan.gov.cn": "江苏省昆山市",
    "taicang.gov.cn": "江苏省太仓市",
    "qidong.gov.cn": "江苏省启东市",
    "rugao.gov.cn": "江苏省如皋市",
    "haimen.gov.cn": "江苏省海门市",
    "hai'an.gov.cn": "江苏省海安市",
    "dongtai.gov.cn": "江苏省东台市",
    "gaoyou.gov.cn": "江苏省高邮市",
    "yizheng.gov.cn": "江苏省仪征市",
    "yangzhong.gov.cn": "江苏省扬中市",
    "jurong.gov.cn": "江苏省句容市",
    "jingjiang.gov.cn": "江苏省靖江市",
    "taixing.gov.cn": "江苏省泰兴市",
    "xinghua.gov.cn": "江苏省兴化市",
    "sihong.gov.cn": "江苏省泗洪县",
    "shuyang.gov.cn": "江苏省沭阳县",

    # 浙江省县级市
    "jiande.gov.cn": "浙江省建德市",
    "yuyao.gov.cn": "浙江省余姚市",
    "cixi.gov.cn": "浙江省慈溪市",
    "pinghu.gov.cn": "浙江省平湖市",
    "haining.gov.cn": "浙江省海宁市",
    "tongxiang.gov.cn": "浙江省桐乡市",
    "zhuji.gov.cn": "浙江省诸暨市",
    "shengzhou.gov.cn": "浙江省嵊州市",
    "yiwu.gov.cn": "浙江省义乌市",
    "dongyang.gov.cn": "浙江省东阳市",
    "yongkang.gov.cn": "浙江省永康市",
    "jiangshan.gov.cn": "浙江省江山市",
    "linhai.gov.cn": "浙江省临海市",
    "wenling.gov.cn": "浙江省温岭市",
    "yuhuan.gov.cn": "浙江省玉环市",
    "longquan.gov.cn": "浙江省龙泉市",
    "ruian.gov.cn": "浙江省瑞安市",
    "yueqing.gov.cn": "浙江省乐清市",
    "haiyan.gov.cn": "浙江省海盐县",
    "deqing.gov.cn": "浙江省德清县",
    "changxing.gov.cn": "浙江省长兴县",
    "anji.gov.cn": "浙江省安吉县",

    # 安徽省县级市
    "chaohu.gov.cn": "安徽省巢湖市",
    "wuwei.gov.cn": "安徽省无为市",
    "guangde.gov.cn": "安徽省广德市",
    "ningguo.gov.cn": "安徽省宁国市",
    "jieshou.gov.cn": "安徽省界首市",
    "tongcheng.gov.cn": "安徽省桐城市",
    "qianshan.gov.cn": "安徽省潜山市",
    "mingguang.gov.cn": "安徽省明光市",
    "tianchang.gov.cn": "安徽省天长市",
    "langxi.gov.cn": "安徽省郎溪县",

    # 福建省县级市
    "fuan.gov.cn": "福建省福安市",
    "fuding.gov.cn": "福建省福鼎市",
    "shishi.gov.cn": "福建省石狮市",
    "jinjiang.gov.cn": "福建省晋江市",
    "nanan.gov.cn": "福建省南安市",
    "longhai.gov.cn": "福建省龙海市",
    "zhangping.gov.cn": "福建省漳平市",
    "shaowu.gov.cn": "福建省邵武市",
    "wuyishan.gov.cn": "福建省武夷山市",
    "jianou.gov.cn": "福建省建瓯市",
    "jianyang.gov.cn": "福建省建阳区",
    "fuqing.gov.cn": "福建省福清市",
    "changle.gov.cn": "福建省长乐区",
    "yongan.gov.cn": "福建省永安市",
    "xiapu.gov.cn": "福建省霞浦县",

    # 江西省县级市
    "ruichang.gov.cn": "江西省瑞昌市",
    "gongqingcheng.gov.cn": "江西省共青城市",
    "lucheng.gov.cn": "江西省庐山市",
    "guixi.gov.cn": "江西省贵溪市",
    "ruojin.gov.cn": "江西省瑞金市",
    "fengcheng.gov.cn": "江西省丰城市",
    "zhangshu.gov.cn": "江西省樟树市",
    "gaoan.gov.cn": "江西省高安市",
    "decheng.gov.cn": "江西省德兴市",
    "jinggangshan.gov.cn": "江西省井冈山市",
    "nankang.gov.cn": "江西省南康区",
    "longnan.gov.cn": "江西省龙南市",

    # 山东省县级市
    "zhangqiu.gov.cn": "山东省章丘区",
    "jiaonan.gov.cn": "山东省胶南区",
    "jiaozhou.gov.cn": "山东省胶州市",
    "pingdu.gov.cn": "山东省平度市",
    "laixi.gov.cn": "山东省莱西市",
    "zoucheng.gov.cn": "山东省邹城市",
    "qufu.gov.cn": "山东省曲阜市",
    "zouping.gov.cn": "山东省邹平市",
    "longkou.gov.cn": "山东省龙口市",
    "laizhou.gov.cn": "山东省莱州市",
    "zhaoyuan.gov.cn": "山东省招远市",
    "qixia.gov.cn": "山东省栖霞市",
    "haiyang.gov.cn": "山东省海阳市",
    "qingzhou.gov.cn": "山东省青州市",
    "zhucheng.gov.cn": "山东省诸城市",
    "shouguang.gov.cn": "山东省寿光市",
    "anqiu.gov.cn": "山东省安丘市",
    "gaomi.gov.cn": "山东省高密市",
    "changyi.gov.cn": "山东省昌邑市",
    "rongcheng.gov.cn": "山东省荣成市",
    "rushan.gov.cn": "山东省乳山市",
    "tengzhou.gov.cn": "山东省滕州市",
    "xintai.gov.cn": "山东省新泰市",
    "feicheng.gov.cn": "山东省肥城市",
    "wendeng.gov.cn": "山东省文登区",
    "laoling.gov.cn": "山东省乐陵市",
    "yucheng.gov.cn": "山东省禹城市",
    "linqing.gov.cn": "山东省临清市",
    "penglai.gov.cn": "山东省蓬莱区",

    # 河南省县级市
    "gongyi.gov.cn": "河南省巩义市",
    "xingyang.gov.cn": "河南省荥阳市",
    "xinmi.gov.cn": "河南省新密市",
    "xinzheng.gov.cn": "河南省新郑市",
    "dengfeng.gov.cn": "河南省登封市",
    "yanjin.gov.cn": "河南省偃师区",
    "mengjin.gov.cn": "河南省孟津区",
    "ruzhou.gov.cn": "河南省汝州市",
    "wugang.gov.cn": "河南省舞钢市",
    "huixian.gov.cn": "河南省辉县市",
    "weihui.gov.cn": "河南省卫辉市",
    "changyuan.gov.cn": "河南省长垣市",
    "qinyang.gov.cn": "河南省沁阳市",
    "mengzhou.gov.cn": "河南省孟州市",
    "yuzhou.gov.cn": "河南省禹州市",
    "changge.gov.cn": "河南省长葛市",
    "yima.gov.cn": "河南省义马市",
    "lingbao.gov.cn": "河南省灵宝市",
    "dengzhou.gov.cn": "河南省邓州市",
    "yongcheng.gov.cn": "河南省永城市",
    "xiangcheng.gov.cn": "河南省项城市",
    "jiyuan.gov.cn": "河南省济源市",

    # 湖北省县级市
    "daye.gov.cn": "湖北省大冶市",
    "danjiangkou.gov.cn": "湖北省丹江口市",
    "yicheng.gov.cn": "湖北省宜城市",
    "laohekou.gov.cn": "湖北省老河口市",
    "zaoyang.gov.cn": "湖北省枣阳市",
    "zhongxiang.gov.cn": "湖北省钟祥市",
    "jingshan.gov.cn": "湖北省京山市",
    "yingcheng.gov.cn": "湖北省应城市",
    "anlu.gov.cn": "湖北省安陆市",
    "guangshui.gov.cn": "湖北省广水市",
    "macheng.gov.cn": "湖北省麻城市",
    "wuxue.gov.cn": "湖北省武穴市",
    "chibi.gov.cn": "湖北省赤壁市",
    "shishou.gov.cn": "湖北省石首市",
    "honghu.gov.cn": "湖北省洪湖市",
    "songzi.gov.cn": "湖北省松滋市",
    "zhijiang.gov.cn": "湖北省枝江市",
    "yidu.gov.cn": "湖北省宜都市",
    "dangyang.gov.cn": "湖北省当阳市",
    "xiantao.gov.cn": "湖北省仙桃市",
    "qianjiang.gov.cn": "湖北省潜江市",
    "tianmen.gov.cn": "湖北省天门市",
    "shennongjia.gov.cn": "湖北省神农架林区",
    "enshi.gov.cn": "湖北省恩施市",
    "lichuan.gov.cn": "湖北省利川市",

    # 湖南省县级市
    "liuyang.gov.cn": "湖南省浏阳市",
    "ningxiang.gov.cn": "湖南省宁乡市",
    "leiyang.gov.cn": "湖南省耒阳市",
    "changning.gov.cn": "湖南省常宁市",
    "lishi.gov.cn": "湖南省醴陵市",
    "xiangxiang.gov.cn": "湖南省湘乡市",
    "shaoshan.gov.cn": "湖南省韶山市",
    "wugang.gov.cn": "湖南省武冈市",
    "miluo.gov.cn": "湖南省汨罗市",
    "linxiang.gov.cn": "湖南省临湘市",
    "jinshi.gov.cn": "湖南省津市市",
    "yuanjiang.gov.cn": "湖南省沅江市",
    "zixing.gov.cn": "湖南省资兴市",
    "hongjiang.gov.cn": "湖南省洪江市",
    "lengshuijiang.gov.cn": "湖南省冷水江市",
    "lianyuan.gov.cn": "湖南省涟源市",
    "jishou.gov.cn": "湖南省吉首市",

    # 广东省县级市
    "conghua.gov.cn": "广东省从化区",
    "zengcheng.gov.cn": "广东省增城区",
    "nanxiong.gov.cn": "广东省南雄市",
    "lechang.gov.cn": "广东省乐昌市",
    "pingyuan.gov.cn": "广东省平远县",
    "jiaoling.gov.cn": "广东省蕉岭县",
    "dabu.gov.cn": "广东省大埔县",
    "fengshun.gov.cn": "广东省丰顺县",
    "wuhua.gov.cn": "广东省五华县",
    "xingning.gov.cn": "广东省兴宁市",
    "taishan.gov.cn": "广东省台山市",
    "kaiping.gov.cn": "广东省开平市",
    "heshan.gov.cn": "广东省鹤山市",
    "enping.gov.cn": "广东省恩平市",
    "gaozhou.gov.cn": "广东省高州市",
    "huazhou.gov.cn": "广东省化州市",
    "xinyi.gov.cn": "广东省信宜市",
    "leizhou.gov.cn": "广东省雷州市",
    "lianjiang.gov.cn": "广东省廉江市",
    "wuchuan.gov.cn": "广东省吴川市",
    "sihui.gov.cn": "广东省四会市",
    "gaoyao.gov.cn": "广东省高要区",
    "huilai.gov.cn": "广东省惠来县",
    "jiexi.gov.cn": "广东省揭西县",
    "luoding.gov.cn": "广东省罗定市",
    "xinxing.gov.cn": "广东省新兴县",
    "yunan.gov.cn": "广东省郁南县",

    # 广西县级市
    "lipu.gov.cn": "广西壮族自治区荔浦市",
    "pingguo.gov.cn": "广西壮族自治区平果市",
    "jingxi.gov.cn": "广西壮族自治区靖西市",
    "dongxing.gov.cn": "广西壮族自治区东兴市",
    "pingxiang.gov.cn": "广西壮族自治区凭祥市",
    "beiliu.gov.cn": "广西壮族自治区北流市",
    "guiping.gov.cn": "广西壮族自治区桂平市",
    "cenxi.gov.cn": "广西壮族自治区岑溪市",
    "hepu.gov.cn": "广西壮族自治区合浦县",

    # 海南省县级市
    "wenchang.gov.cn": "海南省文昌市",
    "qionghai.gov.cn": "海南省琼海市",
    "wanning.gov.cn": "海南省万宁市",
    "dongfang.gov.cn": "海南省东方市",
    "wuzhishan.gov.cn": "海南省五指山市",

    # 四川省县级市
    "jianyang.gov.cn": "四川省简阳市",
    "dujiangyan.gov.cn": "四川省都江堰市",
    "pengzhou.gov.cn": "四川省彭州市",
    "qionglai.gov.cn": "四川省邛崃市",
    "chongzhou.gov.cn": "四川省崇州市",
    "jiangyou.gov.cn": "四川省江油市",
    "guanghan.gov.cn": "四川省广汉市",
    "shifang.gov.cn": "四川省什邡市",
    "mianzhu.gov.cn": "四川省绵竹市",
    "elang.gov.cn": "四川省峨眉山市",
    "longchang.gov.cn": "四川省隆昌市",
    "wanyuan.gov.cn": "四川省万源市",
    "huaying.gov.cn": "四川省华蓥市",
    "kangding.gov.cn": "四川省康定市",
    "xichang.gov.cn": "四川省西昌市",

    # 贵州省县级市
    "qingzhen.gov.cn": "贵州省清镇市",
    "chishui.gov.cn": "贵州省赤水市",
    "renhuai.gov.cn": "贵州省仁怀市",
    "panzhou.gov.cn": "贵州省盘州市",
    "xingyi.gov.cn": "贵州省兴义市",
    "xingren.gov.cn": "贵州省兴仁市",
    "kaili.gov.cn": "贵州省凯里市",
    "dushan.gov.cn": "贵州省都匀市",
    "fuquan.gov.cn": "贵州省福泉市",
    "bijie.gov.cn": "贵州省毕节市",

    # 云南省县级市
    "anning.gov.cn": "云南省安宁市",
    "xuanwei.gov.cn": "云南省宣威市",
    "shilin.gov.cn": "云南省石林县",
    "mengzi.gov.cn": "云南省蒙自市",
    "gejiu.gov.cn": "云南省个旧市",
    "kaiyuan.gov.cn": "云南省开远市",
    "mile.gov.cn": "云南省弥勒市",
    "wenshan.gov.cn": "云南省文山市",
    "jinghong.gov.cn": "云南省景洪市",
    "dali.gov.cn": "云南省大理市",
    "ruili.gov.cn": "云南省瑞丽市",
    "mangshi.gov.cn": "云南省芒市",
    "lincang.gov.cn": "云南省临沧市",
    "tengchong.gov.cn": "云南省腾冲市",
    "shangri-la.gov.cn": "云南省香格里拉市",

    # 陕西省县级市
    "xingping.gov.cn": "陕西省兴平市",
    "binzhou.gov.cn": "陕西省彬州市",
    "hancheng.gov.cn": "陕西省韩城市",
    "huayin.gov.cn": "陕西省华阴市",
    "shenmu.gov.cn": "陕西省神木市",
    "zizhou.gov.cn": "陕西省子洲县",

    # 甘肃省县级市
    "yumen.gov.cn": "甘肃省玉门市",
    "dunhuang.gov.cn": "甘肃省敦煌市",
    "linxia.gov.cn": "甘肃省临夏市",
    "hezheng.gov.cn": "甘肃省合作市",
    "huating.gov.cn": "甘肃省华亭市",

    # 青海省县级
    "delingha.gov.cn": "青海省德令哈市",
    "geermu.gov.cn": "青海省格尔木市",
    "yushu.gov.cn": "青海省玉树市",
    "menyuan.gov.cn": "青海省门源县",
    "qilian.gov.cn": "青海省祁连县",

    # 新疆县级市
    "shihezi.gov.cn": "新疆维吾尔自治区石河子市",
    "alaer.gov.cn": "新疆维吾尔自治区阿拉尔市",
    "tumushuke.gov.cn": "新疆维吾尔自治区图木舒克市",
    "wujiaqu.gov.cn": "新疆维吾尔自治区五家渠市",
    "beitun.gov.cn": "新疆维吾尔自治区北屯市",
    "shuanghe.gov.cn": "新疆维吾尔自治区双河市",
    "kuytun.gov.cn": "新疆维吾尔自治区奎屯市",
    "hoboksar.gov.cn": "新疆维吾尔自治区和布克赛尔县",

    # 兜底
    "gov.cn": "国家层面",
}


def infer_region_from_url(url: str) -> str:
    """从 URL 域名推断发布地区

    按域名长度降序匹配，确保更具体的子域名优先（如 shanghai.gov.cn 优先于 gov.cn）。
    """
    if not url:
        return ""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    # 按 key 长度降序排列，长域名优先匹配
    for key, value in sorted(URL_REGION_MAP.items(), key=lambda x: len(x[0]), reverse=True):
        if key in domain:
            return value
    return ""


# ── 补贴类型关键词 ────────────────────────────────────────────

SUBSIDY_KEYWORDS = {
    "育儿补贴": ["育儿补贴", "婴幼儿补贴", "托育补贴", "生育补贴"],
    "住房补贴": ["住房补贴", "购房补贴", "租房补贴", "住房保障"],
    "就业补贴": ["就业补贴", "创业补贴", "稳岗补贴", "扩岗补助"],
    "养老补贴": ["养老补贴", "高龄津贴", "养老服务补贴"],
    "医疗补贴": ["医疗救助", "医保补贴", "大病救助"],
    "教育补贴": ["教育补贴", "助学金", "助学贷款补贴"],
    "残疾人补贴": ["残疾人补贴", "残疾人护理补贴", "困难残疾人生活补贴"],
    "退役军人补贴": ["退役军人补贴", "退役士兵补助", "优抚金"],
}

# ── "具体事项"展示名 → 搜索关键词映射（一对一） ─────────────────
# key = 右列"具体事项"，value = 搜索词（用于政府网站搜索）
SUBSIDY_ITEM_SEARCH_MAP = {
    # 育儿/养老类
    "育儿补贴申领资格审核": "育儿补贴",
    "老年人福利补贴资格审核": "高龄津贴",
    # 社会救助类
    "特困人员救助供养": "特困供养",
    "最低生活保障": "低保",
    "临时救助": "临时救助",
    "特困、低保等困难群众医疗救助申请和受理": "医疗救助",
    "国家助学贷款申请和受理": "助学贷款",
    "住房救助": "住房救助",
    "就业救助": "就业救助",
    # 科技/创业类
    "科技成果转化专项资金申请": "科技成果转化",
    "知识产权支持资金申请": "知识产权",
    "创业补贴申领": "创业补贴",
    # 以旧换新类
    "家电以旧换新和手机等购新补贴资格校验": "以旧换新补贴",
    "汽车报废更新补贴申请": "汽车报废更新",
    # 个人身后类
    "个人账户一次性待遇申领（基本养老保险）": "养老保险个人账户",
    "参保人员职工基本医疗保险个人账户余额一次性支取": "医保个人账户",
    "住房公积金提取（死亡）": "住房公积金",
    "已故存款人小额存款提取（继承人提取）": "存款提取",
    # 退役军人/残疾人/退休类
    "自主就业一次性经济补助金的给付": "退役军人补助",
    "困难残疾人生活补贴": "残疾人生活补贴",
    "重度残疾人护理补贴": "残疾人护理补贴",
    "城乡居民基本养老保险补助": "城乡居民养老保险",
    "新增退休人员养老保险待遇核定发放": "退休养老金",
    "离休、退休提取住房公积金": "退休公积金",
    "城镇独生子女父母奖励金": "独生子女奖励",
}

# ─ "具体事项"展示名 → "一件事"名称映射（页面展示用） ────────────
# key = 右列"具体事项"，value = 左列"一件事"名称（用于页面展示）
SUBSIDY_ITEM_DISPLAY_MAP = {
    # 育儿/养老类
    "育儿补贴申领资格审核": "育儿补贴申领一件事",
    "老年人福利补贴资格审核": "老年人福利补贴申领\"一件事\"",
    # 社会救助类
    "特困人员救助供养": "社会救助\"一件事\"",
    "最低生活保障": "社会救助\"一件事\"",
    "临时救助": "社会救助\"一件事\"",
    "特困、低保等困难群众医疗救助申请和受理": "社会救助\"一件事\"",
    "国家助学贷款申请和受理": "社会救助\"一件事\"",
    "住房救助": "社会救助\"一件事\"",
    "就业救助": "社会救助\"一件事\"",
    # 科技/创业类
    "科技成果转化专项资金申请": "科技成果转化\"一件事\"",
    "知识产权支持资金申请": "科技成果转化\"一件事\"",
    "创业补贴申领": "个人创业\"一件事\"",
    # 以旧换新类
    "家电以旧换新和手机等购新补贴资格校验": "家电以旧换新和手机等购新补贴申请\"一件事\"",
    "汽车报废更新补贴申请": "汽车以旧换新补贴申请\"一件事\"",
    # 个人身后类
    "个人账户一次性待遇申领（基本养老保险）": "个人身后\"一件事\"",
    "参保人员职工基本医疗保险个人账户余额一次性支取": "个人身后\"一件事\"",
    "住房公积金提取（死亡）": "个人身后\"一件事\"",
    "已故存款人小额存款提取（继承人提取）": "个人身后\"一件事\"",
    # 退役军人/残疾人/退休类
    "自主就业一次性经济补助金的给付": "退役军人服务\"一件事\"",
    "困难残疾人生活补贴": "残疾人服务\"一件事\"",
    "重度残疾人护理补贴": "残疾人服务\"一件事\"",
    "城乡居民基本养老保险补助": "退休\"一件事\"",
    "新增退休人员养老保险待遇核定发放": "退休\"一件事\"",
    "离休、退休提取住房公积金": "退休\"一件事\"",
    "城镇独生子女父母奖励金": "退休\"一件事\"",
}

# ─ "一件事"名称 → 默认补贴事项名称映射（Excel导入兜底用） ────────────
# key = "一件事"名称，value = 该事项下的第一个补贴事项名称（作为默认值）
ONE_THING_DEFAULT_ITEM = {
    "育儿补贴申领\"一件事\"": "育儿补贴申领资格审核",
    "老年人福利补贴申领\"一件事\"": "老年人福利补贴资格审核",
    "社会救助\"一件事\"": "特困人员救助供养",
    "科技成果转化\"一件事\"": "科技成果转化专项资金申请",
    "个人创业\"一件事\"": "创业补贴申领",
    "家电以旧换新和手机等购新补贴申请\"一件事\"": "家电以旧换新和手机等购新补贴资格校验",
    "汽车以旧换新补贴申请\"一件事\"": "汽车报废更新补贴申请",
    "个人身后\"一件事\"": "个人账户一次性待遇申领（基本养老保险）",
    "退役军人服务\"一件事\"": "自主就业一次性经济补助金的给付",
    "残疾人服务\"一件事\"": "困难残疾人生活补贴",
    "退休\"一件事\"": "城乡居民基本养老保险补助",
}
async def filter_results_by_page_title(
    results: list[dict],
    keywords: list[str],
    timeout: float = 10.0,
    max_concurrent: int = 5,
) -> list[dict]:
    """根据网页真实 <title> 标签过滤搜索结果

    并发请求每个 URL，获取网页 <title>，判断是否包含任一关键词。

    Args:
        results: _bing_search 或类似函数返回的结果列表
        keywords: 需要匹配的关键词列表（任一匹配即可，不区分大小写）
        timeout: 单个请求超时时间（秒）
        max_concurrent: 最大并发请求数

    Returns:
        过滤后的结果列表，保留原始字段并新增 "page_title"
    """
    if not results or not keywords:
        return results

    # 关键词统一小写，用于不区分大小写匹配
    keywords_lower = [k.lower() for k in keywords]

    semaphore = asyncio.Semaphore(max_concurrent)

    async def fetch_title(result: dict) -> dict | None:
        """获取单个 URL 的网页标题"""
        url = result.get("url", "")
        if not url or not url.startswith(("http://", "https://")):
            return None

        async with semaphore:
            try:
                async with httpx.AsyncClient(
                    timeout=timeout,
                    follow_redirects=True,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0"
                    },
                ) as client:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        logger.warning(f"获取页面失败 [{resp.status_code}]: {url}")
                        return None

                    # 解析 <title>
                    soup = BeautifulSoup(resp.text, "lxml")
                    page_title = ""
                    if soup.title and soup.title.string:
                        page_title = soup.title.string.strip()

                    # 判断标题是否包含任一关键词
                    page_title_lower = page_title.lower()
                    matched = any(kw in page_title_lower for kw in keywords_lower)

                    if matched:
                        logger.info(f"命中: [{page_title[:40]}...] {url}")
                        # 保留原始字段，新增 page_title
                        return {**result, "page_title": page_title}
                    else:
                        logger.debug(f"未命中: [{page_title[:40]}...] {url}")
                        return None

            except asyncio.TimeoutError:
                logger.warning(f"请求超时: {url}")
                return None
            except Exception as e:
                logger.warning(f"获取页面异常 [{type(e).__name__}]: {url} - {e}")
                return None

    # 并发执行所有请求
    tasks = [fetch_title(r) for r in results]
    filtered = await asyncio.gather(*tasks)

    # 过滤掉 None，保留命中的结果
    return [r for r in filtered if r is not None]



# 明确死链标记：页面已被撤走（404/410/451），供上游直接丢弃，与"超时/未知"区分
DEAD_LINK_MARKER = "__DEAD_LINK__"


async def fetch_page_title(
    session: aiohttp.ClientSession,
    url: str,
    timeout: float = 8.0,
) -> Optional[str]:
    """轻量获取页面真实标题（只请求HTML，解析<title>和<h1>）

    返回：
      - 标题字符串：成功且解析到标题
      - DEAD_LINK_MARKER：明确死链（404/410/451，文章已撤走），供调用方丢弃
      - None：超时 / 其他异常 / 无法解析标题（保留，交由下游判断）
    """
    try:
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=timeout),
            ssl=False,  # 部分政府网站证书有问题
        ) as response:
            if response.status != 200:
                # 404/410/451 等"页面已撤走"的状态码：明确为死链，供上游丢弃
                if response.status in (404, 410, 451):
                    return DEAD_LINK_MARKER
                return None
            
            # 只读取前50KB（标题通常在头部，不需要全文）
            text = await response.content.read(50 * 1024)
            text = text.decode('utf-8', errors='ignore')
            
            soup = BeautifulSoup(text, 'html.parser')
            
            # 优先找 <h1>（文章标题通常在这里）
            h1 = soup.find('h1')
            if h1 and h1.get_text(strip=True):
                return h1.get_text(strip=True)
            
            # 其次找 <title>
            title_tag = soup.find('title')
            if title_tag and title_tag.get_text(strip=True):
                return title_tag.get_text(strip=True)
            
            # 兜底：找第一个带"标题"类名的元素
            for cls in ['title', 'article-title', 'news-title', 'headline']:
                el = soup.find(class_=cls)
                if el and el.get_text(strip=True):
                    return el.get_text(strip=True)
            
            return None
            
    except asyncio.TimeoutError:
        return None
    except Exception:
        return None


async def filter_links_by_real_title(
    links: list[dict],
    keywords: list[str],
    keyword_relation: str = 'and',
    max_concurrent: int = 8,
    request_timeout: float = 8.0,
) -> list[dict]:
    if not links or not keywords:
        return []
    
    filter_keywords = [kw.strip().lower() for kw in keywords if kw.strip()]
    if not filter_keywords:
        return []
    
    semaphore = asyncio.Semaphore(max_concurrent)
    results = []
    stats = {"total": len(links), "success": 0, "failed": 0, "matched": 0, "dead": 0}
    
    connector = aiohttp.TCPConnector(
        limit=50,
        limit_per_host=5,
        ttl_dns_cache=300,
        use_dns_cache=True,
    )
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }
    
    # ✅ 只创建一次 session，所有请求共享
    async with aiohttp.ClientSession(
        connector=connector,
        headers=headers,
    ) as session:
        
        async def process_one(link: dict) -> None:
            url = link.get("url", "") if isinstance(link, dict) else str(link)
            if not url:
                return
            
            # 如果搜索API已经返回了标题，直接用该标题匹配，无需再HTTP请求
            existing_title = (link.get("title", "") or "").strip() if isinstance(link, dict) else ""
            if existing_title:
                title_lower = existing_title.lower()
                if keyword_relation == 'or':
                    is_match = any(kw in title_lower for kw in filter_keywords)
                else:
                    is_match = all(kw in title_lower for kw in filter_keywords)
                if is_match:
                    stats["matched"] += 1
                    result = dict(link) if isinstance(link, dict) else {"url": url}
                    result["real_title"] = existing_title
                    results.append(result)
                return  # 已有标题的链接，无论匹配与否都不再HTTP请求
            
            async with semaphore:  # 仅 semaphore 控制并发
                real_title = await fetch_page_title(session, url, request_timeout)

            if real_title == DEAD_LINK_MARKER:
                # 明确死链（404/410等，文章已撤走）：直接丢弃，避免入库失效链接
                stats["dead"] += 1
                return

            if not real_title:
                # 标题获取失败（超时/解析错误）：保留链接，标记标题未知
                # 让下游规则评分和LLM做最终判断，避免有效链接因超时被丢弃
                stats["failed"] += 1
                result = dict(link) if isinstance(link, dict) else {"url": url}
                result["real_title"] = ""
                result["title_unknown"] = True
                results.append(result)
                return
            
            stats["success"] += 1
            title_lower = real_title.lower()
            
            if keyword_relation == 'or':
                is_match = any(kw in title_lower for kw in filter_keywords)
            else:
                is_match = all(kw in title_lower for kw in filter_keywords)
            
            if is_match:
                stats["matched"] += 1
                result = dict(link) if isinstance(link, dict) else {"url": url}
                result["real_title"] = real_title
                results.append(result)
        
        tasks = [process_one(link) for link in links]
        await asyncio.gather(*tasks, return_exceptions=True)
    
    # session 退出 async with 时自动关闭 connector
    title_unknown_count = sum(1 for r in results if r.get("title_unknown"))
    print(f"[filter_links_by_real_title] 总计{stats['total']}条, "
          f"已有标题{sum(1 for r in results if r.get('real_title') and not r.get('title_unknown'))}条, "
          f"HTTP成功{stats['success']}条, 失败保留{title_unknown_count}条, "
          f"死链丢弃{stats.get('dead', 0)}条, "
          f"关键词匹配{stats['matched']}条")
    
    return results