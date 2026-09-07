#!/usr/bin/env python3
# 检索管线最小原型（票据 11）
# 流程：扫描 vault 示例笔记 -> 分块 -> SiliconFlow bge-m3 嵌入 -> 余弦检索 -> bge-reranker 重排
# 零第三方依赖；生产实现为 Bun/TS + sqlite-vec，分块与检索逻辑照搬本文件。
# 用法：SILICONFLOW_API_KEY=sk-xxx python3 search_demo.py

import json
import math
import os
import re
import sys
import urllib.request
from pathlib import Path

VAULT = Path(__file__).resolve().parent.parent / "vault"
BASE = "https://api.siliconflow.cn/v1"
EMBED_MODEL = "BAAI/bge-m3"
RERANK_MODEL = "BAAI/bge-reranker-v2-m3"

CHUNK_TARGET = 400      # 目标块长（字）
CHUNK_MAX = 600         # 硬上限
RETRIEVE_K = 8          # 向量粗取条数
RERANK_K = 3            # 重排后返回条数

DEMO_QUERIES = [
    "外脑怎么把看过的东西记住并且找回来？",
    "归档之后的笔记还能被搜到吗？",
    "威科夫方法里 spring 跌破支撑意味着什么？",
    "我想在手机上快速记一个想法，有什么办法？",
]


def api(path: str, payload: dict) -> dict:
    key = os.environ.get("SILICONFLOW_API_KEY")
    if not key:
        sys.exit("缺少环境变量 SILICONFLOW_API_KEY")
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """切出 YAML 头与正文（极简解析，原型够用）。"""
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, m.group(2)


def indexable_body(body: str) -> str:
    """提炼后笔记只索引 '## 原文' 之前的提炼区；收件箱笔记（无原文区）索引全文。"""
    idx = body.find("## 原文")
    return body[:idx] if idx >= 0 else body


def split_chunks(body: str) -> list[str]:
    """中文分块：先按 markdown 标题切段，过长段按句子聚合到目标块长。"""
    chunks: list[str] = []
    sections = re.split(r"\n(?=#{1,3} )", body)
    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue
        if len(sec) <= CHUNK_MAX:
            chunks.append(sec)
            continue
        # 按中文句末标点切句，贪心聚合
        sentences = re.split(r"(?<=[。！？!?\n])", sec)
        buf = ""
        for s in sentences:
            if len(buf) + len(s) > CHUNK_TARGET and buf:
                chunks.append(buf)
                buf = buf[-50:] + s  # 约 50 字重叠
            else:
                buf += s
        if buf.strip():
            chunks.append(buf)
    return [c.strip() for c in chunks if c.strip()]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb)


def main() -> None:
    # 1. 扫描与分块
    docs: list[dict] = []
    for md in sorted(VAULT.rglob("*.md")):
        meta, body = parse_frontmatter(md.read_text(encoding="utf-8"))
        for i, chunk in enumerate(split_chunks(indexable_body(body))):
            docs.append({
                "note_id": meta.get("id", md.stem),
                "title": meta.get("title", md.stem),
                "path": str(md.relative_to(VAULT)),
                "status": meta.get("status", "?"),
                "chunk_no": i,
                "text": chunk,
            })
    print(f"== 扫描 {len(list(VAULT.rglob('*.md')))} 篇笔记，切出 {len(docs)} 个分块 ==\n")

    # 2. 嵌入（批量）
    resp = api("/embeddings", {"model": EMBED_MODEL, "input": [d["text"] for d in docs]})
    for d, item in zip(docs, resp["data"]):
        d["vec"] = item["embedding"]
    print(f"== 嵌入完成：{EMBED_MODEL}，维度 {len(docs[0]['vec'])} ==\n")

    for q in DEMO_QUERIES:
        print("=" * 72)
        print(f"提问：{q}")

        # 3. 向量粗取
        qv = api("/embeddings", {"model": EMBED_MODEL, "input": [q]})["data"][0]["embedding"]
        ranked = sorted(docs, key=lambda d: cosine(qv, d["vec"]), reverse=True)[:RETRIEVE_K]

        # 4. 重排精取
        rr = api("/rerank", {
            "model": RERANK_MODEL,
            "query": q,
            "documents": [d["text"] for d in ranked],
            "top_n": RERANK_K,
            "return_documents": False,
        })
        print(f"-- 重排后 top {RERANK_K}（括号内为粗取余弦分 / 重排相关性分）--")
        for r in rr["results"]:
            d = ranked[r["index"]]
            preview = d["text"].replace("\n", " ")[:90]
            print(f"  · [{d['status']}] {d['title']}  ({d['path']})")
            print(f"    粗取 {cosine(qv, d['vec']):.3f} / 重排 {r['relevance_score']:.3f}")
            print(f"    “{preview}…”")
        print()


if __name__ == "__main__":
    main()
