// 端内提取（票据 20）：由弹窗通过 chrome.scripting.executeScript 注入，
// 与 vendor/Readability.js（@mozilla/readability 0.6.0，Apache-2.0）注入到同一个隔离世界。
// 本文件是经典脚本（不能写 import/export），最后一条语句的值即 executeScript 的返回结果。

;(() => {
  // 正文上限，防止超长页面把消息与请求体撑爆
  const MAX_CHARS = 200000

  const clip = (text) => (text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text)

  try {
    const article = new Readability(document.cloneNode(true), { charThreshold: 100 }).parse()
    const text = article?.textContent?.trim()
    if (text) {
      return {
        ok: true,
        fallenBack: false,
        title: article.title?.trim() || document.title,
        byline: article.byline?.trim() ?? "",
        url: location.href,
        textContent: clip(text),
      }
    }
  } catch {
    // 提取异常走下面的兜底，不把弹窗卡死在错误里
  }

  // 兜底：Readability 判不出正文（短页面、特殊排版）时取整页可见文本，宁粗勿丢
  const text = document.body?.innerText?.trim()
  if (!text) return { ok: false, reason: "这个页面没有可提取的正文" }
  return { ok: true, fallenBack: true, title: document.title, byline: "", url: location.href, textContent: clip(text) }
})()
